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
export type ScrubResult = S.Schema.Type<typeof ScrubResultSchema>;

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
export type ProcessedFile = S.Schema.Type<typeof ProcessedFileSchema>;

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
  scrubbedText: string,
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
 * LEGACY COMPATIBILITY
 *
 * Re-export as enum for existing code.
 * TODO: Remove once all code uses schemas.
 */
export const ProcessingStage = {
  QUEUED: "QUEUED" as const,
  PARSING: "PARSING" as const,
  SCRUBBING: "SCRUBBING" as const,
  FORMATTING: "FORMATTING" as const,
  COMPLETED: "COMPLETED" as const,
  ERROR: "ERROR" as const,
};
