/**
 * COMPRESSION PIPELINE SCHEMA
 *
 * Unified pipeline that combines all compression stages:
 * 1. OCR Quality Gate - Filter low-quality scans
 * 2. Template Detection - Strip boilerplate content
 * 3. Semantic Deduplication - Remove similar documents
 * 4. Structured Extraction - Extract clinical data
 * 5. Narrative Generation - Generate summaries
 *
 * Design principles:
 * - Configurable stages (enable/disable each)
 * - Progress tracking
 * - Comprehensive metrics
 * - Error resilience (continue on partial failures)
 */

import { Schema as S } from "effect";

// ============================================================================
// PIPELINE CONFIGURATION
// ============================================================================

export const PipelineStageSchema = S.Union(
  S.Literal("OCR_QUALITY"),
  S.Literal("TEMPLATE_DETECTION"),
  S.Literal("SEMANTIC_DEDUP"),
  S.Literal("STRUCTURED_EXTRACTION"),
  S.Literal("NARRATIVE_GENERATION")
);
export type PipelineStage = S.Schema.Type<typeof PipelineStageSchema>;

export const PipelineConfigSchema = S.Struct({
  // Stage enablement
  enableOcrQuality: S.Boolean,
  enableTemplateDetection: S.Boolean,
  enableSemanticDedup: S.Boolean,
  enableStructuredExtraction: S.Boolean,
  enableNarrativeGeneration: S.Boolean,

  // OCR Quality settings
  ocrMinQuality: S.Number, // 0-1, skip docs below this
  ocrWarnThreshold: S.Number, // flag docs below this

  // Template Detection settings
  templateMinFrequency: S.Int, // min occurrences to be template
  templateNgramSize: S.Int, // n-gram size for fingerprinting

  // Semantic Dedup settings
  dedupSimilarityThreshold: S.Number, // 0-1, docs above this are similar
  dedupNearDuplicateThreshold: S.Number, // 0-1, docs above this are duplicates

  // Structured Extraction settings
  extractMinConfidence: S.Number, // 0-1, skip extractions below this

  // Narrative Generation settings
  narrativeVerbosity: S.Union(
    S.Literal("MINIMAL"),
    S.Literal("BRIEF"),
    S.Literal("STANDARD"),
    S.Literal("DETAILED")
  ),

  // Error handling
  continueOnError: S.Boolean, // continue pipeline on stage failures
  maxRetries: S.Int, // retries per stage

  // Performance
  batchSize: S.Int, // documents per batch
  concurrency: S.Int, // parallel processing limit
});
export type PipelineConfig = S.Schema.Type<typeof PipelineConfigSchema>;

export const defaultPipelineConfig: PipelineConfig = {
  enableOcrQuality: true,
  enableTemplateDetection: true,
  enableSemanticDedup: true,
  enableStructuredExtraction: true,
  enableNarrativeGeneration: true,

  ocrMinQuality: 0.3,
  ocrWarnThreshold: 0.6,

  templateMinFrequency: 3,
  templateNgramSize: 5,

  dedupSimilarityThreshold: 0.85,
  dedupNearDuplicateThreshold: 0.95,

  extractMinConfidence: 0.5,

  narrativeVerbosity: "STANDARD",

  continueOnError: true,
  maxRetries: 2,

  batchSize: 50,
  concurrency: 10,
};

// ============================================================================
// DOCUMENT INPUT
// ============================================================================

export const PipelineDocumentSchema = S.Struct({
  id: S.String,
  content: S.String,
  metadata: S.optional(
    S.Struct({
      filename: S.optional(S.String),
      date: S.optional(S.String),
      type: S.optional(S.String),
      source: S.optional(S.String),
    })
  ),
});
export type PipelineDocument = S.Schema.Type<typeof PipelineDocumentSchema>;

// ============================================================================
// STAGE RESULTS
// ============================================================================

export const StageStatusSchema = S.Union(
  S.Literal("PENDING"),
  S.Literal("RUNNING"),
  S.Literal("COMPLETED"),
  S.Literal("SKIPPED"),
  S.Literal("FAILED")
);
export type StageStatus = S.Schema.Type<typeof StageStatusSchema>;

export const StageResultSchema = S.Struct({
  stage: PipelineStageSchema,
  status: StageStatusSchema,
  inputCount: S.Int,
  outputCount: S.Int,
  filteredCount: S.Int, // docs removed at this stage
  processingTimeMs: S.Int,
  error: S.optional(S.String),
});
export type StageResult = S.Schema.Type<typeof StageResultSchema>;

// ============================================================================
// DOCUMENT RESULT
// ============================================================================

export const DocumentResultSchema = S.Struct({
  documentId: S.String,
  originalCharCount: S.Int,
  finalCharCount: S.Int,

  // Stage outcomes
  ocrQualityScore: S.optional(S.Number),
  ocrPassed: S.optional(S.Boolean),

  templateStripped: S.optional(S.Boolean),
  templateCharsRemoved: S.optional(S.Int),

  isDuplicate: S.optional(S.Boolean),
  duplicateOf: S.optional(S.String), // ID of representative if duplicate

  extractionCount: S.optional(S.Int),

  narrativeGenerated: S.optional(S.Boolean),
  narrativeCharCount: S.optional(S.Int),

  // Final content
  processedContent: S.String,
  narrative: S.optional(S.String),

  // Metadata
  processingTimeMs: S.Int,
  warnings: S.Array(S.String),
});
export type DocumentResult = S.Schema.Type<typeof DocumentResultSchema>;

// ============================================================================
// PIPELINE RESULT
// ============================================================================

export const PipelineResultSchema = S.Struct({
  // Document results
  documents: S.Array(DocumentResultSchema),
  documentCount: S.Int,
  successCount: S.Int,
  failedCount: S.Int,

  // Stage results
  stages: S.Array(StageResultSchema),

  // Compression metrics
  totalInputChars: S.Int,
  totalOutputChars: S.Int,
  totalNarrativeChars: S.Int,
  compressionRatio: S.Number, // 1 - (output/input)

  // Filtering metrics
  ocrFilteredCount: S.Int,
  templateCharsRemoved: S.Int,
  duplicatesRemoved: S.Int,

  // Extraction metrics
  totalExtractions: S.Int,
  diagnosisCount: S.Int,
  medicationCount: S.Int,
  labCount: S.Int,
  abnormalLabCount: S.Int,

  // Performance
  totalProcessingTimeMs: S.Int,
  avgTimePerDocument: S.Number,

  // Configuration used
  config: PipelineConfigSchema,
});
export type PipelineResult = S.Schema.Type<typeof PipelineResultSchema>;

// ============================================================================
// PROGRESS CALLBACK
// ============================================================================

export interface PipelineProgress {
  stage: PipelineStage;
  stageIndex: number;
  totalStages: number;
  documentIndex: number;
  totalDocuments: number;
  percentComplete: number;
  currentDocument?: string;
  message?: string;
}

export type ProgressCallback = (progress: PipelineProgress) => void;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get enabled stages in order
 */
export const getEnabledStages = (config: PipelineConfig): PipelineStage[] => {
  const stages: PipelineStage[] = [];
  if (config.enableOcrQuality) stages.push("OCR_QUALITY");
  if (config.enableTemplateDetection) stages.push("TEMPLATE_DETECTION");
  if (config.enableSemanticDedup) stages.push("SEMANTIC_DEDUP");
  if (config.enableStructuredExtraction) stages.push("STRUCTURED_EXTRACTION");
  if (config.enableNarrativeGeneration) stages.push("NARRATIVE_GENERATION");
  return stages;
};

/**
 * Calculate overall compression
 */
export const calculateOverallCompression = (
  inputChars: number,
  outputChars: number,
  narrativeChars: number
): number => {
  if (inputChars === 0) return 0;
  // Final output is narrative if generated, otherwise processed content
  const finalChars = narrativeChars > 0 ? narrativeChars : outputChars;
  return 1 - finalChars / inputChars;
};

/**
 * Stage display names
 */
export const stageDisplayNames: Record<PipelineStage, string> = {
  OCR_QUALITY: "OCR Quality Gate",
  TEMPLATE_DETECTION: "Template Detection",
  SEMANTIC_DEDUP: "Semantic Deduplication",
  STRUCTURED_EXTRACTION: "Structured Extraction",
  NARRATIVE_GENERATION: "Narrative Generation",
};

/**
 * Format compression ratio for display
 */
export const formatCompression = (ratio: number): string => {
  return `${(ratio * 100).toFixed(1)}%`;
};
