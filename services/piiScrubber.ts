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
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g,
  // Address patterns
  ADDRESS: /\d+\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Parkway|Pkwy|Way|Circle|Cir|Place|Pl|Terrace|Ter)(?:\.|\s|,|\s+Apt|\s+Suite|\s+Unit|\s+#)?(?:\s*[A-Za-z0-9#-]*)?/gi,
  CITY_STATE: /\b[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\b/g,
  PO_BOX: /P\.?\s*O\.?\s*Box\s+\d+/gi
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

// Context-aware name detector for labeled patient names
const NAME_LABELS = [
  'Patient Name', 'Name', 'Full Name', 'Legal Name', 'Patient',
  'Pt Name', "Patient's Name", 'Name of Patient', 'patientName',
  'patient_name', 'fullName', 'full_name'
];

const detectLabeledName = (text: string): { start: number; end: number; value: string }[] => {
  const matches: { start: number; end: number; value: string }[] = [];

  // Look for names with labels (e.g., "Patient Name: John Smith", "Name: Mary Johnson")
  // Matches: Title + FirstName + LastName (and optional Middle)
  const contextPattern = new RegExp(
    `(${NAME_LABELS.join('|')})[:\\s]+(?:(Dr|Mr|Ms|Mrs|Miss)\\.?\\s+)?([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,3})`,
    'gi'
  );

  let match;
  while ((match = contextPattern.exec(text)) !== null) {
    // Extract the full name (including title if present)
    const nameValue = match[2] ? `${match[2]} ${match[3]}` : match[3];
    const nameStartOffset = match[0].indexOf(nameValue);
    const start = match.index + nameStartOffset;

    matches.push({
      start,
      end: start + nameValue.length,
      value: nameValue
    });
  }

  return matches;
};

// Export for testing
export { detectContextualMRN, detectLabeledName, PATTERNS, MRN_CONTEXT_KEYWORDS, NAME_LABELS };

class PiiScrubberService {
  private static instance: PiiScrubberService;
  private pipe: any = null;
  private loadPromise: Promise<void> | null = null;
  private segmenter?: any;

  private constructor() {
    // Use Intl.Segmenter for linguistically correct sentence splitting
    if ('Segmenter' in Intl) {
      this.segmenter = new (Intl as any).Segmenter('en', { granularity: 'sentence' });
    }
  }

  public static getInstance(): PiiScrubberService {
    if (!PiiScrubberService.instance) {
      PiiScrubberService.instance = new PiiScrubberService();
    }
    return PiiScrubberService.instance;
  }

  public async loadModel() {
    // If model is already loaded, return immediately
    if (this.pipe) return;

    // If model is currently loading, wait for that promise
    if (this.loadPromise) return this.loadPromise;

    // Start loading the model
    this.loadPromise = (async () => {
      try {
        this.pipe = await pipeline(
          'token-classification',
          'Xenova/bert-base-NER',
          { quantized: true } as any
        );
        console.log("NER Model loaded successfully");
      } catch (err) {
        console.error("Failed to load NER model", err);
        this.loadPromise = null; // Reset so it can be retried
        throw err;
      }
    })();

    return this.loadPromise;
  }

  public async scrub(text: string): Promise<ScrubResult> {
    if (!this.pipe) await this.loadModel();

    const globalReplacements: PIIMap = {};
    let totalReplacements = 0;

    // Context consistency map
    const entityToPlaceholder: Record<string, string> = {};
    const counters = { PER: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, ID: 0, DATE: 0 };

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
    runRegex('DATE', PATTERNS.DATE, 'DATE');

    // Address patterns - run BEFORE city/state to catch full addresses
    runRegex('LOC', PATTERNS.ADDRESS, 'ADDR');
    runRegex('LOC', PATTERNS.PO_BOX, 'POBOX');
    runRegex('LOC', PATTERNS.CITY_STATE, 'LOC');

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

    // Context-aware labeled name detection
    const nameMatches = detectLabeledName(interimText);
    nameMatches.reverse().forEach(({ start, end, value }) => {
      if (!entityToPlaceholder[value]) {
        counters.PER++;
        const placeholder = `[PER_${counters.PER}]`;
        entityToPlaceholder[value] = placeholder;
        globalReplacements[value] = placeholder;
        totalReplacements++;
      }
      interimText = interimText.substring(0, start) + entityToPlaceholder[value] + interimText.substring(end);
    });
    
    // --- PHASE 2: SMART CHUNKING ---
    // Split by sentences to preserve context for BERT, but group them to maximize chunk size
    // Optimized: Larger chunks = fewer model calls = better performance
    // Max ~2000 chars per chunk (approx 512 tokens) for optimal throughput

    const sentences = this.getSentences(interimText);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > 2000) { // Increased for better performance
            chunks.push(currentChunk);
            currentChunk = sentence;
        } else {
            currentChunk += sentence;
        }
    }
    if (currentChunk) chunks.push(currentChunk);

    // --- PHASE 3: ML INFERENCE ---
    let finalScrubbedText = '';

    console.log(`🔍 Processing ${chunks.length} chunks for PII detection...`);
    const startTime = performance.now();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Progress indicator for large documents
      if (chunks.length > 10 && i % 5 === 0) {
        console.log(`⏳ Progress: ${i}/${chunks.length} chunks (${Math.round(i/chunks.length*100)}%)`);
      }
      if (!chunk.trim()) {
        finalScrubbedText += chunk;
        continue;
      }

      // Check if chunk is just placeholders (optimization)
      if (/^(\s*\[[A-Z_]+\d+\]\s*)+$/.test(chunk)) {
          finalScrubbedText += chunk;
          continue;
      }

      // Performance: Batch with timeout to prevent blocking UI
      const output = await Promise.race([
        this.pipe(chunk, {
          aggregation_strategy: 'simple',
          ignore_labels: ['O']
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Processing timeout')), 30000)
        )
      ]);

      let chunkCursor = 0;
      let scrubbedChunk = '';

      // Filter high confidence entities (optimized: higher threshold = fewer false positives = faster)
      const entities = (output as any[]).filter((e: any) =>
        TARGET_ENTITIES.includes(e.entity_group) && e.score > 0.85
      );

      // Sort by start index to process sequentially
      entities.sort((a: any, b: any) => a.start - b.start);

      for (const entity of entities) {
        const { entity_group, word, start, end } = entity as any;
        
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

    const processingTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ PII scrubbing complete in ${processingTime}s (${totalReplacements} entities redacted)`);

    return {
      text: finalScrubbedText,
      replacements: globalReplacements,
      count: totalReplacements
    };
  }

  private getSentences(text: string): string[] {
    if (this.segmenter) {
      return Array.from((this.segmenter as any).segment(text)).map((s: any) => s.segment);
    }
    // Fallback if Intl.Segmenter not supported (older browsers)
    return text.match(/[^.!?]+[.!?]+]*/g) || [text];
  }
}

export const piiScrubber = PiiScrubberService.getInstance();