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
  // Requires explicit colon separator to avoid false positives like "The patient was examined"
  // Matches: Optional Title + FirstName + LastName (and optional Middle)
  // Use [ \t] instead of \s to avoid matching across newlines
  const contextPattern = new RegExp(
    `(${NAME_LABELS.join('|')}):[ \\t]+((?:(?:Dr|Mr|Ms|Mrs|Miss)\\.?[ \\t]+)?)([A-Z][a-z]+(?:[ \\t]+[A-Z][a-z]+){1,3})`,
    'gi'
  );

  let match;
  while ((match = contextPattern.exec(text)) !== null) {
    // match[1] = label (e.g., "Patient Name")
    // match[2] = title with period and space if present (e.g., "Dr. " or "")
    // match[3] = name parts (e.g., "Jane Smith")

    // Extract the full name including title if present
    const titlePart = match[2];  // This includes period if present and trailing space
    const namePart = match[3];
    const fullName = titlePart + namePart;
    const nameValue = fullName.trim();

    // Find where the actual name value starts in the match (after the colon and space)
    const labelAndColon = match[1] + ':';
    const nameStartInMatch = match[0].indexOf(titlePart + namePart, labelAndColon.length);
    const start = match.index + nameStartInMatch;

    matches.push({
      start,
      end: start + nameValue.length,
      value: nameValue
    });
  }

  return matches;
};

// Secondary validation patterns (broader, more aggressive)
const VALIDATION_PATTERNS = {
  // Catch any remaining capitalized word sequences (potential names)
  CAPITALIZED_SEQUENCE: /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g,
  // Catch any remaining numeric sequences that look like IDs
  NUMERIC_ID: /\b[A-Z]{0,3}\d{6,12}\b/g,
  // Catch email-like patterns that might have been missed
  EMAIL_LIKE: /\b[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}\b/g,
  // Catch phone-like patterns
  PHONE_LIKE: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  // Catch date-like patterns
  DATE_LIKE: /\b\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}\b/g,
  // Catch remaining addresses (more aggressive)
  ADDRESS_LIKE: /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}\b/g
};

// Words that should NOT be scrubbed (common medical/clinical terms)
const WHITELIST_TERMS = new Set([
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'Doctor', 'Patient', 'Hospital', 'Clinic', 'Medical', 'Health', 'Treatment', 'Diagnosis',
  'Blood', 'Heart', 'Liver', 'Kidney', 'Brain', 'Lung', 'Skin', 'Bone',
  'Pressure', 'Temperature', 'Weight', 'Height', 'Pulse', 'Rate',
  'Normal', 'Abnormal', 'Positive', 'Negative', 'Result', 'Test', 'Lab', 'Study',
  'Emergency', 'Discharge', 'Admission', 'Visit', 'Appointment', 'Follow', 'Up',
  'General', 'Internal', 'External', 'Primary', 'Secondary', 'Acute', 'Chronic',
  'United', 'States', 'America', 'North', 'South', 'East', 'West', 'Central'
]);

interface ValidationResult {
  foundSuspiciousPII: boolean;
  suspiciousMatches: string[];
  confidenceScore: number;
}

// Export for testing
export {
  detectContextualMRN,
  detectLabeledName,
  PATTERNS,
  VALIDATION_PATTERNS,
  WHITELIST_TERMS,
  MRN_CONTEXT_KEYWORDS,
  NAME_LABELS
};

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

    // Skip ML model loading in test environment (use regex-only mode)
    if (process.env.VITEST || process.env.NODE_ENV === 'test') {
      console.log("⚠️  Test mode: Skipping ML model loading (using regex-only PII detection)");
      return;
    }

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

  /**
   * PLACEHOLDER CLEANUP: Reduce spam and improve readability
   *
   * Consolidates excessive placeholders and removes artifacts
   */
  private consolidatePlaceholders(text: string): string {
    let result = text;

    // 1. Remove leading placeholder artifacts like "[PER_X] :" or "[PER_X] :Text"
    result = result.replace(/\[([A-Z]+)_(\d+)\]\s*:\s*/g, '');

    // 2. Consolidate consecutive placeholders (keep only spacing)
    // [PHONE_1][ZIP_1] → [PHONE_1] [ZIP_1]
    result = result.replace(/(\[[A-Z]+_\d+\])(\[[A-Z]+_\d+\])/g, '$1 $2');

    // 3. Remove placeholder fragments at line starts
    result = result.replace(/^\[([A-Z]+)_(\d+)\]\s*/gm, '');

    // 4. Clean up excessive consecutive placeholders (more than 3)
    // [PER_1] [PER_2] [PER_3] [PER_4] → [REDACTED_INFO]
    result = result.replace(/((\[[A-Z]+_\d+\]\s*){4,})/g, '[REDACTED_INFO] ');

    // 5. Remove stray colons after placeholder removal
    result = result.replace(/^\s*:\s*/gm, '');

    return result;
  }

  /**
   * SMART TRANSFORMATION: Convert DOB → Age
   *
   * Replaces "DOB: 01/15/1985" with "Age: 40 years" (calculated)
   * This preserves clinical utility while removing PII
   */
  private transformDOBtoAge(text: string): string {
    // Patterns for DOB labels
    const dobPatterns = [
      /\b(DOB|D\.O\.B\.|Date of Birth|Birth Date)\s*[:：]\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi,
      /\b(DOB|D\.O\.B\.|Date of Birth|Birth Date)\s*[:：]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi
    ];

    let result = text;

    for (const pattern of dobPatterns) {
      result = result.replace(pattern, (match, label, dateStr) => {
        try {
          // Parse date (supports MM/DD/YYYY, MM-DD-YYYY, etc.)
          const parts = dateStr.split(/[\/-]/);
          let month: number, day: number, year: number;

          if (parts.length === 3) {
            // Assume MM/DD/YYYY format
            month = parseInt(parts[0], 10);
            day = parseInt(parts[1], 10);
            year = parseInt(parts[2], 10);

            // Handle 2-digit years
            if (year < 100) {
              year += year < 50 ? 2000 : 1900;
            }

            // Validate date
            if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > new Date().getFullYear()) {
              return match; // Keep original if invalid
            }

            // Calculate age
            const birthDate = new Date(year, month - 1, day);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const monthDiff = today.getMonth() - birthDate.getMonth();

            // Adjust if birthday hasn't occurred this year
            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
              age--;
            }

            // Return age transformation
            return `Age: ${age} years`;
          }
        } catch (e) {
          // If parsing fails, keep original
          console.warn(`Failed to parse DOB: ${dateStr}`, e);
        }

        return match; // Fallback to original
      });
    }

    return result;
  }

  public async scrub(text: string): Promise<ScrubResult> {
    if (!this.pipe) await this.loadModel();

    const globalReplacements: PIIMap = {};
    let totalReplacements = 0;

    // Context consistency map
    const entityToPlaceholder: Record<string, string> = {};
    const counters = { PER: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, ID: 0, DATE: 0 };

    // --- PHASE 0: SMART TRANSFORMATIONS ---
    // Convert DOB → Age (preserves clinical utility while removing PII)
    let interimText = this.transformDOBtoAge(text);

    // --- PHASE 1: REGEX PRE-PASS ---
    // We replace structural PII first to prevent BERT from getting confused or splitting them.
    // We replace them with unique temporary masks which we can either keep or format later.

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

    // Apply patterns in order of specificity (more specific first to avoid false matches)
    runRegex('EMAIL', PATTERNS.EMAIL, 'EMAIL');
    runRegex('ID', PATTERNS.CREDIT_CARD, 'CARD');  // 16 digits - more specific than phone
    runRegex('PHONE', PATTERNS.PHONE, 'PHONE');     // 10 digits
    runRegex('ID', PATTERNS.SSN, 'SSN');
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

      // Skip ML inference if model is not loaded (test mode or regex-only mode)
      if (!this.pipe) {
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
    console.log(`✅ Pass 1 (Primary) complete: ${totalReplacements} entities redacted`);

    // --- PHASE 4: SECONDARY VALIDATION PASS ---
    // Catch anything that slipped through with broader patterns
    console.log(`🔍 Running Pass 2 (Validation)...`);
    const { text: validatedText, additionalReplacements, additionalCount } = this.secondaryValidationPass(
      finalScrubbedText,
      entityToPlaceholder,
      counters,
      globalReplacements
    );

    const totalSecondPassReplacements = totalReplacements + additionalCount;
    console.log(`✅ Pass 2 complete: ${additionalCount} additional entities caught`);

    // --- PHASE 5: VERIFICATION ---
    // Final check to ensure no suspicious patterns remain
    const validation = this.verifyNoSuspiciousPII(validatedText);

    if (validation.foundSuspiciousPII) {
      console.warn(`⚠️  Validation found ${validation.suspiciousMatches.length} suspicious patterns`);
      console.warn(`Suspicious matches:`, validation.suspiciousMatches.slice(0, 10));
    }

    const totalProcessingTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ All passes complete in ${totalProcessingTime}s`);
    console.log(`📊 Total: ${totalSecondPassReplacements} entities | Confidence: ${validation.confidenceScore.toFixed(1)}%`);

    // Final cleanup: Consolidate placeholders to reduce spam
    const finalText = this.consolidatePlaceholders(validatedText);

    return {
      text: finalText,
      replacements: globalReplacements,
      count: totalSecondPassReplacements
    };
  }

  private getSentences(text: string): string[] {
    if (this.segmenter) {
      return Array.from((this.segmenter as any).segment(text)).map((s: any) => s.segment);
    }
    // Fallback if Intl.Segmenter not supported (older browsers)
    return text.match(/[^.!?]+[.!?]+]*/g) || [text];
  }

  /**
   * PHASE 4: SECONDARY VALIDATION PASS
   *
   * Multi-pass compiler-like approach:
   * - Pass 1 (Primary): Strict patterns + ML
   * - Pass 2 (Validation): Broad patterns + heuristics
   * - Pass 3 (Verification): Final check
   *
   * This pass uses broader, more aggressive patterns to catch edge cases.
   */
  private secondaryValidationPass(
    text: string,
    entityToPlaceholder: Record<string, string>,
    counters: any,
    globalReplacements: PIIMap
  ): { text: string; additionalReplacements: PIIMap; additionalCount: number } {
    let validatedText = text;
    const additionalReplacements: PIIMap = {};
    let additionalCount = 0;

    // Helper function to check if text is already a placeholder
    const isPlaceholder = (str: string) => /^\[[A-Z_]+\d+\]$/.test(str);

    // Helper function to check if word is whitelisted
    const isWhitelisted = (str: string) => {
      const cleaned = str.trim();
      return WHITELIST_TERMS.has(cleaned) || WHITELIST_TERMS.has(cleaned.toLowerCase());
    };

    // 1. Catch remaining capitalized sequences (potential names)
    const capitalizedMatches = validatedText.match(VALIDATION_PATTERNS.CAPITALIZED_SEQUENCE) || [];
    for (const match of capitalizedMatches) {
      if (isPlaceholder(match) || isWhitelisted(match)) continue;

      // Skip if it's likely a medical term or common phrase
      const words = match.split(/\s+/);
      if (words.every(w => isWhitelisted(w))) continue;

      if (!entityToPlaceholder[match]) {
        counters.PER++;
        const placeholder = `[PER_${counters.PER}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      const regex = VALIDATION_PATTERNS.CAPITALIZED_SEQUENCE;
      let currentMatch;
      // Reset lastIndex for exec loop
      regex.lastIndex = 0;
      const replacements = [];
      while ((currentMatch = regex.exec(validatedText)) !== null) {
        const match = currentMatch[0];
        if (isPlaceholder(match) || isWhitelisted(match)) continue;

        const words = match.split(/\s+/);
        if (words.every(w => isWhitelisted(w))) continue;

        if (!entityToPlaceholder[match]) {
          counters.PER++;
          const placeholder = `[PER_${counters.PER}]`;
          entityToPlaceholder[match] = placeholder;
          globalReplacements[match] = placeholder;
          additionalReplacements[match] = placeholder;
          additionalCount++;
        }
  
        replacements.push({ start: currentMatch.index, end: currentMatch.index + match.length, placeholder: entityToPlaceholder[match] });
      }

      // Apply replacements from end to start to avoid index shifting
      for (let i = replacements.length - 1; i >= 0; i--) {
        const { start, end, placeholder } = replacements[i];
        validatedText = validatedText.substring(0, start) + placeholder + validatedText.substring(end);
      }
    }

    // 2. Catch remaining numeric IDs
    const numericMatches = validatedText.match(VALIDATION_PATTERNS.NUMERIC_ID) || [];
    for (const match of numericMatches) {
      if (isPlaceholder(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.ID++;
        const placeholder = `[ID_${counters.ID}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    // 3. Catch any remaining email-like patterns
    const emailMatches = validatedText.match(VALIDATION_PATTERNS.EMAIL_LIKE) || [];
    for (const match of emailMatches) {
      if (isPlaceholder(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.EMAIL++;
        const placeholder = `[EMAIL_${counters.EMAIL}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    // 4. Catch any remaining phone-like patterns
    const phoneMatches = validatedText.match(VALIDATION_PATTERNS.PHONE_LIKE) || [];
    for (const match of phoneMatches) {
      if (isPlaceholder(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.PHONE++;
        const placeholder = `[PHONE_${counters.PHONE}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    // 5. Catch any remaining date-like patterns
    const dateMatches = validatedText.match(VALIDATION_PATTERNS.DATE_LIKE) || [];
    for (const match of dateMatches) {
      if (isPlaceholder(match)) continue;

      // Skip if it looks like a time or version number
      if (/^\d{1,2}:\d{2}/.test(match) || /^v?\d+\.\d+/.test(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.DATE++;
        const placeholder = `[DATE_${counters.DATE}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    // 6. Catch remaining address-like patterns
    const addressMatches = validatedText.match(VALIDATION_PATTERNS.ADDRESS_LIKE) || [];
    for (const match of addressMatches) {
      if (isPlaceholder(match) || isWhitelisted(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.LOC++;
        const placeholder = `[LOC_${counters.LOC}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    return { text: validatedText, additionalReplacements, additionalCount };
  }

  /**
   * PHASE 5: VERIFICATION
   *
   * Final verification pass to check for any remaining suspicious patterns.
   * Returns a confidence score (0-100%) indicating how confident we are
   * that ALL PII has been removed.
   */
  private verifyNoSuspiciousPII(text: string): ValidationResult {
    const suspiciousMatches: string[] = [];

    // Check for patterns that shouldn't be in scrubbed text
    const checks = [
      { pattern: VALIDATION_PATTERNS.CAPITALIZED_SEQUENCE, type: 'Capitalized sequence (potential name)' },
      { pattern: VALIDATION_PATTERNS.NUMERIC_ID, type: 'Numeric ID' },
      { pattern: VALIDATION_PATTERNS.EMAIL_LIKE, type: 'Email-like pattern' },
      { pattern: VALIDATION_PATTERNS.PHONE_LIKE, type: 'Phone-like pattern' },
      { pattern: VALIDATION_PATTERNS.DATE_LIKE, type: 'Date-like pattern' },
      { pattern: VALIDATION_PATTERNS.ADDRESS_LIKE, type: 'Address-like pattern' }
    ];

    for (const { pattern, type } of checks) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        // Skip if it's already a placeholder
        if (/^\[[A-Z_]+\d+\]$/.test(match)) continue;

        // Skip whitelisted terms
        if (WHITELIST_TERMS.has(match.trim()) || WHITELIST_TERMS.has(match.trim().toLowerCase())) continue;

        // Skip if all words in the match are whitelisted
        const words = match.split(/\s+/);
        if (words.every(w => WHITELIST_TERMS.has(w.trim()) || WHITELIST_TERMS.has(w.trim().toLowerCase()))) continue;

        suspiciousMatches.push(`${type}: "${match}"`);
      }
    }

    const foundSuspiciousPII = suspiciousMatches.length > 0;

    // Calculate confidence score
    // Start at 100%, reduce based on number of suspicious matches
    let confidenceScore = 100;
    if (suspiciousMatches.length > 0) {
      // Each suspicious match reduces confidence
      // 1-5 matches: 95-99%
      // 6-10 matches: 90-94%
      // 11-20 matches: 80-89%
      // 21+ matches: <80%
      if (suspiciousMatches.length <= 5) {
        confidenceScore = 99 - suspiciousMatches.length;
      } else if (suspiciousMatches.length <= 10) {
        confidenceScore = 94 - (suspiciousMatches.length - 5);
      } else if (suspiciousMatches.length <= 20) {
        confidenceScore = 89 - (suspiciousMatches.length - 10);
      } else {
        confidenceScore = Math.max(50, 79 - (suspiciousMatches.length - 20));
      }
    }

    return {
      foundSuspiciousPII,
      suspiciousMatches,
      confidenceScore
    };
  }
}

export const piiScrubber = PiiScrubberService.getInstance();