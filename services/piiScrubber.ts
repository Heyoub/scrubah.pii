import { pipeline, env } from '@huggingface/transformers';
import { ScrubResult, PIIMap } from '../types';

// Configure to not search for local models, use CDN
env.allowLocalModels = false;
env.useBrowserCache = true;

const TARGET_ENTITIES = ['PER', 'LOC', 'ORG'];

// Regex patterns for Hybrid Scrubbing (Presidio-style pre-pass)
const PATTERNS = {
  EMAIL: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g,
  PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  DATE: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  // Context-aware MRN detection
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g
};

// Context-aware MRN detector
const MRN_CONTEXT_KEYWORDS = [
  'MRN', 'Medical Record Number', 'Patient ID', 'Patient Number',
  'Record Number', 'Chart Number', 'Account Number', 'Member ID'
];

const detectContextualMRN = (text: string): { start: number; end: number; value: string }[] => {
  const matches: { start: number; end: number; value: string }[] = [];

  // Look for MRN with context (e.g., "MRN: 1234567")
  const contextPattern = new RegExp(
    `(${MRN_CONTEXT_KEYWORDS.join('|')})[:\\s]+([A-Z0-9]{6,12})\\b`,
    'gi'
  );

  let match;
  while ((match = contextPattern.exec(text)) !== null) {
    const mrnValue = match[2];
    const start = match.index + match[1].length + (match[0].length - match[1].length - mrnValue.length);
    matches.push({
      start,
      end: start + mrnValue.length,
      value: mrnValue
    });
  }

  return matches;
};

// Export for testing
export { detectContextualMRN, PATTERNS, MRN_CONTEXT_KEYWORDS };

class PiiScrubberService {
  private static instance: PiiScrubberService;
  private pipe: any = null;
  private isLoading: boolean = false;
  // @ts-ignore
  private segmenter: Intl.Segmenter;

  private constructor() {
    // Use Intl.Segmenter for linguistically correct sentence splitting
    // @ts-ignore
    if (typeof Intl.Segmenter !== 'undefined') {
        // @ts-ignore
        this.segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
    }
  }

  public static getInstance(): PiiScrubberService {
    if (!PiiScrubberService.instance) {
      PiiScrubberService.instance = new PiiScrubberService();
    }
    return PiiScrubberService.instance;
  }

  public async loadModel() {
    if (this.pipe) return;
    if (this.isLoading) return;

    this.isLoading = true;
    try {
      this.pipe = await pipeline('token-classification', 'Xenova/bert-base-NER', {
        quantized: true,
      });
      console.log("NER Model loaded successfully");
    } catch (err) {
      console.error("Failed to load NER model", err);
      throw err;
    } finally {
      this.isLoading = false;
    }
  }

  public async scrub(text: string): Promise<ScrubResult> {
    if (!this.pipe) await this.loadModel();

    const globalReplacements: PIIMap = {};
    let totalReplacements = 0;
    
    // Context consistency map
    const entityToPlaceholder: Record<string, string> = {};
    const counters = { PER: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, ID: 0 };

    // --- PHASE 1: REGEX PRE-PASS ---
    // We replace structural PII first to prevent BERT from getting confused or splitting them.
    // We replace them with unique temporary masks which we can either keep or format later.
    
    let interimText = text;

    const runRegex = (type: string, regex: RegExp, prefix: string) => {
        interimText = interimText.replace(regex, (match) => {
            if (!entityToPlaceholder[match]) {
                counters[type as keyof typeof counters]++;
                const placeholder = `[${prefix}_${counters[type as keyof typeof counters]}]`;
                entityToPlaceholder[match] = placeholder;
                globalReplacements[match] = placeholder;
                totalReplacements++;
            }
            return entityToPlaceholder[match];
        });
    };

    runRegex('EMAIL', PATTERNS.EMAIL, 'EMAIL');
    runRegex('PHONE', PATTERNS.PHONE, 'PHONE');
    runRegex('ID', PATTERNS.SSN, 'SSN');
    runRegex('ID', PATTERNS.CREDIT_CARD, 'CARD');
    runRegex('ID', PATTERNS.ZIPCODE, 'ZIP');

    // Context-aware MRN detection
    const mrnMatches = detectContextualMRN(interimText);
    mrnMatches.reverse().forEach(({ start, end, value }) => {
      if (!entityToPlaceholder[value]) {
        counters.ID++;
        const placeholder = `[MRN_${counters.ID}]`;
        entityToPlaceholder[value] = placeholder;
        globalReplacements[value] = placeholder;
        totalReplacements++;
      }
      interimText = interimText.substring(0, start) + entityToPlaceholder[value] + interimText.substring(end);
    });
    
    // --- PHASE 2: SMART CHUNKING ---
    // Split by sentences to preserve context for BERT, but group them to maximize chunk size
    // without exceeding token limits (approx 512 tokens ~ 300-400 words)
    
    const sentences = this.getSentences(interimText);
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > 1000) { // Conservative char limit for speed/safety
            chunks.push(currentChunk);
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    // --- PHASE 3: ML INFERENCE ---
    let finalScrubbedText = '';

    for (const chunk of chunks) {
      if (!chunk.trim()) {
        finalScrubbedText += chunk;
        continue;
      }

      // Check if chunk is just placeholders (optimization)
      if (/^(\s*\[[A-Z_]+\d+\]\s*)+$/.test(chunk)) {
          finalScrubbedText += chunk;
          continue;
      }

      const output = await this.pipe(chunk, {
        aggregation_strategy: 'simple',
        ignore_labels: ['O'] 
      });

      let chunkCursor = 0;
      let scrubbedChunk = '';
      
      // Filter high confidence entities
      // @ts-ignore
      const entities = output.filter(e => TARGET_ENTITIES.includes(e.entity_group) && e.score > 0.80);
      
      // Sort by start index to process sequentially
      // @ts-ignore
      entities.sort((a, b) => a.start - b.start);

      for (const entity of entities) {
        // @ts-ignore
        const { entity_group, word, start, end } = entity;
        
        // Append text before entity
        scrubbedChunk += chunk.substring(chunkCursor, start);
        
        const originalText = chunk.substring(start, end);
        
        // Check if this "original text" is actually one of our regex placeholders. 
        // If so, skip it (don't double scrub).
        if (/^\[[A-Z_]+\d+\]$/.test(originalText.trim())) {
             scrubbedChunk += originalText;
        } else {
            // Generate Placeholder
            if (!entityToPlaceholder[originalText]) {
                counters[entity_group as keyof typeof counters]++;
                const placeholder = `[${entity_group}_${counters[entity_group as keyof typeof counters]}]`;
                entityToPlaceholder[originalText] = placeholder;
                globalReplacements[originalText] = placeholder;
                totalReplacements++;
            }
            scrubbedChunk += entityToPlaceholder[originalText];
        }
        
        chunkCursor = end;
      }

      // Append remaining text in chunk
      scrubbedChunk += chunk.substring(chunkCursor);
      finalScrubbedText += scrubbedChunk;
    }

    return {
      text: finalScrubbedText,
      replacements: globalReplacements,
      count: totalReplacements
    };
  }

  private getSentences(text: string): string[] {
    // @ts-ignore
    if (this.segmenter) {
        // @ts-ignore
        return Array.from(this.segmenter.segment(text)).map((s: any) => s.segment);
    }
    // Fallback if Intl.Segmenter not supported (older browsers)
    return text.match(/[^.!?]+[.!?]+]*/g) || [text];
  }
}

export const piiScrubber = PiiScrubberService.getInstance();