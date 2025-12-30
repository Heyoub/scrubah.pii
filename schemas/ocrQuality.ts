/**
 * OCR QUALITY SCHEMA - FIRST CLASS METADATA
 *
 * Quality scoring and routing for OCR-processed documents.
 * Used to gate downstream processing and flag documents needing review.
 *
 * Philosophy:
 * - Quality metadata is a first-class citizen, not an afterthought
 * - Score + flags + regions enable smart routing decisions
 * - Low-confidence regions can be targeted for TrOCR repair
 */

import { Schema as S } from "effect";

// ============================================================================
// BOUNDING BOX (for low-confidence regions)
// ============================================================================

export const BoundingBoxSchema = S.Struct({
  x: S.Number,
  y: S.Number,
  width: S.Number,
  height: S.Number,
});
export type BoundingBox = S.Schema.Type<typeof BoundingBoxSchema>;

// ============================================================================
// OCR WORD (word-level Tesseract output)
// ============================================================================

export const OCRWordSchema = S.Struct({
  text: S.String,
  confidence: S.Number, // 0-100 from Tesseract
  bbox: BoundingBoxSchema,
  isGarbage: S.optional(S.Boolean), // detected as garbage token
});
export type OCRWord = S.Schema.Type<typeof OCRWordSchema>;

// ============================================================================
// OCR QUALITY FLAGS (discriminated union for issues)
// ============================================================================

export const OCRQualityFlagSchema = S.Union(
  S.Literal("LOW_CONFIDENCE"),      // median confidence < threshold
  S.Literal("HIGH_GARBAGE_DENSITY"), // too many garbage tokens (%%%%, ||||)
  S.Literal("LOW_ALPHA_RATIO"),      // not enough actual letters
  S.Literal("SPARSE_TEXT"),          // very little text extracted
  S.Literal("OCR_RECOVERY_MARKER"),  // contains [OCR_RECOVERED_PAGE_X]
  S.Literal("TROCR_REPAIRED"),       // was repaired by TrOCR
  S.Literal("NEEDS_MANUAL_REVIEW")   // flagged for human review
);
export type OCRQualityFlag = S.Schema.Type<typeof OCRQualityFlagSchema>;

// ============================================================================
// OCR QUALITY LEVEL (routing decision)
// ============================================================================

export const OCRQualityLevelSchema = S.Union(
  S.Literal("HIGH"),    // score > 0.7 - proceed normally
  S.Literal("MEDIUM"),  // score 0.4-0.7 - proceed but flag for review
  S.Literal("LOW")      // score < 0.4 - attempt repair or skip extraction
);
export type OCRQualityLevel = S.Schema.Type<typeof OCRQualityLevelSchema>;

// ============================================================================
// LOW CONFIDENCE REGION (for targeted TrOCR repair)
// ============================================================================

export const LowConfidenceRegionSchema = S.Struct({
  bbox: BoundingBoxSchema,
  originalText: S.String,
  confidence: S.Number,
  wordCount: S.Int,
  repairedText: S.optional(S.String), // populated after TrOCR repair
});
export type LowConfidenceRegion = S.Schema.Type<typeof LowConfidenceRegionSchema>;

// ============================================================================
// OCR QUALITY METRICS (detailed breakdown)
// ============================================================================

export const OCRQualityMetricsSchema = S.Struct({
  // Core metrics
  medianWordConfidence: S.Number,     // 0-100
  meanWordConfidence: S.Number,       // 0-100
  minWordConfidence: S.Number,        // 0-100

  // Character analysis
  alphaRatio: S.Number,               // 0-1, ratio of letters to total chars
  digitRatio: S.Number,               // 0-1, ratio of digits (expected in medical)
  punctuationRatio: S.Number,         // 0-1, high = possible garbage

  // Token analysis
  totalWords: S.Int,
  garbageTokenCount: S.Int,           // %%%%, ||||, etc.
  garbageTokenRatio: S.Number,        // 0-1

  // Density
  charsPerPage: S.Int,
  wordsPerPage: S.Int,
});
export type OCRQualityMetrics = S.Schema.Type<typeof OCRQualityMetricsSchema>;

// ============================================================================
// OCR QUALITY RESULT (main output type)
// ============================================================================

export const OCRQualityResultSchema = S.Struct({
  // Overall score (0-1)
  score: S.Number,

  // Routing decision
  level: OCRQualityLevelSchema,

  // Detailed metrics
  metrics: OCRQualityMetricsSchema,

  // Issue flags
  flags: S.Array(OCRQualityFlagSchema),

  // Low-confidence regions for potential TrOCR repair
  lowConfidenceRegions: S.Array(LowConfidenceRegionSchema),

  // Processing metadata
  pageNumber: S.optional(S.Int),
  processingTimeMs: S.optional(S.Int),
  trOCRApplied: S.optional(S.Boolean),
});
export type OCRQualityResult = S.Schema.Type<typeof OCRQualityResultSchema>;

// ============================================================================
// OCR QUALITY CONFIG (tunable thresholds)
// ============================================================================

export const OCRQualityConfigSchema = S.Struct({
  // Score thresholds for routing
  highQualityThreshold: S.Number,     // default 0.7
  lowQualityThreshold: S.Number,      // default 0.4

  // Word confidence thresholds
  wordConfidenceThreshold: S.Number,  // default 60 (Tesseract 0-100)

  // Garbage detection
  maxGarbageRatio: S.Number,          // default 0.15
  minAlphaRatio: S.Number,            // default 0.5

  // TrOCR settings
  enableTrOCR: S.Boolean,             // default true
  trOCRConfidenceThreshold: S.Number, // default 50 - repair words below this
  maxRegionsToRepair: S.Int,          // default 10 - limit TrOCR calls
});
export type OCRQualityConfig = S.Schema.Type<typeof OCRQualityConfigSchema>;

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const defaultOCRQualityConfig: OCRQualityConfig = {
  highQualityThreshold: 0.7,
  lowQualityThreshold: 0.4,
  wordConfidenceThreshold: 60,
  maxGarbageRatio: 0.15,
  minAlphaRatio: 0.5,
  enableTrOCR: true,
  trOCRConfidenceThreshold: 50,
  maxRegionsToRepair: 10,
};

// ============================================================================
// GARBAGE TOKEN PATTERNS
// ============================================================================

export const GARBAGE_PATTERNS = [
  /^[%]{3,}$/,           // %%%%
  /^[|]{3,}$/,           // ||||
  /^[_]{3,}$/,           // ____
  /^[=]{3,}$/,           // ====
  /^[.]{4,}$/,           // .....
  /^[-]{4,}$/,           // ----
  /^[~]{3,}$/,           // ~~~~
  /^[*]{3,}$/,           // ****
  /^[#]{3,}$/,           // ####
  /^[\W]{4,}$/,          // any 4+ non-word chars
  /^[^\w\s]{3,}$/,       // 3+ special chars only
] as const;

/**
 * Check if a word is garbage
 */
export const isGarbageToken = (word: string): boolean => {
  const trimmed = word.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length === 1 && !/[a-zA-Z0-9]/.test(trimmed)) return true;
  return GARBAGE_PATTERNS.some(pattern => pattern.test(trimmed));
};
