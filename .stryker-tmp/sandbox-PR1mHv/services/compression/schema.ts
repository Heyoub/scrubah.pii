/**
 * EFFECT SCHEMA - SINGLE SOURCE OF TRUTH
 *
 * All types derive from these schemas. Runtime validation IS the type system.
 * No assertions, no manual type guards - if it decodes, it's valid.
 *
 * Philosophy:
 * - Schemas define both types AND validation
 * - Parse, don't validate
 * - Make invalid states unrepresentable
 * - Errors are values, not exceptions
 */
// @ts-nocheck


import { Schema as S, pipe } from "effect";

/**
 * Timeline Event Types (sum type, exhaustive)
 */
export const TimelineEventTypeSchema = S.Literal(
  "visit",
  "lab_result",
  "medication_change",
  "diagnosis",
  "procedure",
  "imaging",
  "vital_signs"
);
export type TimelineEventType = S.Schema.Type<typeof TimelineEventTypeSchema>;

/**
 * Confidence Levels (ordered by certainty)
 */
export const ConfidenceLevelSchema = S.Literal("high", "medium", "low");
export type ConfidenceLevel = S.Schema.Type<typeof ConfidenceLevelSchema>;

/**
 * Date Range (start must be <= end)
 */
export const DateRangeSchema = pipe(
  S.Struct({
    start: S.Date,
    end: S.Date,
  }),
  S.filter((range) => range.start <= range.end, {
    message: () => "Start date must be before or equal to end date",
  })
);
export type DateRange = S.Schema.Type<typeof DateRangeSchema>;

/**
 * Base Timeline Entry (all events extend this)
 */
export const TimelineEntrySchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  date: S.Date,
  type: TimelineEventTypeSchema,
  sourceDocument: pipe(S.String, S.minLength(1)),
  confidence: ConfidenceLevelSchema,
});
export type TimelineEntry = S.Schema.Type<typeof TimelineEntrySchema>;

/**
 * Visit Event (specific type with visit-specific fields)
 */
export const VisitEventSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  date: S.Date,
  type: S.Literal("visit"),
  sourceDocument: pipe(S.String, S.minLength(1)),
  confidence: ConfidenceLevelSchema,
  location: pipe(S.String, S.optional),
  provider: pipe(S.String, S.optional),
  chiefComplaint: pipe(S.String, S.optional),
  abnormalFindings: pipe(S.Array(S.String), S.optional),
  actions: pipe(S.Array(S.String), S.optional),
});
export type VisitEvent = S.Schema.Type<typeof VisitEventSchema>;

/**
 * Lab Result Event
 */
export const LabResultEventSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  date: S.Date,
  type: S.Literal("lab_result"),
  sourceDocument: pipe(S.String, S.minLength(1)),
  confidence: ConfidenceLevelSchema,
  panel: S.String,
  abnormals: pipe(S.Record({ key: S.String, value: S.String }), S.optional),
  normalsCount: pipe(S.Int, S.optional),
});
export type LabResultEvent = S.Schema.Type<typeof LabResultEventSchema>;

/**
 * Medication Change Event
 */
export const MedicationChangeEventSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  date: S.Date,
  type: S.Literal("medication_change"),
  sourceDocument: pipe(S.String, S.minLength(1)),
  confidence: ConfidenceLevelSchema,
  medicationName: S.String,
  action: S.Literal("started", "stopped", "dose_changed"),
  reason: pipe(S.String, S.optional),
});
export type MedicationChangeEvent = S.Schema.Type<typeof MedicationChangeEventSchema>;

/**
 * Lab Trend (time series data)
 */
export const LabTrendPointSchema = S.Struct({
  date: S.Date,
  value: S.Number,
  abnormal: pipe(S.Boolean, S.optional),
  flag: pipe(S.Literal("↑", "↓", "→"), S.optional),
});
export type LabTrendPoint = S.Schema.Type<typeof LabTrendPointSchema>;

export const LabTrendSchema = S.Struct({
  name: S.String,
  trend: S.Literal("increasing", "decreasing", "stable"),
  values: pipe(S.Array(LabTrendPointSchema), S.minItems(1)),
});
export type LabTrend = S.Schema.Type<typeof LabTrendSchema>;

/**
 * Medication Summary
 */
export const MedicationSchema = S.Struct({
  name: S.String,
  started: S.Date,
  stopped: pipe(S.Date, S.optional),
  reason: pipe(S.String, S.optional),
});
export type Medication = S.Schema.Type<typeof MedicationSchema>;

export const MedicationSummarySchema = S.Struct({
  current: S.Array(MedicationSchema),
  discontinued: S.Array(MedicationSchema),
});
export type MedicationSummary = S.Schema.Type<typeof MedicationSummarySchema>;

/**
 * Patient Demographics (stated once, not repeated)
 */
export const PatientDemographicsSchema = S.Struct({
  patientId: S.String, // PII-scrubbed placeholder
  ageAtFirstVisit: S.Int,
});
export type PatientDemographics = S.Schema.Type<typeof PatientDemographicsSchema>;

/**
 * Compression Options (user-controlled)
 */
export const CompressionOptionsSchema = S.Struct({
  includeNormalLabs: S.Boolean,
  includeVerbatimNotes: S.Boolean,
  deduplicationAggressive: S.Boolean,
  maxOutputSizeKb: S.Number,
});
export type CompressionOptions = S.Schema.Type<typeof CompressionOptionsSchema>;

// Default compression options
export const defaultCompressionOptions: CompressionOptions = {
  includeNormalLabs: false,
  includeVerbatimNotes: false,
  deduplicationAggressive: true,
  maxOutputSizeKb: 100,
};

/**
 * Compression Metadata (tracks compression effectiveness)
 */
export const CompressionMetadataSchema = pipe(
  S.Struct({
    originalSizeKb: S.Number,
    compressedSizeKb: S.Number,
    ratio: pipe(S.Number, S.between(0, 1)),
    eventsTotal: S.Int,
    eventsIncluded: S.Int,
    deduplication: S.Literal("none", "light", "aggressive"),
  }),
  S.filter(
    (meta) => meta.eventsIncluded <= meta.eventsTotal,
    {
      message: () => "Events included cannot exceed total events",
    }
  )
);
export type CompressionMetadata = S.Schema.Type<typeof CompressionMetadataSchema>;

/**
 * Compressed Timeline (final output)
 */
export const CompressedTimelineSchema = S.Struct({
  patientId: S.String,
  dateRange: DateRangeSchema,
  totalDocuments: S.Int,
  totalEvents: S.Int,

  demographics: PatientDemographicsSchema,
  timeline: S.Array(TimelineEntrySchema),
  medications: MedicationSummarySchema,
  labTrends: S.Array(LabTrendSchema),

  compressionMetadata: CompressionMetadataSchema,
});
export type CompressedTimeline = S.Schema.Type<typeof CompressedTimelineSchema>;

/**
 * YAML Output Metadata (for debugging/tracking)
 */
export const YAMLMetadataSchema = S.Struct({
  generatedAt: S.Date,
  version: pipe(S.String, S.minLength(1)),
  format: S.Literal("yaml"),
  schemaVersion: pipe(S.String, S.minLength(1)),
});
export type YAMLMetadata = S.Schema.Type<typeof YAMLMetadataSchema>;

/**
 * Full YAML Output (timeline + metadata)
 */
export const YAMLOutputSchema = S.Struct({
  metadata: YAMLMetadataSchema,
  timeline: CompressedTimelineSchema,
});
export type YAMLOutput = S.Schema.Type<typeof YAMLOutputSchema>;

/**
 * Helper: Decode with Effect (parse, don't validate)
 *
 * Usage:
 * ```typescript
 * const result = await Effect.runPromise(
 *   decode(CompressedTimelineSchema, unknownData)
 * );
 * ```
 */
export const decode = <A, I>(schema: S.Schema<A, I, never>) => {
  const parse = S.decodeUnknown(schema);
  return (input: unknown) => parse(input);
};

/**
 * Helper: Encode to safe output
 */
export const encode = <A, I>(schema: S.Schema<A, I, never>) => {
  const enc = S.encode(schema);
  return (input: A) => enc(input);
};
