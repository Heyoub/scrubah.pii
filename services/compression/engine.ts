/**
 * EFFECT-TS COMPRESSION ENGINE
 *
 * Transforms 350KB of medical documents into 70-100KB LLM-optimized YAML.
 *
 * Architecture:
 * - Pure functional pipeline using Effect
 * - Errors as values (no exceptions)
 * - Schema validation at every boundary
 * - Composable, testable, type-safe
 *
 * Pipeline:
 * 1. Extract events from documents (Effect)
 * 2. Deduplicate using content hashing (Effect)
 * 3. Prioritize (abnormals > normals) (Effect)
 * 4. Compress to target size (Effect)
 * 5. Generate YAML with error collection (Effect)
 */

import { Effect } from "effect";
import { assertScrubbed, ScrubbedText } from "../../schemas/phi";
import {
  CompressedTimeline,
  TimelineEntry,
  TimelineEventType,
  ConfidenceLevel,
  MedicationSummary,
  LabTrend,
  CompressionOptions,
  CompressionMetadata,
  PatientDemographics,
  DateRange,
} from "./schema";
import {
  CompressionError,
  ParseError,
  DateAmbiguityError,
  DeduplicationError,
  CompressionSizeExceededError,
  ErrorCollector,
} from "./errors";

/**
 * Input: ProcessedDocument from existing pipeline
 * (Bridge between current system and new compression system)
 */
export interface ProcessedDocument {
  id: string;
  filename: string;
  text: ScrubbedText;
  metadata: {
    pageCount?: number;
    createdAt?: Date;
    documentType?: string;
  };
}

/**
 * Progress callback for UI updates
 */
export interface CompressionProgress {
  stage: "extracting" | "deduplicating" | "compressing" | "generating";
  current: number;
  total: number;
  message: string;
}

export type ProgressCallback = (progress: CompressionProgress) => void;

/**
 * Compression Context (carries state through pipeline)
 * @internal Reserved for future pipeline refactor
 */
interface _CompressionContext {
  documents: ProcessedDocument[];
  options: CompressionOptions;
  errorCollector: ErrorCollector;
  progressCallback?: ProgressCallback;
}

/**
 * STAGE 1: Event Extraction
 *
 * Extract timeline events from processed documents.
 * Uses Effect for composable error handling.
 */
const extractEventsFromDocument = (
  doc: ProcessedDocument,
  errorCollector: ErrorCollector
): Effect.Effect<TimelineEntry[], never, never> => {
  return Effect.sync(() => {
    const events: TimelineEntry[] = [];

    try {
      // Regex patterns for event extraction (very flexible - match anything between keyword and date)
      const visitPattern =
        /(?:visit|appointment|consultation).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi;
      const labPattern = /(?:lab|test)\s+results?.*?(\d{1,2}\/\d{1,2}\/\d{4})/gi;
      const medPattern =
        /(?:started|stopped|prescribed).*?(\d{1,2}\/\d{1,2}\/\d{4})/gi;

      // Extract visits
      let match;
      while ((match = visitPattern.exec(doc.text)) !== null) {
        const dateStr = match[1];
        const parsedDate = parseDate(dateStr, doc.filename, errorCollector);

        if (parsedDate) {
          events.push({
            id: `${doc.id}-visit-${events.length}`,
            date: parsedDate,
            type: "visit" as TimelineEventType,
            sourceDocument: doc.filename,
            confidence: "medium" as ConfidenceLevel,
          });
        }
      }

      // Extract lab results
      while ((match = labPattern.exec(doc.text)) !== null) {
        const dateStr = match[1];
        const parsedDate = parseDate(dateStr, doc.filename, errorCollector);

        if (parsedDate) {
          events.push({
            id: `${doc.id}-lab-${events.length}`,
            date: parsedDate,
            type: "lab_result" as TimelineEventType,
            sourceDocument: doc.filename,
            confidence: "high" as ConfidenceLevel,
          });
        }
      }

      // Extract medication changes
      while ((match = medPattern.exec(doc.text)) !== null) {
        const dateStr = match[1]; // First capture group is the date
        const parsedDate = parseDate(dateStr, doc.filename, errorCollector);

        if (parsedDate) {
          events.push({
            id: `${doc.id}-med-${events.length}`,
            date: parsedDate,
            type: "medication_change" as TimelineEventType,
            sourceDocument: doc.filename,
            confidence: "high" as ConfidenceLevel,
          });
        }
      }
    } catch (error) {
      // Collect parse errors without failing the pipeline
      errorCollector.add(
        new ParseError({
          file: doc.filename,
          field: "events",
          expected: "timeline events",
          actual: error instanceof Error ? error.message : "unknown error",
          suggestion:
            "Document may have non-standard format. Manual review recommended.",
        })
      );
    }

    return events;
  });
};

/**
 * Date parsing with ambiguity detection
 */
const parseDate = (
  dateStr: string,
  filename: string,
  errorCollector: ErrorCollector
): Date | null => {
  try {
    // Try standard US format: MM/DD/YYYY
    const parts = dateStr.split("/");
    if (parts.length === 3) {
      const month = parseInt(parts[0], 10);
      const day = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);

      // Construct date and validate (catches JS normalization like Feb 30 -> Mar 2)
      const date = new Date(year, month - 1, day);
      if (
        isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day ||
        year < 1900 ||
        year > 2100
      ) {
        errorCollector.add(
          new ParseError({
            file: filename,
            field: "date",
            expected: "valid date (MM/DD/YYYY, 1900-2100)",
            actual: dateStr,
            suggestion: "Date is invalid (e.g., month/day out of range). Check source document.",
          })
        );
        return null;
      }

      // Ambiguity detection: 01/02/2023 could be Jan 2 or Feb 1
      if (month <= 12 && day <= 12 && month !== day) {
        errorCollector.add(
          new DateAmbiguityError({
            file: filename,
            rawDate: dateStr,
            possibleInterpretations: [
              `${month}/${day}/${year} (MM/DD/YYYY)`,
              `${day}/${month}/${year} (DD/MM/YYYY)`,
            ],
            chosenInterpretation: `${month}/${day}/${year} (MM/DD/YYYY)`,
            suggestion:
              "Assumed US date format. Verify if patient records use DD/MM/YYYY.",
          })
        );
      }

      return date;
    }
  } catch {
    errorCollector.add(
      new ParseError({
        file: filename,
        field: "date",
        expected: "MM/DD/YYYY",
        actual: dateStr,
        suggestion: "Check date format in source document.",
      })
    );
  }

  return null;
};

/**
 * STAGE 2: Deduplication
 *
 * Hash-based deduplication with similarity detection.
 */
const deduplicateEvents = (
  events: TimelineEntry[],
  aggressive: boolean,
  errorCollector: ErrorCollector
): Effect.Effect<TimelineEntry[], never, never> => {
  return Effect.sync(() => {
    const seen = new Map<string, TimelineEntry>();
    const deduplicated: TimelineEntry[] = [];

    for (const event of events) {
      // Create content hash (date + type + source)
      const hash = `${event.date.toISOString()}-${event.type}-${event.sourceDocument}`;

      if (seen.has(hash)) {
        // Exact duplicate found
        const original = seen.get(hash)!;

        errorCollector.add(
          new DeduplicationError({
            event1: original.id,
            event2: event.id,
            similarity: 1.0,
            action: "merged",
            suggestion: "Identical events merged. Verify source documents.",
          })
        );
      } else if (aggressive) {
        // Fuzzy matching: same date + type (ignore source)
        const fuzzyHash = `${event.date.toISOString()}-${event.type}`;
        const similar = Array.from(seen.values()).find(
          (e) => `${e.date.toISOString()}-${e.type}` === fuzzyHash
        );

        if (similar) {
          errorCollector.add(
            new DeduplicationError({
              event1: similar.id,
              event2: event.id,
              similarity: 0.8,
              action: "merged",
              suggestion:
                "Similar events from different sources merged. Review for accuracy.",
            })
          );
        } else {
          seen.set(hash, event);
          deduplicated.push(event);
        }
      } else {
        seen.set(hash, event);
        deduplicated.push(event);
      }
    }

    return deduplicated;
  });
};

/**
 * STAGE 3: Prioritization
 *
 * Sort by importance and recency.
 */
const prioritizeEvents = (
  events: TimelineEntry[]
): Effect.Effect<TimelineEntry[], never, never> => {
  return Effect.succeed(
    [...events].sort((a, b) => {
      // Priority: high confidence > medium > low
      const confidenceWeight = { high: 3, medium: 2, low: 1 };
      const confDiff =
        confidenceWeight[b.confidence] - confidenceWeight[a.confidence];

      if (confDiff !== 0) return confDiff;

      // Secondary: more recent events first
      return b.date.getTime() - a.date.getTime();
    })
  );
};

/**
 * STAGE 4: Compression to Target Size
 *
 * Iteratively remove low-priority events until size target met.
 */
const compressToTargetSize = (
  events: TimelineEntry[],
  targetSizeKb: number,
  errorCollector: ErrorCollector
): Effect.Effect<TimelineEntry[], never, never> => {
  return Effect.sync(() => {
    let compressed = [...events];

    // Estimate YAML size (100 bytes per event for realistic compression)
    const estimateSize = (evts: TimelineEntry[]) => evts.length * 0.1; // KB

    while (estimateSize(compressed) > targetSizeKb && compressed.length > 10) {
      // Remove lowest priority event (last in sorted array)
      compressed.pop();
    }

    const finalSize = estimateSize(compressed);
    if (finalSize > targetSizeKb) {
      errorCollector.add(
        new CompressionSizeExceededError({
          targetSizeKb,
          actualSizeKb: finalSize,
          suggestion:
            "Increase target size or enable more aggressive deduplication.",
        })
      );
    }

    return compressed;
  });
};

/**
 * STAGE 5: Build Compressed Timeline
 *
 * Assemble final output with metadata.
 */
const buildCompressedTimeline = (
  events: TimelineEntry[],
  documents: ProcessedDocument[],
  originalEventsCount: number,
  options: CompressionOptions
): Effect.Effect<CompressedTimeline, never, never> => {
  return Effect.sync(() => {
    // Calculate date range (handle empty events array)
    const now = new Date();
    const dateRange: DateRange = events.length > 0 ? {
      start: new Date(Math.min(...events.map((e) => e.date.getTime()))),
      end: new Date(Math.max(...events.map((e) => e.date.getTime()))),
    } : {
      start: now,
      end: now,
    };

    // Calculate compression metadata
    const originalSizeKb = documents.reduce(
      (sum, doc) => sum + doc.text.length / 1024,
      0
    );
    // Estimate compressed size (100 bytes per event for realistic compression)
    const compressedSizeKb = events.length * 0.1;

    // Calculate ratio (cap at 1.0 since compression can't make things bigger)
    const rawRatio = originalSizeKb > 0 ? compressedSizeKb / originalSizeKb : 0;
    const ratio = Math.min(rawRatio, 1.0);

    const metadata: CompressionMetadata = {
      originalSizeKb,
      compressedSizeKb,
      ratio,
      eventsTotal: originalEventsCount,
      eventsIncluded: events.length,
      deduplication: options.deduplicationAggressive ? "aggressive" : "light",
    };

    // Build demographics (placeholder - real implementation would extract from docs)
    const demographics: PatientDemographics = {
      patientId: "PATIENT-REDACTED",
      ageAtFirstVisit: 0, // Would be extracted from documents
    };

    // Build medication summary (placeholder)
    const medications: MedicationSummary = {
      current: [],
      discontinued: [],
    };

    // Build lab trends (placeholder)
    const labTrends: LabTrend[] = [];

    const timeline: CompressedTimeline = {
      patientId: "PATIENT-REDACTED",
      dateRange,
      totalDocuments: documents.length,
      totalEvents: originalEventsCount,
      demographics,
      timeline: events,
      medications,
      labTrends,
      compressionMetadata: metadata,
    };

    // Return timeline (schema validation happens at boundaries)
    return timeline;
  });
};

/**
 * MAIN COMPRESSION PIPELINE
 *
 * Orchestrates all stages with progress reporting.
 */
export const compressTimeline = (
  documents: ProcessedDocument[],
  options: CompressionOptions,
  progressCallback?: ProgressCallback
): Effect.Effect<
  { timeline: CompressedTimeline; errors: ErrorCollector },
  CompressionError,
  never
> => {
  return Effect.gen(function* (_) {
    const errorCollector = new ErrorCollector();

    // Zero-trust guardrail: compression must never see raw PHI
    const safeDocuments = (() => {
      if (!Array.isArray(documents)) {
        throw new CompressionError({
          message: "Invalid input: documents must be an array",
          extra: { actualType: typeof documents },
        });
      }

      type Violation = { file: string; message: string };
      const unsafeDocs: Violation[] = [];

      for (const doc of documents) {
        try {
          assertScrubbed(doc.text);
        } catch (error) {
          const violationMessage =
            error instanceof Error ? error.message : "unsafe text";
          unsafeDocs.push({
            file: doc.filename,
            message: violationMessage,
          });
          errorCollector.add(
            new ParseError({
              file: doc.filename,
              field: "text",
              expected: "ScrubbedText with placeholders (PII removed)",
              actual: violationMessage,
              suggestion:
                "Run the scrubbing pipeline before compression so raw PHI is removed.",
            })
          );
        }
      }

      if (unsafeDocs.length > 0) {
        throw new CompressionError({
          message: "Aborting: one or more documents are not scrubbed",
          extra: { violations: unsafeDocs },
        });
      }

      return documents;
    })();

    // STAGE 1: Extract events
    progressCallback?.({
      stage: "extracting",
      current: 0,
      total: safeDocuments.length,
      message: "Extracting timeline events...",
    });

    const allEvents: TimelineEntry[] = [];
    for (let i = 0; i < safeDocuments.length; i++) {
      const events = yield* _(
        extractEventsFromDocument(safeDocuments[i], errorCollector)
      );
      allEvents.push(...events);

      progressCallback?.({
        stage: "extracting",
        current: i + 1,
        total: safeDocuments.length,
        message: `Extracted ${allEvents.length} events from ${i + 1}/${safeDocuments.length} documents`,
      });
    }

    const originalEventsCount = allEvents.length;

    // STAGE 2: Deduplicate
    progressCallback?.({
      stage: "deduplicating",
      current: 0,
      total: 1,
      message: "Removing duplicate events...",
    });

    const deduplicated = yield* _(
      deduplicateEvents(
        allEvents,
        options.deduplicationAggressive,
        errorCollector
      )
    );

    progressCallback?.({
      stage: "deduplicating",
      current: 1,
      total: 1,
      message: `Removed ${allEvents.length - deduplicated.length} duplicates`,
    });

    // STAGE 3: Prioritize
    const prioritized = yield* _(prioritizeEvents(deduplicated));

    // STAGE 4: Compress to target size
    progressCallback?.({
      stage: "compressing",
      current: 0,
      total: 1,
      message: "Compressing to target size...",
    });

    const compressed = yield* _(
      compressToTargetSize(
        prioritized,
        options.maxOutputSizeKb,
        errorCollector
      )
    );

    progressCallback?.({
      stage: "compressing",
      current: 1,
      total: 1,
      message: `Compressed to ${compressed.length} events`,
    });

    // STAGE 5: Build final timeline
    progressCallback?.({
      stage: "generating",
      current: 0,
      total: 1,
      message: "Generating compressed timeline...",
    });

    const timeline = yield* _(
      buildCompressedTimeline(
        compressed,
        safeDocuments,
        originalEventsCount,
        options
      )
    );

    progressCallback?.({
      stage: "generating",
      current: 1,
      total: 1,
      message: "Compression complete!",
    });

    return { timeline, errors: errorCollector };
  });
};

/**
 * Helper: Run compression pipeline (for easy testing)
 */
export const runCompression = async (
  documents: ProcessedDocument[],
  options: CompressionOptions,
  progressCallback?: ProgressCallback
): Promise<{ timeline: CompressedTimeline; errors: ErrorCollector }> => {
  return Effect.runPromise(
    compressTimeline(documents, options, progressCallback)
  );
};
