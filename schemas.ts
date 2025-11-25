/**
 * GLOBAL SCHEMAS - SINGLE SOURCE OF TRUTH
 *
 * All types derive from these Effect Schemas.
 * OCaml-style: Runtime validation IS the type system.
 *
 * Philosophy:
 * - Schemas define both types AND validation (like OCaml's module signatures)
 * - Parse, don't validate (Railway-oriented programming)
 * - Make invalid states unrepresentable (algebraic data types)
 * - Exhaustive pattern matching via discriminated unions
 */

import { Schema as S, pipe } from "effect";
import type { ScrubbedText } from "./schemas/phi";

/**
 * PROCESSING STAGE (Variant Type - like OCaml)
 *
 * OCaml equivalent:
 * type processing_stage =
 *   | Queued
 *   | Parsing
 *   | Scrubbing
 *   | Formatting
 *   | Completed
 *   | Error
 */
export const ProcessingStageSchema = S.Literal(
  "QUEUED",
  "PARSING",
  "SCRUBBING",
  "FORMATTING",
  "COMPLETED",
  "ERROR"
);
export type ProcessingStage = S.Schema.Type<typeof ProcessingStageSchema>;

/**
 * PII MAP (Record Type - string -> string mapping)
 *
 * OCaml equivalent:
 * type pii_map = (string * string) list
 */
export const PIIMapSchema = S.Record({
  key: S.String,
  value: S.String
});
export type PIIMap = S.Schema.Type<typeof PIIMapSchema>;

// Mutable version for service implementations
export interface MutablePIIMap {
  [key: string]: string;
}

/**
 * SCRUB RESULT (Record Type with constraints)
 *
 * OCaml equivalent:
 * type scrub_result = {
 *   text: string;
 *   replacements: pii_map;
 *   count: int;
 * }
 *
 * Invariant: count = Map.length replacements
 */
export const ScrubResultSchema = pipe(
  S.Struct({
    text: S.String,
    replacements: PIIMapSchema,
    count: S.Int,
    confidence: S.optional(pipe(S.Number, S.greaterThanOrEqualTo(0), S.lessThanOrEqualTo(100))),
  }),
  S.filter(
    (result) => {
      const actualCount = Object.keys(result.replacements).length;
      return result.count === actualCount;
    },
    {
      message: () => "Scrub count must match replacements map size",
    }
  )
);

// Override to use branded ScrubbedText type for HIPAA compliance
export interface ScrubResult {
  readonly text: ScrubbedText;
  readonly replacements: MutablePIIMap;
  readonly count: number;
  readonly confidence?: number;
}

/**
 * PROCESSING STATS (Optional nested record)
 *
 * OCaml equivalent:
 * type processing_stats = {
 *   pii_removed_count: int;
 *   processing_time_ms: int;
 * }
 */
export const ProcessingStatsSchema = S.Struct({
  piiRemovedCount: S.Int,
  processingTimeMs: S.Int,
});
export type ProcessingStats = S.Schema.Type<typeof ProcessingStatsSchema>;

/**
 * PROCESSED FILE (Sum Type with state machine)
 *
 * OCaml equivalent:
 * type processed_file = {
 *   id: string;
 *   original_name: string;
 *   size: int;
 *   file_type: string;
 *   stage: processing_stage;
 *   raw_text: string option;
 *   scrubbed_text: string option;
 *   markdown: string option;
 *   error: string option;
 *   stats: processing_stats option;
 * }
 *
 * State Machine Invariants:
 * - QUEUED: no text yet
 * - PARSING: may have rawText
 * - SCRUBBING: must have rawText, may have scrubbedText
 * - FORMATTING: must have scrubbedText, may have markdown
 * - COMPLETED: must have markdown
 * - ERROR: must have error message
 */
export const ProcessedFileSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  originalName: pipe(S.String, S.minLength(1)),
  size: S.Int, // Non-negative validated at runtime
  type: S.String,
  stage: ProcessingStageSchema,
  rawText: pipe(S.String, S.optional),
  scrubbedText: pipe(S.String, S.optional),
  markdown: pipe(S.String, S.optional),
  error: pipe(S.String, S.optional),
  stats: pipe(ProcessingStatsSchema, S.optional),
});

// Override to use branded ScrubbedText type for HIPAA compliance
export interface ProcessedFile {
  readonly id: string;
  readonly originalName: string;
  readonly size: number;
  readonly type: string;
  readonly stage: ProcessingStage;
  readonly rawText?: string;
  readonly scrubbedText?: ScrubbedText;
  readonly markdown?: string;
  readonly error?: string;
  readonly stats?: ProcessingStats;
}

/**
 * DECODERS & ENCODERS (OCaml-style safe conversions)
 */

/** Parse unknown data into ProcessedFile (like OCaml's of_yojson) */
export const decodeProcessedFile = S.decodeUnknown(ProcessedFileSchema);

/** Parse unknown data into ScrubResult */
export const decodeScrubResult = S.decodeUnknown(ScrubResultSchema);

/** Encode ProcessedFile to JSON (like OCaml's to_yojson) */
export const encodeProcessedFile = S.encode(ProcessedFileSchema);

/** Encode ScrubResult to JSON */
export const encodeScrubResult = S.encode(ScrubResultSchema);

/**
 * SMART CONSTRUCTORS (OCaml-style module signatures)
 *
 * These enforce invariants at construction time.
 */

/** Create a new queued file (starting state) */
export const createQueuedFile = (
  id: string,
  originalName: string,
  size: number,
  type: string
): ProcessedFile => ({
  id,
  originalName,
  size,
  type,
  stage: "QUEUED" as const,
});

/** Transition file to parsing stage */
export const startParsing = (file: ProcessedFile): ProcessedFile => ({
  ...file,
  stage: "PARSING" as const,
});

/** Transition to scrubbing with parsed text */
export const startScrubbing = (
  file: ProcessedFile,
  rawText: string
): ProcessedFile => ({
  ...file,
  stage: "SCRUBBING" as const,
  rawText,
});

/** Transition to formatting with scrubbed text */
export const startFormatting = (
  file: ProcessedFile,
  scrubbedText: ScrubbedText,
  piiRemovedCount: number
): ProcessedFile => ({
  ...file,
  stage: "FORMATTING" as const,
  scrubbedText,
  stats: {
    piiRemovedCount,
    processingTimeMs: file.stats?.processingTimeMs ?? 0,
  },
});

/** Mark file as completed with final markdown */
export const markCompleted = (
  file: ProcessedFile,
  markdown: string,
  processingTimeMs: number
): ProcessedFile => ({
  ...file,
  stage: "COMPLETED" as const,
  markdown,
  stats: {
    piiRemovedCount: file.stats?.piiRemovedCount ?? 0,
    processingTimeMs,
  },
});

/** Mark file as failed with error message */
export const markError = (
  file: ProcessedFile,
  error: string
): ProcessedFile => ({
  ...file,
  stage: "ERROR" as const,
  error,
});

/**
 * Enum-style export for convenience.
 */
export const ProcessingStage = {
  QUEUED: "QUEUED" as const,
  PARSING: "PARSING" as const,
  SCRUBBING: "SCRUBBING" as const,
  FORMATTING: "FORMATTING" as const,
  COMPLETED: "COMPLETED" as const,
  ERROR: "ERROR" as const,
};

// ============================================================================
// DOCUMENT FINGERPRINTING & DEDUPLICATION TYPES
// ============================================================================

/**
 * DOCUMENT TYPE (Variant Type - medical document classification)
 *
 * OCaml equivalent:
 * type document_type =
 *   | LabReport
 *   | Imaging
 *   | ProgressNote
 *   | Pathology
 *   | Medication
 *   | Discharge
 *   | Correspondence
 *   | Unknown
 */
export const DocumentTypeSchema = S.Literal(
  "lab_report",
  "imaging",
  "progress_note",
  "pathology",
  "medication",
  "discharge",
  "correspondence",
  "unknown"
);
export type DocumentType = S.Schema.Type<typeof DocumentTypeSchema>;

/**
 * DOCUMENT FINGERPRINT (Content-based hashing for deduplication)
 *
 * OCaml equivalent:
 * type document_fingerprint = {
 *   content_hash: string;        (* SHA-256 of normalized content *)
 *   sim_hash: string;            (* Fuzzy hash for near-duplicates *)
 *   word_count: int;
 *   date_references: string list;
 *   document_type: document_type;
 * }
 */
export const DocumentFingerprintSchema = S.Struct({
  contentHash: pipe(S.String, S.minLength(1)),
  simHash: pipe(S.String, S.minLength(1)),
  wordCount: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  dateReferences: S.Array(S.String),
  documentType: DocumentTypeSchema,
});
export type DocumentFingerprint = S.Schema.Type<typeof DocumentFingerprintSchema>;

/**
 * DIFFERENCE TYPE (How documents relate to each other)
 *
 * OCaml equivalent:
 * type difference_type =
 *   | Exact           (* Identical content *)
 *   | NearDuplicate   (* 95%+ similar *)
 *   | SameEvent       (* Same encounter, different report *)
 *   | Unique          (* Completely different *)
 */
export const DifferenceTypeSchema = S.Literal(
  "exact",
  "near-duplicate",
  "same-event",
  "unique"
);
export type DifferenceType = S.Schema.Type<typeof DifferenceTypeSchema>;

/**
 * DUPLICATE ANALYSIS (Result of comparing two documents)
 *
 * OCaml equivalent:
 * type duplicate_analysis = {
 *   is_duplicate: bool;
 *   duplicate_of: string option;
 *   similarity: float;           (* 0.0 - 1.0 *)
 *   difference_type: difference_type;
 * }
 *
 * Invariant: similarity is between 0.0 and 1.0
 */
export const DuplicateAnalysisSchema = pipe(
  S.Struct({
    isDuplicate: S.Boolean,
    duplicateOf: S.optional(S.String),
    similarity: S.Number,
    differenceType: DifferenceTypeSchema,
  }),
  S.filter(
    (analysis) => analysis.similarity >= 0 && analysis.similarity <= 1,
    {
      message: () => "Similarity must be between 0.0 and 1.0",
    }
  )
);
export type DuplicateAnalysis = S.Schema.Type<typeof DuplicateAnalysisSchema>;

// ============================================================================
// LAB EXTRACTION TYPES
// ============================================================================

/**
 * LAB FLAG (Result status indicator)
 *
 * OCaml equivalent:
 * type lab_flag =
 *   | High     (* Above reference range *)
 *   | Low      (* Below reference range *)
 *   | Normal   (* Within range *)
 *   | Abnormal (* Outside range, non-numeric *)
 */
export const LabFlagSchema = S.Literal("H", "L", "N", "A");
export type LabFlag = S.Schema.Type<typeof LabFlagSchema>;

/**
 * LAB RESULT STATUS (Human-readable status indicator)
 *
 * OCaml equivalent:
 * type lab_status = Normal | High | Low | Critical
 */
export const LabStatusSchema = S.Literal("Normal", "High", "Low", "Critical");
export type LabStatus = S.Schema.Type<typeof LabStatusSchema>;

/**
 * LAB RESULT (Individual test result)
 *
 * OCaml equivalent:
 * type lab_result = {
 *   testName: string;
 *   value: string;
 *   unit: string;
 *   reference_range: string option;
 *   status: lab_status option;
 *   date: string;
 * }
 */
export const LabResultSchema = S.Struct({
  testName: pipe(S.String, S.minLength(1)),
  value: S.String,
  unit: S.String,
  referenceRange: S.optional(S.String),
  status: S.optional(LabStatusSchema),
  date: S.String,
});
export type LabResult = S.Schema.Type<typeof LabResultSchema>;

/**
 * LAB PANEL (Group of related tests)
 *
 * OCaml equivalent:
 * type lab_panel = {
 *   panel_name: string;
 *   date: string;
 *   results: lab_result list;
 * }
 *
 * Invariant: results list is non-empty
 */
export const LabPanelSchema = pipe(
  S.Struct({
    panelName: pipe(S.String, S.minLength(1)),
    date: S.String,
    results: S.Array(LabResultSchema),
  }),
  S.filter(
    (panel) => panel.results.length > 0,
    {
      message: () => "Lab panel must have at least one result",
    }
  )
);
export type LabPanel = S.Schema.Type<typeof LabPanelSchema>;

// ============================================================================
// TIMELINE TYPES
// ============================================================================

/**
 * TIMELINE DOCUMENT (Document positioned in chronological timeline)
 *
 * OCaml equivalent:
 * type timeline_document = {
 *   id: string;
 *   filename: string;
 *   date: date;
 *   display_date: string;
 *   content: string;
 *   fingerprint: document_fingerprint;
 *   mutable duplication_info: duplicate_analysis option;
 *   lab_data: lab_panel option;
 *   mutable document_number: int;
 * }
 *
 * Note: Some fields are mutable to allow timeline construction
 */
export const TimelineDocumentSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  filename: pipe(S.String, S.minLength(1)),
  date: S.Date,
  displayDate: S.String,
  content: S.String,
  fingerprint: DocumentFingerprintSchema,
  duplicationInfo: S.optional(DuplicateAnalysisSchema),
  labData: S.optional(LabPanelSchema),
  documentNumber: S.Int,
});

// Export mutable version for service usage (Effect schemas are readonly by default)
export interface TimelineDocument {
  readonly id: string;
  readonly filename: string;
  readonly date: Date;
  readonly displayDate: string;
  readonly content: string;
  readonly fingerprint: DocumentFingerprint;
  duplicationInfo?: DuplicateAnalysis; // Mutable - assigned during deduplication
  readonly labData?: LabPanel;
  documentNumber: number; // Mutable - assigned during sorting
}

/**
 * TIMELINE SUMMARY (Aggregated statistics)
 *
 * OCaml equivalent:
 * type timeline_summary = {
 *   total_documents: int;
 *   unique_documents: int;
 *   duplicates: int;
 *   date_range: { earliest: string; latest: string };
 *   document_types: (document_type * int) list;
 * }
 *
 * Invariant: total = unique + duplicates
 */
export const TimelineSummarySchema = pipe(
  S.Struct({
    totalDocuments: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    uniqueDocuments: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    duplicates: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    dateRange: S.Struct({
      earliest: S.String,
      latest: S.String,
    }),
    documentTypes: S.Record({
      key: DocumentTypeSchema,
      value: pipe(S.Int, S.greaterThanOrEqualTo(0))
    }),
  }),
  S.filter(
    (summary) =>
      summary.totalDocuments === summary.uniqueDocuments + summary.duplicates,
    {
      message: () =>
        "Total documents must equal unique documents plus duplicates",
    }
  )
);
export type TimelineSummary = S.Schema.Type<typeof TimelineSummarySchema>;

/**
 * MASTER TIMELINE (Complete chronological medical record)
 *
 * OCaml equivalent:
 * type master_timeline = {
 *   documents: timeline_document list;
 *   summary: timeline_summary;
 *   markdown: string;
 * }
 */
export const MasterTimelineSchema = S.Struct({
  documents: S.Array(TimelineDocumentSchema),
  summary: TimelineSummarySchema,
  markdown: S.String,
});
export type MasterTimeline = S.Schema.Type<typeof MasterTimelineSchema>;

// ============================================================================
// AUDIT TYPES
// ============================================================================

/**
 * AUDIT PHASE (Which scrubbing phase detected this PII)
 *
 * OCaml equivalent:
 * type audit_phase =
 *   | Regex        (* Structural pattern matching *)
 *   | ML           (* Machine learning inference *)
 *   | Validation   (* Secondary validation pass *)
 */
export const AuditPhaseSchema = S.Literal("regex", "ml", "validation");
export type AuditPhase = S.Schema.Type<typeof AuditPhaseSchema>;

/**
 * REPLACEMENT PAIR (Original PII value and its placeholder)
 *
 * OCaml equivalent:
 * type replacement = {
 *   original: string;
 *   placeholder: string;
 * }
 */
export const ReplacementPairSchema = S.Struct({
  original: S.String,
  placeholder: S.String,
});
export type ReplacementPair = S.Schema.Type<typeof ReplacementPairSchema>;

/**
 * AUDIT ENTRY (Pattern-level PII detection record)
 *
 * OCaml equivalent:
 * type audit_entry = {
 *   pattern_type: string;
 *   pattern_name: string;
 *   match_count: int;
 *   replacements: replacement list;
 *   timestamp: int;
 *   duration_ms: int option;
 * }
 *
 * Invariant: match_count = length(replacements)
 */
export const AuditEntrySchema = pipe(
  S.Struct({
    patternType: S.String,
    patternName: S.String,
    matchCount: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    replacements: S.Array(ReplacementPairSchema),
    timestamp: S.Number,
    durationMs: S.optional(S.Number),
  }),
  S.filter(
    (entry) => entry.matchCount === entry.replacements.length,
    {
      message: () => "Match count must equal the number of replacements",
    }
  )
);
export type AuditEntry = S.Schema.Type<typeof AuditEntrySchema>;

/**
 * AUDIT SUMMARY (Aggregated detection statistics)
 *
 * OCaml equivalent:
 * type audit_summary = {
 *   total_detections: int;
 *   by_category: (string * int) list;
 *   total_duration_ms: float;
 *   confidence_score: float;
 *   started_at: int;
 *   completed_at: int;
 *   pii_density_percent: float;
 *   pii_characters_removed: int;
 *   size_change_bytes: int;
 *   average_pii_length: float;
 * }
 *
 * Invariant: completed_at >= started_at
 */
export const AuditSummarySchema = pipe(
  S.Struct({
    totalDetections: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    byCategory: S.Record({ key: S.String, value: S.Int }),
    totalDurationMs: pipe(S.Number, S.greaterThanOrEqualTo(0)),
    confidenceScore: S.Number,
    startedAt: S.Number,
    completedAt: S.Number,
    piiDensityPercent: S.Number,
    piiCharactersRemoved: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    sizeChangeBytes: S.Int,
    averagePiiLength: pipe(S.Number, S.greaterThanOrEqualTo(0)),
  }),
  S.filter(
    (summary) => summary.completedAt >= summary.startedAt,
    {
      message: () => "Completed timestamp must be >= started timestamp",
    }
  )
);
export type AuditSummary = S.Schema.Type<typeof AuditSummarySchema>;

/**
 * DOCUMENT METADATA (File information for audit)
 *
 * OCaml equivalent:
 * type document_metadata = {
 *   filename: string option;
 *   original_size_bytes: int;
 *   scrubbed_size_bytes: int;
 * }
 */
export const DocumentMetadataSchema = S.Struct({
  filename: S.optional(S.String),
  originalSizeBytes: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  scrubbedSizeBytes: pipe(S.Int, S.greaterThanOrEqualTo(0)),
});
export type DocumentMetadata = S.Schema.Type<typeof DocumentMetadataSchema>;

/**
 * AUDIT REPORT (Complete scrubbing audit trail)
 *
 * OCaml equivalent:
 * type audit_report = {
 *   summary: audit_summary;
 *   entries: audit_entry list;
 *   document: document_metadata;
 * }
 */
export const AuditReportSchema = S.Struct({
  summary: AuditSummarySchema,
  entries: S.Array(AuditEntrySchema),
  document: DocumentMetadataSchema,
});
export type AuditReport = S.Schema.Type<typeof AuditReportSchema>;

// ============================================================================
// DOCUMENT STRUCTURE TYPES
// ============================================================================

/**
 * SECTION TYPE (Medical document section classification)
 *
 * OCaml equivalent:
 * type section_type =
 *   | Demographics
 *   | ChiefComplaint
 *   | History
 *   (* ... *)
 *   | Unknown
 */
export const SectionTypeSchema = S.Literal(
  "demographics",
  "chief_complaint",
  "history",
  "social_history",
  "family_history",
  "physical_exam",
  "review_of_systems",
  "vitals",
  "lab_results",
  "medications",
  "assessment",
  "diagnoses",
  "unknown"
);
export type SectionType = S.Schema.Type<typeof SectionTypeSchema>;

/**
 * SCRUB INTENSITY (How aggressively to scrub a section)
 *
 * OCaml equivalent:
 * type scrub_intensity =
 *   | High    (* Patient narratives - aggressive scrubbing *)
 *   | Medium  (* Physical exam - moderate scrubbing *)
 *   | Low     (* Lab values - minimal scrubbing *)
 */
export const ScrubIntensitySchema = S.Literal("high", "medium", "low");
export type ScrubIntensity = S.Schema.Type<typeof ScrubIntensitySchema>;

/**
 * DOCUMENT SECTION (Parsed section of medical document)
 *
 * OCaml equivalent:
 * type document_section = {
 *   section_type: section_type;
 *   start_index: int;
 *   end_index: int;
 *   content: string;
 *   scrub_intensity: scrub_intensity;
 * }
 *
 * Invariant: end_index >= start_index
 */
export const DocumentSectionSchema = pipe(
  S.Struct({
    type: SectionTypeSchema,
    startIndex: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    endIndex: pipe(S.Int, S.greaterThanOrEqualTo(0)),
    content: S.String,
    scrubIntensity: ScrubIntensitySchema,
  }),
  S.filter(
    (section) => section.endIndex >= section.startIndex,
    {
      message: () => "End index must be >= start index",
    }
  )
);
export type DocumentSection = S.Schema.Type<typeof DocumentSectionSchema>;

/**
 * DOCUMENT FORMAT (Type of medical document)
 *
 * OCaml equivalent:
 * type document_format =
 *   | SoapNote
 *   | LabReport
 *   | ImagingReport
 *   | DischargeSummary
 *   | Unknown
 */
export const DocumentFormatSchema = S.Literal(
  "soap_note",
  "lab_report",
  "imaging_report",
  "discharge_summary",
  "unknown"
);
export type DocumentFormat = S.Schema.Type<typeof DocumentFormatSchema>;

/**
 * STRUCTURED DOCUMENT (Document parsed into sections)
 *
 * OCaml equivalent:
 * type structured_document = {
 *   sections: document_section list;
 *   document_type: document_format;
 * }
 *
 * Invariant: sections list is non-empty
 */
export const StructuredDocumentSchema = pipe(
  S.Struct({
    sections: S.Array(DocumentSectionSchema),
    documentType: DocumentFormatSchema,
  }),
  S.filter(
    (doc) => doc.sections.length > 0,
    {
      message: () => "Document must have at least one section",
    }
  )
);
export type StructuredDocument = S.Schema.Type<typeof StructuredDocumentSchema>;

// ============================================================================
// WORKER TYPES
// ============================================================================

/**
 * WORKER SCRUB OPTIONS (Configuration for worker-based scrubbing)
 *
 * OCaml equivalent:
 * type worker_scrub_options = {
 *   filename: string option;
 * }
 */
export const WorkerScrubOptionsSchema = S.Struct({
  filename: S.optional(S.String),
});
export type WorkerScrubOptions = S.Schema.Type<typeof WorkerScrubOptionsSchema>;

/**
 * WORKER SCRUB RESULT (Result from worker thread)
 *
 * OCaml equivalent:
 * type worker_scrub_result = {
 *   text: string;
 *   replacements: pii_map;
 *   count: int;
 *   audit_report: audit_report;
 * }
 */
export const WorkerScrubResultSchema = S.Struct({
  text: S.String,
  replacements: PIIMapSchema,
  count: S.Int,
  auditReport: AuditReportSchema,
});
export type WorkerScrubResult = S.Schema.Type<typeof WorkerScrubResultSchema>;

// ============================================================================
// DECODERS & ENCODERS (Extended)
// ============================================================================

// Document fingerprinting
export const decodeDocumentFingerprint = S.decodeUnknown(DocumentFingerprintSchema);
export const decodeDuplicateAnalysis = S.decodeUnknown(DuplicateAnalysisSchema);
export const encodeDocumentFingerprint = S.encode(DocumentFingerprintSchema);
export const encodeDuplicateAnalysis = S.encode(DuplicateAnalysisSchema);

// Lab extraction
export const decodeLabResult = S.decodeUnknown(LabResultSchema);
export const decodeLabPanel = S.decodeUnknown(LabPanelSchema);
export const encodeLabResult = S.encode(LabResultSchema);
export const encodeLabPanel = S.encode(LabPanelSchema);

// Timeline
export const decodeTimelineDocument = S.decodeUnknown(TimelineDocumentSchema);
export const decodeTimelineSummary = S.decodeUnknown(TimelineSummarySchema);
export const decodeMasterTimeline = S.decodeUnknown(MasterTimelineSchema);
export const encodeTimelineDocument = S.encode(TimelineDocumentSchema);
export const encodeTimelineSummary = S.encode(TimelineSummarySchema);
export const encodeMasterTimeline = S.encode(MasterTimelineSchema);

// Audit
export const decodeAuditEntry = S.decodeUnknown(AuditEntrySchema);
export const decodeAuditSummary = S.decodeUnknown(AuditSummarySchema);
export const decodeAuditReport = S.decodeUnknown(AuditReportSchema);
export const encodeAuditEntry = S.encode(AuditEntrySchema);
export const encodeAuditSummary = S.encode(AuditSummarySchema);
export const encodeAuditReport = S.encode(AuditReportSchema);

// Document structure
export const decodeDocumentSection = S.decodeUnknown(DocumentSectionSchema);
export const decodeStructuredDocument = S.decodeUnknown(StructuredDocumentSchema);
export const encodeDocumentSection = S.encode(DocumentSectionSchema);
export const encodeStructuredDocument = S.encode(StructuredDocumentSchema);

// Worker
export const decodeWorkerScrubOptions = S.decodeUnknown(WorkerScrubOptionsSchema);
export const decodeWorkerScrubResult = S.decodeUnknown(WorkerScrubResultSchema);
export const encodeWorkerScrubOptions = S.encode(WorkerScrubOptionsSchema);
export const encodeWorkerScrubResult = S.encode(WorkerScrubResultSchema);

// ============================================================================
// ENUM-STYLE EXPORTS (For convenience)
// ============================================================================

export const DocumentType = {
  LAB_REPORT: "lab_report" as const,
  IMAGING: "imaging" as const,
  PROGRESS_NOTE: "progress_note" as const,
  PATHOLOGY: "pathology" as const,
  MEDICATION: "medication" as const,
  DISCHARGE: "discharge" as const,
  CORRESPONDENCE: "correspondence" as const,
  UNKNOWN: "unknown" as const,
};

export const DifferenceType = {
  EXACT: "exact" as const,
  NEAR_DUPLICATE: "near-duplicate" as const,
  SAME_EVENT: "same-event" as const,
  UNIQUE: "unique" as const,
};

export const LabFlag = {
  HIGH: "H" as const,
  LOW: "L" as const,
  NORMAL: "N" as const,
  ABNORMAL: "A" as const,
};

export const AuditPhase = {
  REGEX: "regex" as const,
  ML: "ml" as const,
  VALIDATION: "validation" as const,
};

export const SectionType = {
  DEMOGRAPHICS: "demographics" as const,
  CHIEF_COMPLAINT: "chief_complaint" as const,
  HISTORY: "history" as const,
  SOCIAL_HISTORY: "social_history" as const,
  FAMILY_HISTORY: "family_history" as const,
  PHYSICAL_EXAM: "physical_exam" as const,
  REVIEW_OF_SYSTEMS: "review_of_systems" as const,
  VITALS: "vitals" as const,
  LAB_RESULTS: "lab_results" as const,
  MEDICATIONS: "medications" as const,
  ASSESSMENT: "assessment" as const,
  DIAGNOSES: "diagnoses" as const,
  UNKNOWN: "unknown" as const,
};

export const ScrubIntensity = {
  HIGH: "high" as const,
  MEDIUM: "medium" as const,
  LOW: "low" as const,
};

export const DocumentFormat = {
  SOAP_NOTE: "soap_note" as const,
  LAB_REPORT: "lab_report" as const,
  IMAGING_REPORT: "imaging_report" as const,
  DISCHARGE_SUMMARY: "discharge_summary" as const,
  UNKNOWN: "unknown" as const,
};
