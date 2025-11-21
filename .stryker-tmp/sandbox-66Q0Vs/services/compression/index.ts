/**
 * COMPRESSION SYSTEM - PUBLIC API
 *
 * Export everything needed to use the compression pipeline.
 */
// @ts-nocheck


// Schema (types + validation)
export type {
  TimelineEventType,
  ConfidenceLevel,
  DateRange,
  TimelineEntry,
  VisitEvent,
  LabResultEvent,
  MedicationChangeEvent,
  LabTrend,
  LabTrendPoint,
  Medication,
  MedicationSummary,
  PatientDemographics,
  CompressionOptions,
  CompressionMetadata,
  CompressedTimeline,
  YAMLMetadata,
  YAMLOutput,
} from "./schema";

export {
  TimelineEventTypeSchema,
  ConfidenceLevelSchema,
  DateRangeSchema,
  TimelineEntrySchema,
  VisitEventSchema,
  LabResultEventSchema,
  MedicationChangeEventSchema,
  LabTrendSchema,
  LabTrendPointSchema,
  MedicationSchema,
  MedicationSummarySchema,
  PatientDemographicsSchema,
  CompressionOptionsSchema,
  CompressionMetadataSchema,
  CompressedTimelineSchema,
  YAMLMetadataSchema,
  YAMLOutputSchema,
  defaultCompressionOptions,
  decode,
  encode,
} from "./schema";

// Errors
export type { BaseError, CompressionError, ErrorRecord } from "./errors";

export {
  ParseError,
  ValidationError,
  DateAmbiguityError,
  OCRWarning,
  DeduplicationError,
  CompressionSizeExceededError,
  FileSystemError,
  ErrorCollector,
  ErrorRecordSchema,
  toErrorRecord,
} from "./errors";

// Engine
export type {
  ProcessedDocument,
  CompressionProgress,
  ProgressCallback,
} from "./engine";

export { compressTimeline, runCompression } from "./engine";

// YAML generation
export {
  generateYAML,
  generateYAMLFromResult,
  estimateYAMLSize,
} from "./yaml";
