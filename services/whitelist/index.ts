/**
 * MEDICAL DATA EXTRACTION - PUBLIC API
 * 
 * Whitelist-based medical data extraction for HIPAA-compliant processing.
 * 
 * Usage:
 * ```typescript
 * import { 
 *   extractMedicalData,
 *   runExtractionPipeline,
 *   buildMasterTimelineV2 
 * } from './medical-extractor';
 * ```
 */

// Schemas
export * from "../../schemas/index";

// Errors
export * from "./services/extractionErrors";

// Core extraction
export { 
  extractMedicalData,
  extractMedicalDataSync,
  type ExtractionInput,
} from "./services/medicalExtractor.effect";

// Timeline formatting
export {
  formatMedicalTimeline,
  formatMedicalTimelineSync,
  type FormatTimelineInput,
} from "./services/timelineFormatter.effect";

// Integration pipeline
export {
  extractBatch,
  extractBatchSync,
  runExtractionPipeline,
  runExtractionPipelineSync,
  buildMasterTimelineV2,
  buildMasterTimelineV2Sync,
  type DocumentInput,
  type BatchExtractionResult,
  type PipelineInput,
  type PipelineResult,
  type LegacyProcessedFile,
  type LegacyTimelineResult,
} from "./services/extractionPipeline.effect";
