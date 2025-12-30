/**
 * TEMPLATE DETECTION SCHEMA - N-GRAM FINGERPRINTING
 *
 * Detects and strips repeated boilerplate across medical documents:
 * - Hospital headers/footers (appears on every page)
 * - Lab director signatures (same on every lab report)
 * - Patient demographics blocks (repeated across all docs)
 * - Medication list templates (duplicated in progress notes)
 *
 * Algorithm:
 * 1. Extract n-grams (line sequences) from each document
 * 2. Hash n-grams to fingerprints
 * 3. Count fingerprint frequency across corpus
 * 4. Fingerprints appearing in >threshold% of docs = templates
 * 5. Store templates once, strip from documents, keep deltas
 */

import { Schema as S } from "effect";

// ============================================================================
// N-GRAM CONFIGURATION
// ============================================================================

export const NGramConfigSchema = S.Struct({
  // N-gram sizes to extract (lines)
  minNgramSize: S.Int, // default 2 (pairs of lines)
  maxNgramSize: S.Int, // default 5 (up to 5 lines)

  // Frequency thresholds
  templateThreshold: S.Number, // default 0.3 (30% of docs = template)
  rareThreshold: S.Number, // default 0.05 (5% = unique content)

  // Preprocessing
  normalizeWhitespace: S.Boolean, // collapse multiple spaces
  lowercaseForMatching: S.Boolean, // case-insensitive matching
  stripNumbers: S.Boolean, // ignore numbers (dates, values vary)

  // Performance
  maxDocumentsToSample: S.Int, // limit for large corpora
  minDocumentsForTemplate: S.Int, // need at least N docs to detect templates
});
export type NGramConfig = S.Schema.Type<typeof NGramConfigSchema>;

export const defaultNGramConfig: NGramConfig = {
  minNgramSize: 2,
  maxNgramSize: 5,
  templateThreshold: 0.3,
  rareThreshold: 0.05,
  normalizeWhitespace: true,
  lowercaseForMatching: true,
  stripNumbers: false, // keep numbers for medical data
  maxDocumentsToSample: 500,
  minDocumentsForTemplate: 3,
};

// ============================================================================
// FINGERPRINT (hash of n-gram content)
// ============================================================================

export const FingerprintSchema = S.Struct({
  hash: S.String, // 64-bit hash as hex string
  ngramSize: S.Int, // how many lines this fingerprint spans
  lineStart: S.Int, // starting line index in original doc
  documentId: S.String, // which document this came from
});
export type Fingerprint = S.Schema.Type<typeof FingerprintSchema>;

// ============================================================================
// TEMPLATE (detected repeated content)
// ============================================================================

export const TemplateTypeSchema = S.Union(
  S.Literal("HEADER"), // top of document
  S.Literal("FOOTER"), // bottom of document
  S.Literal("DEMOGRAPHICS"), // patient info block
  S.Literal("SIGNATURE"), // provider signature block
  S.Literal("MEDICATION_LIST"), // repeated med list
  S.Literal("BOILERPLATE"), // generic repeated text
  S.Literal("LEGAL"), // legal disclaimers
  S.Literal("UNKNOWN") // unclassified
);
export type TemplateType = S.Schema.Type<typeof TemplateTypeSchema>;

export const DetectedTemplateSchema = S.Struct({
  id: S.String, // unique template ID
  hash: S.String, // fingerprint hash
  content: S.String, // actual text content
  lineCount: S.Int, // number of lines
  charCount: S.Int, // character count

  // Classification
  type: TemplateTypeSchema,
  position: S.Union(S.Literal("START"), S.Literal("END"), S.Literal("MIDDLE")),

  // Frequency stats
  documentCount: S.Int, // how many docs contain this
  frequency: S.Number, // percentage of corpus (0-1)

  // Metadata
  firstSeenDocId: S.String, // first document where found
  exampleContext: S.optional(S.String), // surrounding context for debugging
});
export type DetectedTemplate = S.Schema.Type<typeof DetectedTemplateSchema>;

// ============================================================================
// DOCUMENT DELTA (what's left after template removal)
// ============================================================================

export const DocumentDeltaSchema = S.Struct({
  documentId: S.String,
  originalCharCount: S.Int,
  deltaCharCount: S.Int,
  compressionRatio: S.Number, // delta/original (lower = more compressed)

  // Template references (instead of storing content)
  templateRefs: S.Array(
    S.Struct({
      templateId: S.String,
      lineStart: S.Int,
      lineEnd: S.Int,
    })
  ),

  // Unique content (the delta)
  uniqueContent: S.String,
  uniqueLines: S.Array(
    S.Struct({
      lineNumber: S.Int,
      content: S.String,
    })
  ),
});
export type DocumentDelta = S.Schema.Type<typeof DocumentDeltaSchema>;

// ============================================================================
// TEMPLATE CORPUS (collection of all detected templates)
// ============================================================================

export const TemplateCorpusSchema = S.Struct({
  // All detected templates
  templates: S.Array(DetectedTemplateSchema),

  // Stats
  totalDocuments: S.Int,
  totalTemplatesDetected: S.Int,
  averageCompressionRatio: S.Number,

  // Processing metadata
  configUsed: NGramConfigSchema,
  processingTimeMs: S.Int,
  createdAt: S.String, // ISO timestamp
});
export type TemplateCorpus = S.Schema.Type<typeof TemplateCorpusSchema>;

// ============================================================================
// TEMPLATE DETECTION RESULT (per-document)
// ============================================================================

export const TemplateDetectionResultSchema = S.Struct({
  documentId: S.String,

  // Templates found in this document
  matchedTemplates: S.Array(
    S.Struct({
      templateId: S.String,
      lineStart: S.Int,
      lineEnd: S.Int,
      confidence: S.Number, // match confidence (1.0 = exact)
    })
  ),

  // Delta (unique content)
  delta: DocumentDeltaSchema,

  // Metrics
  originalSize: S.Int,
  compressedSize: S.Int,
  templateCoverage: S.Number, // % of doc that was template (0-1)
});
export type TemplateDetectionResult = S.Schema.Type<
  typeof TemplateDetectionResultSchema
>;

// ============================================================================
// COMMON MEDICAL TEMPLATE PATTERNS (for classification)
// ============================================================================

export const HEADER_PATTERNS = [
  /^patient\s*(name|id|mrn)/i,
  /^(date|dob|age|sex|gender)/i,
  /^(medical\s*record|chart|account)\s*#?/i,
  /^(hospital|clinic|facility)\s*name/i,
  /^(encounter|visit|admission)\s*(date|type)/i,
] as const;

export const FOOTER_PATTERNS = [
  /^(page|pg\.?)\s*\d+\s*(of|\/)\s*\d+/i,
  /^(printed|generated|report\s*date)/i,
  /^(clia|cap|laboratory)\s*(#|number|id)/i,
  /^(medical|lab)\s*director/i,
  /^(confidential|hipaa|privacy)/i,
  /^\*{3,}|^-{3,}|^={3,}/, // separator lines
] as const;

export const SIGNATURE_PATTERNS = [
  /^(electronically\s*signed|e-?signed)/i,
  /^(signed|authenticated)\s*by/i,
  /^(provider|physician|doctor|md|do|np|pa)/i,
  /^(signature|sign)\s*on\s*file/i,
] as const;

export const LEGAL_PATTERNS = [
  /^(this\s*(report|document|record)\s*is)/i,
  /^(confidential|protected\s*health)/i,
  /^(not\s*for\s*(distribution|release))/i,
  /^(fax|copy)\s*to:/i,
] as const;

/**
 * Classify template type based on content patterns
 */
export const classifyTemplateType = (
  content: string,
  position: "START" | "END" | "MIDDLE"
): TemplateType => {
  const lines = content.split("\n").slice(0, 3); // Check first 3 lines
  const sample = lines.join(" ").toLowerCase();

  if (HEADER_PATTERNS.some((p) => p.test(sample))) return "HEADER";
  if (FOOTER_PATTERNS.some((p) => p.test(sample))) return "FOOTER";
  if (SIGNATURE_PATTERNS.some((p) => p.test(sample))) return "SIGNATURE";
  if (LEGAL_PATTERNS.some((p) => p.test(sample))) return "LEGAL";

  // Position-based fallback
  if (position === "START") return "HEADER";
  if (position === "END") return "FOOTER";

  // Check for medication list patterns
  if (/\b(mg|mcg|ml|tablet|capsule|bid|tid|qid|prn)\b/i.test(sample)) {
    return "MEDICATION_LIST";
  }

  // Check for demographics
  if (/\b(dob|mrn|ssn|address|phone|insurance)\b/i.test(sample)) {
    return "DEMOGRAPHICS";
  }

  return "BOILERPLATE";
};

// ============================================================================
// HASHING UTILITIES
// ============================================================================

/**
 * Fast non-cryptographic hash (FNV-1a 64-bit)
 * Good for fingerprinting, not for security
 */
export const fnv1aHash = (str: string): string => {
  // FNV-1a parameters for 64-bit
  // Using BigInt for 64-bit precision
  const FNV_PRIME = BigInt("0x00000100000001B3");
  const FNV_OFFSET = BigInt("0xcbf29ce484222325");

  let hash = FNV_OFFSET;

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * FNV_PRIME);
  }

  return hash.toString(16).padStart(16, "0");
};

/**
 * Normalize text for fingerprinting
 */
export const normalizeForFingerprint = (
  text: string,
  config: Pick<
    NGramConfig,
    "normalizeWhitespace" | "lowercaseForMatching" | "stripNumbers"
  >
): string => {
  let normalized = text;

  if (config.normalizeWhitespace) {
    normalized = normalized.replace(/\s+/g, " ").trim();
  }

  if (config.lowercaseForMatching) {
    normalized = normalized.toLowerCase();
  }

  if (config.stripNumbers) {
    // Replace numbers with placeholder (keeps structure)
    normalized = normalized.replace(/\d+/g, "#");
  }

  return normalized;
};

/**
 * Extract n-grams from document lines
 */
export const extractNGrams = (
  lines: string[],
  documentId: string,
  config: NGramConfig
): Fingerprint[] => {
  const fingerprints: Fingerprint[] = [];

  for (let size = config.minNgramSize; size <= config.maxNgramSize; size++) {
    for (let i = 0; i <= lines.length - size; i++) {
      const ngramLines = lines.slice(i, i + size);
      const normalizedContent = ngramLines
        .map((line) => normalizeForFingerprint(line, config))
        .join("\n");

      // Skip empty or near-empty n-grams
      if (normalizedContent.replace(/\s/g, "").length < 10) continue;

      const hash = fnv1aHash(normalizedContent);

      fingerprints.push({
        hash,
        ngramSize: size,
        lineStart: i,
        documentId,
      });
    }
  }

  return fingerprints;
};
