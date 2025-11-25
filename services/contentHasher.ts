/**
 * Content-Based Deduplication using SimHash
 * Detects semantic duplicates regardless of filename
 *
 * Types imported from schemas.ts (single source of truth)
 */

import {
  type DocumentFingerprint,
  type DuplicateAnalysis,
  type DifferenceType,
  DocumentType, // Import both type and value
} from '../schemas';

// Re-export for backward compatibility
export type { DocumentFingerprint, DuplicateAnalysis, DifferenceType } from '../schemas';
export { DocumentType };

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
 */
export const generateContentHash = async (text: string): Promise<string> => {
  const normalized = normalizeForHashing(text);
  const msgBuffer = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Simple SimHash implementation for fuzzy duplicate detection
 * Based on: Charikar, "Similarity Estimation Techniques from Rounding Algorithms"
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
 */
export const calculateSimilarity = (hash1: string, hash2: string): number => {
  let distance = 0;
  for (let i = 0; i < Math.min(hash1.length, hash2.length); i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  // Convert to similarity score (0-1)
  return 1 - (distance / 64);
};

/**
 * Extract date references from text for temporal matching
 */
export const extractDates = (text: string): string[] => {
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

/**
 * Detect document type using keyword patterns
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

/**
 * Generate complete fingerprint for a document
 */
export const generateFingerprint = async (
  filename: string,
  scrubbedText: string
): Promise<DocumentFingerprint> => {
  const contentHash = await generateContentHash(scrubbedText);
  const simHash = generateSimHash(scrubbedText);
  const wordCount = scrubbedText.split(/\s+/).length;
  const dateReferences = extractDates(scrubbedText);
  const documentType = detectDocumentType(filename, scrubbedText);

  return {
    contentHash,
    simHash,
    wordCount,
    dateReferences,
    documentType
  };
};

/**
 * Compare two documents for duplication
 * FIXED: Tightened same-event detection to 72-hour window
 */
export const analyzeDuplication = (
  fingerprint1: DocumentFingerprint,
  fingerprint2: DocumentFingerprint,
  date1?: Date,
  date2?: Date
): DuplicateAnalysis => {
  // Exact duplicate
  if (fingerprint1.contentHash === fingerprint2.contentHash) {
    return {
      isDuplicate: true,
      duplicateOf: fingerprint2.contentHash,
      similarity: 1.0,
      differenceType: 'exact'
    };
  }

  // Fuzzy similarity check
  const similarity = calculateSimilarity(fingerprint1.simHash, fingerprint2.simHash);

  // Near-duplicate (95%+ similar)
  if (similarity >= 0.95) {
    return {
      isDuplicate: true,
      duplicateOf: fingerprint2.contentHash,
      similarity,
      differenceType: 'near-duplicate'
    };
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
    return {
      isDuplicate: false,
      duplicateOf: fingerprint2.contentHash,
      similarity,
      differenceType: 'same-event'
    };
  }

  // Unique document
  return {
    isDuplicate: false,
    similarity,
    differenceType: 'unique'
  };
};
