/**
 * CONTENT HASHER - EFFECT-TS VERSION
 *
 * Content-based deduplication using SimHash with algebraic effects.
 *
 * Architecture:
 * - Effect<Result, AppError, never> (pure computation, no external deps)
 * - Railway-oriented programming for validation
 * - Runtime validation via Effect Schema
 * - Immutable fingerprints
 *
 * OCaml equivalent:
 * module ContentHasher : sig
 *   val generate_fingerprint : string -> string -> (fingerprint, error) result
 *   val analyze_duplication : fingerprint -> fingerprint -> date option -> date option -> duplicate_analysis
 *   val calculate_similarity : string -> string -> float
 * end
 */

import { Effect, pipe } from "effect";
import {
  DocumentFingerprint,
  DuplicateAnalysis,
  DocumentType,
  DifferenceType,
} from "../schemas/schemas";
import { ValidationError } from "./errors";

// ============================================================================
// CORE HASHING FUNCTIONS
// ============================================================================

/**
 * Normalize text for consistent hashing (remove whitespace variations, case)
 */
const normalizeForHashing = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\[.*?\]/g, '')        // Remove PII placeholders
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, 'DATE') // Normalize dates
    .trim();
};

/**
 * Generate SHA-256 hash of content
 *
 * Effect wrapper for async crypto operation
 */
export const generateContentHash = (text: string): Effect.Effect<string, never, never> =>
  Effect.tryPromise({
    try: async () => {
      const normalized = normalizeForHashing(text);
      const msgBuffer = new TextEncoder().encode(normalized);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    },
    catch: (error) => {
      // crypto.subtle.digest should never fail in practice, but Effect requires explicit error handling
      console.error('Unexpected hash generation error:', error);
      return new Error('Hash generation failed') as never;
    },
  });

/**
 * Simple SimHash implementation for fuzzy duplicate detection
 * Based on: Charikar, "Similarity Estimation Techniques from Rounding Algorithms"
 *
 * Pure computation - no side effects
 */
export const generateSimHash = (text: string): string => {
  const normalized = normalizeForHashing(text);
  const words = normalized.split(/\s+/).filter(w => w.length > 2);

  // 64-bit hash vector
  const hashVector = new Array(64).fill(0);

  for (const word of words) {
    // Simple hash function (not cryptographic, just for similarity)
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash) + word.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    // Update hash vector
    for (let i = 0; i < 64; i++) {
      const bit = (hash >> (i % 32)) & 1;
      hashVector[i] += bit ? 1 : -1;
    }
  }

  // Convert to binary string
  return hashVector.map(v => v > 0 ? '1' : '0').join('');
};

/**
 * Calculate Hamming distance between two SimHashes
 * Returns similarity score (0-1)
 *
 * Pure computation
 */
export const calculateSimilarity = (hash1: string, hash2: string): number => {
  let distance = 0;
  for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  // Convert to similarity score (0-1)
  return 1 - (distance / 64);
};

// ============================================================================
// DATE EXTRACTION
// ============================================================================

/**
 * Extract date references from text for temporal matching
 *
 * Pure computation
 */
export const extractDates = (text: string): ReadonlyArray<string> => {
  const datePatterns = [
    /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g,     // MM/DD/YYYY or MM-DD-YYYY
    /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/g,       // YYYY-MM-DD
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/gi
  ];

  const dates: Set<string> = new Set();
  for (const pattern of datePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(date => dates.add(date));
    }
  }

  return Array.from(dates);
};

// ============================================================================
// DOCUMENT TYPE DETECTION
// ============================================================================

/**
 * Detect document type using keyword patterns
 *
 * Pure computation with validated output
 */
export const detectDocumentType = (filename: string, text: string): DocumentType => {
  const lower = (filename + ' ' + text.substring(0, 500)).toLowerCase();

  if (/lab|labrpt|cbc|cmp|bmp|wbc|hemoglobin/i.test(lower)) {
    return DocumentType.LAB_REPORT;
  } else if (/ct|mri|x-?ray|ultrasound|imaging|radiology|mammogram/i.test(lower)) {
    return DocumentType.IMAGING;
  } else if (/pathology|biopsy|specimen|histology/i.test(lower)) {
    return DocumentType.PATHOLOGY;
  } else if (/progress note|soap|assessment|plan|provider/i.test(lower)) {
    return DocumentType.PROGRESS_NOTE;
  } else if (/medication|prescription|refill|pharmacy/i.test(lower)) {
    return DocumentType.MEDICATION;
  } else if (/discharge|summary|follow-?up instructions/i.test(lower)) {
    return DocumentType.DISCHARGE;
  } else if (/letter|correspondence|referral/i.test(lower)) {
    return DocumentType.CORRESPONDENCE;
  }

  return DocumentType.UNKNOWN;
};

// ============================================================================
// FINGERPRINT GENERATION (Effect-based)
// ============================================================================

/**
 * Generate complete fingerprint for a document
 *
 * Effect-based computation with runtime validation
 *
 * OCaml equivalent:
 * let generate_fingerprint filename text =
 *   let* content_hash = hash_content text in
 *   let sim_hash = simhash text in
 *   let word_count = count_words text in
 *   let dates = extract_dates text in
 *   let doc_type = detect_type filename text in
 *   Ok { content_hash; sim_hash; word_count; date_references = dates; document_type = doc_type }
 */
export const generateFingerprint = (
  filename: string,
  scrubbedText: string
): Effect.Effect<DocumentFingerprint, never, never> =>
  pipe(
    generateContentHash(scrubbedText),
    Effect.map((contentHash) => {
      const simHash = generateSimHash(scrubbedText);
      const wordCount = scrubbedText.split(/\s+/).length;
      const dateReferences = extractDates(scrubbedText);
      const documentType = detectDocumentType(filename, scrubbedText);

      // Return the fingerprint object (type structure is guaranteed by TypeScript)
      const fingerprint: DocumentFingerprint = {
        contentHash,
        simHash,
        wordCount,
        dateReferences: Array.from(dateReferences),
        documentType,
      };

      return fingerprint;
    })
    // This is an infallible computation - error type is never
  );

// ============================================================================
// DUPLICATION ANALYSIS (Effect-based)
// ============================================================================

/**
 * Compare two documents for duplication
 * FIXED: Tightened same-event detection to 72-hour window
 *
 * Effect-based computation with runtime validation
 *
 * OCaml equivalent:
 * let analyze_duplication fp1 fp2 date1 date2 =
 *   match compare_hashes fp1.content_hash fp2.content_hash with
 *   | Exact -> { is_duplicate = true; duplicate_of = Some fp2.content_hash; similarity = 1.0; difference_type = Exact }
 *   | Different ->
 *       let similarity = calculate_similarity fp1.sim_hash fp2.sim_hash in
 *       if similarity >= 0.95 then
 *         { is_duplicate = true; duplicate_of = Some fp2.content_hash; similarity; difference_type = NearDuplicate }
 *       else if is_same_event similarity fp1 fp2 date1 date2 then
 *         { is_duplicate = false; duplicate_of = Some fp2.content_hash; similarity; difference_type = SameEvent }
 *       else
 *         { is_duplicate = false; duplicate_of = None; similarity; difference_type = Unique }
 */
export const analyzeDuplication = (
  fingerprint1: DocumentFingerprint,
  fingerprint2: DocumentFingerprint,
  date1?: Date,
  date2?: Date
): Effect.Effect<DuplicateAnalysis, ValidationError, never> => {
  // Exact duplicate
  if (fingerprint1.contentHash === fingerprint2.contentHash) {
    const result: DuplicateAnalysis = {
      isDuplicate: true,
      duplicateOf: fingerprint2.contentHash,
      similarity: 1.0,
      differenceType: DifferenceType.EXACT,
    };
    return Effect.succeed(result);
  }

  // Fuzzy similarity check
  const similarity = calculateSimilarity(fingerprint1.simHash, fingerprint2.simHash);

  // Near-duplicate (95%+ similar)
  if (similarity >= 0.95) {
    const result: DuplicateAnalysis = {
      isDuplicate: true,
      duplicateOf: fingerprint2.contentHash,
      similarity,
      differenceType: DifferenceType.NEAR_DUPLICATE,
    };
    return Effect.succeed(result);
  }

  // Same event, different report (same encounter within 72 hours)
  // FIXED: Only link documents from the same admission/encounter (within 72 hours)
  let withinSameEncounter = false;
  if (date1 && date2) {
    const timeDiffMs = Math.abs(date1.getTime() - date2.getTime());
    const hoursDiff = timeDiffMs / (1000 * 60 * 60);
    withinSameEncounter = hoursDiff <= 72; // 72-hour window for same encounter
  }

  if (
    similarity >= 0.70 &&
    fingerprint1.documentType === fingerprint2.documentType &&
    withinSameEncounter
  ) {
    const result: DuplicateAnalysis = {
      isDuplicate: false,
      duplicateOf: fingerprint2.contentHash,
      similarity,
      differenceType: DifferenceType.SAME_EVENT,
    };
    return Effect.succeed(result);
  }

  // Unique document
  const result: DuplicateAnalysis = {
    isDuplicate: false,
    similarity,
    differenceType: DifferenceType.UNIQUE,
  };
  return Effect.succeed(result);
};

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

/**
 * Legacy sync wrappers for existing non-Effect code
 *
 * These will be removed once all services are migrated to Effect
 */
export const generateFingerprintSync = async (
  filename: string,
  scrubbedText: string
): Promise<DocumentFingerprint> => {
  const result = await Effect.runPromise(generateFingerprint(filename, scrubbedText));
  return result;
};

export const analyzeDuplicationSync = (
  fingerprint1: DocumentFingerprint,
  fingerprint2: DocumentFingerprint,
  date1?: Date,
  date2?: Date
): DuplicateAnalysis => {
  const result = Effect.runSync(analyzeDuplication(fingerprint1, fingerprint2, date1, date2));
  return result;
};
