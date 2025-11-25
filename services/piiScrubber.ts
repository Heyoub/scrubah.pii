import { pipeline, env } from '@huggingface/transformers';
import { ScrubResult, PIIMap } from '../types';
import { markAsScrubbed, mightContainPII } from '../schemas/phi';

// Configure to not search for local models, use CDN
env.allowLocalModels = false;
env.useBrowserCache = true;

const TARGET_ENTITIES = ['PER', 'LOC', 'ORG'] as const;

/** Counter state for placeholder numbering */
type EntityCounters = Record<'PER' | 'LOC' | 'ORG' | 'EMAIL' | 'PHONE' | 'ID' | 'DATE', number>;

// US State abbreviations for standalone detection
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU', 'AS', 'MP' // DC and territories
]);

// Regex patterns for Hybrid Scrubbing (Presidio-style pre-pass)
const PATTERNS = {
  EMAIL: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g,
  PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  SSN_PARTIAL: /\b(?:last\s*4|xxx-xx-)\s*[-:]?\s*\d{4}\b/gi, // "last 4: 1234" or "xxx-xx-1234"
  DATE: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  // Written-out dates: "March 15, 2024", "15 March 2024", "March 2024"
  DATE_WRITTEN: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi,
  DATE_WRITTEN_ALT: /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s+\d{4})?\b/gi,
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g,
  // Age patterns (HIPAA PHI when combined with other info)
  AGE: /\b\d{1,3}\s*(?:year[s]?\s*old|y\.?o\.?|yo|yr[s]?(?:\s*old)?)\b/gi,
  AGE_CONTEXT: /\b(?:age[d]?|DOB\s+indicates)\s*[:\s]*\d{1,3}\b/gi,
  // Address patterns
  ADDRESS: /\d+\s+(?:[A-Za-z]+\s+){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Parkway|Pkwy|Way|Circle|Cir|Place|Pl|Terrace|Ter)(?:\.|\s|,|\s+Apt|\s+Suite|\s+Unit|\s+#)?(?:\s*[A-Za-z0-9#-]*)?/gi,
  CITY_STATE: /\b[A-Z][a-zA-Z\s]+,\s*[A-Z]{2}\b/g,
  PO_BOX: /P\.?\s*O\.?\s*Box\s+\d+/gi,
  // ALL CAPS names: "DOE, JANE" or "JOHN SMITH" (2+ consecutive uppercase words)
  ALL_CAPS_NAME: /\b[A-Z]{2,}(?:,?\s+[A-Z]{2,})+\b/g,
  // Single ALL CAPS word (likely a name in medical context) - min 3 chars to avoid acronyms
  ALL_CAPS_SINGLE: /\b[A-Z]{3,}\b/g,
  // LAST, FIRST format (Title Case): "Smith, John" or "Van Der Berg, Maria"
  LAST_FIRST_NAME: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  // Names with apostrophes/hyphens: "O'Brien", "Mary-Jane", "McDonald"
  NAME_APOSTROPHE: /\b(?:O'|Mc|Mac)?[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)+\b/g,
  // Names with suffixes: "John Smith Jr.", "Robert Williams III"
  NAME_WITH_SUFFIX: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\s+(?:Jr\.?|Sr\.?|II|III|IV|V)\b/g,
  // Insurance/Policy ID patterns
  INSURANCE_ID: /\b(?:policy|member|subscriber|group|insurance)\s*(?:#|number|id|no)?[:\s]*[A-Z0-9]{6,15}\b/gi
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

/**
 * Detect standalone US state abbreviations (e.g., "MA", "NY")
 * Only matches when it's clearly a state context, not random 2-letter words
 */
const detectStandaloneStates = (text: string): { start: number; end: number; value: string }[] => {
  const matches: { start: number; end: number; value: string }[] = [];

  // Match 2-letter uppercase words at word boundaries
  const statePattern = /\b([A-Z]{2})\b/g;
  let match;

  while ((match = statePattern.exec(text)) !== null) {
    const potentialState = match[1];

    // Check if it's a valid US state
    if (US_STATES.has(potentialState)) {
      // Skip if it's already part of a placeholder like [LOC_1]
      const before = text.slice(Math.max(0, match.index - 1), match.index);
      const after = text.slice(match.index + 2, match.index + 3);
      if (before === '[' || after === ']' || before === '_') continue;

      matches.push({
        start: match.index,
        end: match.index + 2,
        value: potentialState
      });
    }
  }

  return matches;
};

const detectLabeledName = (text: string): { start: number; end: number; value: string }[] => {
  const matches: { start: number; end: number; value: string }[] = [];

  // Sort labels by length (longest first) to prevent partial matches
  // e.g., "Patient Name" should match before "Patient"
  const sortedLabels = [...NAME_LABELS].sort((a, b) => b.length - a.length);

  // Look for names with labels (e.g., "Patient Name: John Smith", "Name: Mary Johnson")
  // Two-part approach: case-insensitive label, case-SENSITIVE name
  // This prevents false positives like "patient was examined" from matching
  const labelPattern = new RegExp(
    `(${sortedLabels.join('|')})\\s*:\\s*`,
    'gi'
  );

  let labelMatch;
  while ((labelMatch = labelPattern.exec(text)) !== null) {
    const afterLabel = text.slice(labelMatch.index + labelMatch[0].length);
    const start = labelMatch.index + labelMatch[0].length;

    // Try multiple name patterns in order of specificity

    // Pattern 1: ALL CAPS with optional comma (LAST, FIRST or FIRST LAST)
    const allCapsPattern = /^([A-Z]{2,}(?:,?\s+[A-Z]{2,})+)/;
    const allCapsMatch = afterLabel.match(allCapsPattern);
    if (allCapsMatch) {
      matches.push({
        start,
        end: start + allCapsMatch[1].length,
        value: allCapsMatch[1]
      });
      continue;
    }

    // Pattern 2: LAST, FIRST format (Title Case)
    const lastFirstPattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/;
    const lastFirstMatch = afterLabel.match(lastFirstPattern);
    if (lastFirstMatch) {
      matches.push({
        start,
        end: start + lastFirstMatch[1].length,
        value: lastFirstMatch[1]
      });
      continue;
    }

    // Pattern 3: Standard Title Case (with optional title like Dr., Mr.)
    const namePattern = /^((?:Dr|Mr|Ms|Mrs|Miss)\.?\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/;
    const nameMatch = afterLabel.match(namePattern);
    if (nameMatch) {
      // Use actual matched length, not reconstructed
      const matchedText = nameMatch[0];
      matches.push({
        start,
        end: start + matchedText.length,
        value: matchedText.trim()
      });
    }
  }

  return matches;
};

// Secondary validation patterns (broader, more aggressive)
const VALIDATION_PATTERNS = {
  // Catch any remaining capitalized word sequences (potential names) - Title Case
  CAPITALIZED_SEQUENCE: /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g,
  // Catch ALL CAPS name sequences: "JOHN SMITH" or "DOE, JANE"
  ALL_CAPS_SEQUENCE: /\b[A-Z]{2,}(?:,?\s+[A-Z]{2,})+\b/g,
  // Catch LAST, FIRST format: "Smith, John"
  LAST_FIRST_SEQUENCE: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
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

// ALL CAPS terms that are NOT names (medical acronyms, common terms)
const WHITELIST_ACRONYMS = new Set([
  // Medical acronyms
  'CBC', 'MRI', 'CAT', 'EKG', 'ECG', 'EEG', 'EMG', 'ICU', 'CCU', 'NICU', 'PICU', 'ER', 'OR', 'ED',
  'HIV', 'AIDS', 'COVID', 'COPD', 'CHF', 'CAD', 'GERD', 'UTI', 'DVT', 'PE', 'MI', 'CVA', 'TIA',
  'BMI', 'BP', 'HR', 'RR', 'SPO', 'BUN', 'WBC', 'RBC', 'HGB', 'HCT', 'PLT', 'BMP', 'CMP', 'LFT',
  'TSH', 'PSA', 'HBA', 'INR', 'PTT', 'ABG', 'VBG', 'CSF', 'EGD', 'ERCP', 'PET', 'CT', 'US',
  'PRN', 'BID', 'TID', 'QID', 'QHS', 'QAM', 'QPM', 'PO', 'IV', 'IM', 'SQ', 'SL', 'PR', 'TOP',
  'DNR', 'DNI', 'POLST', 'HCP', 'POA', 'LTC', 'SNF', 'ALF', 'ICD', 'CPT', 'DRG', 'ICD', 'HCPCS',
  'STAT', 'ASAP', 'WNL', 'NAD', 'PERRLA', 'ROS', 'HPI', 'PMH', 'PSH', 'FH', 'SH', 'RX', 'DX', 'TX',
  'SOB', 'DOE', 'PND', 'JVD', 'RUQ', 'LUQ', 'RLQ', 'LLQ', 'CVA', 'ROM', 'DTR', 'CN', 'EOM',
  'AMA', 'ADA', 'HIPAA', 'PHI', 'EMR', 'EHR', 'CMS', 'FDA', 'CDC', 'NIH', 'WHO',
  // Common document terms
  'PDF', 'DOC', 'PAGE', 'DATE', 'TIME', 'NOTE', 'NOTES', 'FORM', 'REPORT', 'SUMMARY', 'HISTORY',
  'NAME', 'AGE', 'SEX', 'DOB', 'MRN', 'SSN', 'ZIP', 'FAX', 'TEL', 'EXT',
  'MALE', 'FEMALE', 'YES', 'NO', 'NA', 'N/A', 'TBD', 'NKA', 'NKDA',
  // Section headers
  'SUBJECTIVE', 'OBJECTIVE', 'ASSESSMENT', 'PLAN', 'SOAP', 'IMPRESSION', 'RECOMMENDATION',
  'CHIEF', 'COMPLAINT', 'ALLERGIES', 'MEDICATIONS', 'VITALS', 'EXAM', 'LABS', 'IMAGING',
  'PROCEDURE', 'PROCEDURES', 'SURGERY', 'SURGERIES', 'DIAGNOSIS', 'DIAGNOSES',
  // Other common acronyms
  'USA', 'UK', 'EST', 'PST', 'CST', 'MST', 'UTC', 'GMT', 'AM', 'PM'
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
  detectStandaloneStates,
  PATTERNS,
  VALIDATION_PATTERNS,
  WHITELIST_TERMS,
  WHITELIST_ACRONYMS,
  MRN_CONTEXT_KEYWORDS,
  NAME_LABELS,
  US_STATES
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
   * Scrub PII from text
   * @param text - The text to scrub
   * @param options - Scrubbing options
   * @param options.regexOnly - If true, skip ML model and use only regex patterns (faster, deterministic)
   */
  public async scrub(text: string, options?: { regexOnly?: boolean }): Promise<ScrubResult> {
    const { regexOnly = false } = options || {};

    // Only load ML model if not in regex-only mode
    if (!regexOnly && !this.pipe) await this.loadModel();

    const globalReplacements: PIIMap = {};
    let totalReplacements = 0;

    // Context consistency map
    const entityToPlaceholder: Record<string, string> = {};
    const counters: EntityCounters = { PER: 0, LOC: 0, ORG: 0, EMAIL: 0, PHONE: 0, ID: 0, DATE: 0 };

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
    runRegex('ID', PATTERNS.SSN_PARTIAL, 'SSN');
    runRegex('ID', PATTERNS.CREDIT_CARD, 'CARD');
    runRegex('ID', PATTERNS.ZIPCODE, 'ZIP');
    runRegex('ID', PATTERNS.INSURANCE_ID, 'ID');
    runRegex('DATE', PATTERNS.DATE, 'DATE');
    runRegex('DATE', PATTERNS.DATE_WRITTEN, 'DATE');
    runRegex('DATE', PATTERNS.DATE_WRITTEN_ALT, 'DATE');

    // Age patterns (HIPAA PHI)
    runRegex('DATE', PATTERNS.AGE, 'AGE');
    runRegex('DATE', PATTERNS.AGE_CONTEXT, 'AGE');

    // Address patterns - run BEFORE city/state to catch full addresses
    runRegex('LOC', PATTERNS.ADDRESS, 'ADDR');
    runRegex('LOC', PATTERNS.PO_BOX, 'POBOX');
    runRegex('LOC', PATTERNS.CITY_STATE, 'LOC');

    // Name patterns - catch ALL CAPS and LAST, FIRST formats
    runRegex('PER', PATTERNS.ALL_CAPS_NAME, 'PER');
    runRegex('PER', PATTERNS.LAST_FIRST_NAME, 'PER');
    runRegex('PER', PATTERNS.NAME_APOSTROPHE, 'PER');
    runRegex('PER', PATTERNS.NAME_WITH_SUFFIX, 'PER');

    // Single ALL CAPS words (potential names) - with whitelist check
    const allCapsSinglePattern = PATTERNS.ALL_CAPS_SINGLE;
    interimText = interimText.replace(allCapsSinglePattern, (match) => {
      // Skip if it's a known acronym/medical term
      if (WHITELIST_ACRONYMS.has(match)) return match;
      // Skip if already a placeholder
      if (/^\[[A-Z_]+\d+\]$/.test(match)) return match;

      if (!entityToPlaceholder[match]) {
        counters.PER++;
        const placeholder = `[PER_${counters.PER}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        totalReplacements++;
      }
      return entityToPlaceholder[match];
    });

    // Standalone state abbreviation detection (after addresses to avoid double-matching)
    const stateMatches = detectStandaloneStates(interimText);
    stateMatches.reverse().forEach(({ start, end, value }) => {
      if (!entityToPlaceholder[value]) {
        counters.LOC++;
        const placeholder = `[STATE_${counters.LOC}]`;
        entityToPlaceholder[value] = placeholder;
        globalReplacements[value] = placeholder;
        totalReplacements++;
      }
      interimText = interimText.substring(0, start) + entityToPlaceholder[value] + interimText.substring(end);
    });

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
    // Skip ML inference if regexOnly mode is enabled (for testing/fast scrubbing)
    if (regexOnly) {
      console.log('⚡ Regex-only mode: skipping ML inference');
      const finalScrubbedText = chunks.join('');

      // Run secondary validation pass even in regex-only mode
      // Note: secondaryValidationPass mutates globalReplacements in-place
      const { text: validatedText, additionalCount: _additionalCount } = this.secondaryValidationPass(
        finalScrubbedText,
        entityToPlaceholder,
        counters,
        globalReplacements
      );

      // HIPAA COMPLIANCE: Mark regex-only output as scrubbed
      return {
        text: markAsScrubbed(validatedText),
        replacements: globalReplacements,
        count: Object.keys(globalReplacements).length,
      };
    }

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
        this.pipe!(chunk, {
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
        const { entity_group, word: _word, start, end } = entity as any;
        
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

    const _processingTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Pass 1 (Primary) complete: ${totalReplacements} entities redacted`);

    // --- PHASE 4: SECONDARY VALIDATION PASS ---
    // Catch anything that slipped through with broader patterns
    console.log(`🔍 Running Pass 2 (Validation)...`);
    const { text: validatedText, additionalReplacements: _additionalReplacements, additionalCount } = this.secondaryValidationPass(
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

    // HIPAA COMPLIANCE: Mark output as scrubbed (type-safe)
    // This is the ONLY place ScrubbedText can be created
    const scrubbedOutput = markAsScrubbed(validatedText);

    // Runtime sanity check in development
    if (process.env.NODE_ENV === 'development' && mightContainPII(validatedText)) {
      console.warn('⚠️ PHI LEAK WARNING: Scrubbed output may still contain PII patterns');
    }

    return {
      text: scrubbedOutput,
      replacements: globalReplacements,
      count: totalSecondPassReplacements,
      confidence: validation.confidenceScore
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
    counters: EntityCounters,
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
      const replacements: { start: number; end: number; placeholder: string }[] = [];
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

    // 1b. Catch ALL CAPS name sequences (e.g., "DOE, JANE", "JOHN SMITH")
    const allCapsMatches = validatedText.match(VALIDATION_PATTERNS.ALL_CAPS_SEQUENCE) || [];
    for (const match of allCapsMatches) {
      if (isPlaceholder(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.PER++;
        const placeholder = `[PER_${counters.PER}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
    }

    // 1c. Catch LAST, FIRST format names (e.g., "Smith, John")
    const lastFirstMatches = validatedText.match(VALIDATION_PATTERNS.LAST_FIRST_SEQUENCE) || [];
    for (const match of lastFirstMatches) {
      if (isPlaceholder(match) || isWhitelisted(match)) continue;

      if (!entityToPlaceholder[match]) {
        counters.PER++;
        const placeholder = `[PER_${counters.PER}]`;
        entityToPlaceholder[match] = placeholder;
        globalReplacements[match] = placeholder;
        additionalReplacements[match] = placeholder;
        additionalCount++;
      }
      validatedText = validatedText.replace(new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), entityToPlaceholder[match]);
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
      { pattern: VALIDATION_PATTERNS.ALL_CAPS_SEQUENCE, type: 'ALL CAPS sequence (potential name)' },
      { pattern: VALIDATION_PATTERNS.LAST_FIRST_SEQUENCE, type: 'LAST, FIRST format (potential name)' },
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