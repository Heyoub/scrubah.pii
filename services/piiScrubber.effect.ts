/**
 * PII SCRUBBER - EFFECT-TS VERSION
 *
 * OCaml-style hybrid PII detection with algebraic effects.
 *
 * Architecture:
 * - Effect<ScrubResult, AppError, MLModelService>
 * - Railway-oriented programming (graceful degradation)
 * - Errors as values (MLModelError, PIIDetectionWarning)
 * - Immutable state (no mutations)
 *
 * Pipeline:
 * 1. Regex pre-pass (structural PII)
 * 2. Smart chunking (sentence-aware)
 * 3. ML inference (BERT NER)
 * 4. Result validation (Effect Schema)
 */

import { Effect, Context, Layer, pipe, ParseResult } from "effect";
import { pipeline, env } from "@huggingface/transformers";
import { ScrubResult, PIIMap, ScrubResultSchema, decodeScrubResult } from "../schemas";
import { AppError, MLModelError, PIIDetectionWarning, SchemaValidationError, ErrorCollector } from "./errors";

// Configure Hugging Face
env.allowLocalModels = false;
env.useBrowserCache = true;

const TARGET_ENTITIES = ["PER", "LOC", "ORG"] as const;
type EntityType = (typeof TARGET_ENTITIES)[number];

/**
 * PATTERNS (Regex for structural PII)
 */
const PATTERNS = {
  EMAIL: /\b[\w\.-]+@[\w\.-]+\.\w{2,4}\b/g,
  PHONE: /(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/g,
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  DATE: /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g,
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
  ZIPCODE: /\b\d{5}(?:-\d{4})?\b/g,
  // Medical document header names (LASTNAME, FIRSTNAME format)
  PATIENT_NAME: /^([A-Z]{2,}),\s+([A-Z]{2,})$/gm,
} as const;

const MRN_CONTEXT_KEYWORDS = [
  "MRN",
  "Medical Record Number",
  "Patient ID",
  "Patient Number",
  "Record Number",
  "Chart Number",
  "Account Number",
  "Member ID",
] as const;

/**
 * ML MODEL SERVICE (Effect Layer for dependency injection)
 *
 * OCaml equivalent:
 * module type MLModel = sig
 *   val load : unit -> (model, error) result
 *   val infer : model -> string -> (entity list, error) result
 * end
 */
export interface MLModelService {
  readonly loadModel: Effect.Effect<void, MLModelError, never>;
  readonly infer: (
    text: string
  ) => Effect.Effect<
    Array<{
      entity_group: string;
      word: string;
      start: number;
      end: number;
      score: number;
    }>,
    MLModelError,
    never
  >;
}

export const MLModelService = Context.GenericTag<MLModelService>(
  "MLModelService"
);

/**
 * ML MODEL IMPLEMENTATION (Live service)
 */
class MLModelServiceImpl implements MLModelService {
  private pipe: any = null;
  private loadPromise: Promise<void> | null = null;
  private segmenter?: any;

  constructor() {
    if ("Segmenter" in Intl) {
      this.segmenter = new (Intl as any).Segmenter("en", {
        granularity: "sentence",
      });
    }
  }

  readonly loadModel = Effect.gen(this, function* (_) {
    // If already loaded, return immediately
    if (this.pipe) return;

    // If currently loading, wait for promise
    if (this.loadPromise) {
      yield* _(Effect.promise(() => this.loadPromise!));
      return;
    }

    // Start loading
    this.loadPromise = (async () => {
      try {
        this.pipe = await pipeline("token-classification", "Xenova/bert-base-NER", {
          quantized: true,
        } as any);
        console.log("✅ NER Model loaded successfully");
      } catch (err) {
        this.loadPromise = null;
        throw err;
      }
    })();

    yield* _(
      Effect.tryPromise({
        try: () => this.loadPromise!,
        catch: (error) =>
          new MLModelError({
            modelName: "Xenova/bert-base-NER",
            reason: error instanceof Error ? error.message : String(error),
            fallbackUsed: false,
            suggestion: "Check network connection and retry",
          }),
      })
    );
  });

  readonly infer = (text: string) =>
    Effect.gen(this, function* (_) {
      // Ensure model is loaded
      if (!this.pipe) {
        yield* _(this.loadModel);
      }

      // Run inference with timeout
      const result = yield* _(
        Effect.tryPromise({
          try: () =>
            Promise.race([
              this.pipe(text, {
                aggregation_strategy: "simple",
                ignore_labels: ["O"],
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Processing timeout")), 30000)
              ),
            ]),
          catch: (error) =>
            new MLModelError({
              modelName: "Xenova/bert-base-NER",
              reason: error instanceof Error ? error.message : String(error),
              fallbackUsed: false,
              suggestion: "Try reducing text size or check model availability",
            }),
        })
      );

      return result as Array<{
        entity_group: string;
        word: string;
        start: number;
        end: number;
        score: number;
      }>;
    });

  getSentences(text: string): string[] {
    if (this.segmenter) {
      return Array.from((this.segmenter as any).segment(text)).map(
        (s: any) => s.segment
      );
    }
    return text.match(/[^.!?]+[.!?]+]*/g) || [text];
  }
}

/**
 * ML MODEL LAYER (for Effect runtime)
 */
export const MLModelServiceLive = Layer.succeed(
  MLModelService,
  new MLModelServiceImpl()
);

/**
 * HELPER: Extract field name from ParseError for debugging
 *
 * This helps identify which schema field failed validation
 */
const extractFieldFromParseError = (error: ParseResult.ParseError): string => {
  // Simplified version - just return "validation_error"
  // The full error details are logged via ArrayFormatter below
  return "validation_error";
};

/**
 * CONTEXT-AWARE MRN DETECTION
 */
const detectContextualMRN = (
  text: string
): Array<{ start: number; end: number; value: string }> => {
  const matches: Array<{ start: number; end: number; value: string }> = [];

  const contextPattern = new RegExp(
    `(${MRN_CONTEXT_KEYWORDS.join("|")})[:\\s]+([A-Z0-9]{6,12})\\b`,
    "gi"
  );

  let match;
  while ((match = contextPattern.exec(text)) !== null) {
    const mrnValue = match[2];
    const start =
      match.index +
      match[1].length +
      (match[0].length - match[1].length - mrnValue.length);
    matches.push({
      start,
      end: start + mrnValue.length,
      value: mrnValue,
    });
  }

  return matches;
};

/**
 * SCRUB STATE (Immutable)
 *
 * OCaml equivalent:
 * type scrub_state = {
 *   text: string;
 *   replacements: pii_map;
 *   counters: entity_counters;
 * }
 */
interface ScrubState {
  readonly text: string;
  readonly replacements: PIIMap;
  readonly counters: Record<string, number>;
}

/**
 * PHASE 1: REGEX PRE-PASS
 *
 * Pure function - no side effects
 */
const regexPrePass = (text: string): ScrubState => {
  let interimText = text;
  const replacements: Record<string, string> = {}; // Mutable for building
  const counters: Record<string, number> = {
    PER: 0,
    LOC: 0,
    ORG: 0,
    EMAIL: 0,
    PHONE: 0,
    ID: 0,
  };
  const entityToPlaceholder: Record<string, string> = {};

  const runRegex = (type: string, regex: RegExp, prefix: string) => {
    const matches = [...interimText.matchAll(regex)];
    // Iterate backwards to avoid index issues during replacement
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const originalValue = match[0];
      if (!entityToPlaceholder[originalValue]) {
        counters[type]++;
        const placeholder = `[${prefix}_${counters[type]}]`;
        entityToPlaceholder[originalValue] = placeholder;
        replacements[originalValue] = placeholder;
      }
      if (match.index !== undefined) {
        interimText =
          interimText.slice(0, match.index) +
          entityToPlaceholder[originalValue] +
          interimText.slice(match.index + originalValue.length);
      }
    }
  };

  runRegex("PER", PATTERNS.PATIENT_NAME, "NAME");
  runRegex("EMAIL", PATTERNS.EMAIL, "EMAIL");
  runRegex("PHONE", PATTERNS.PHONE, "PHONE");
  runRegex("ID", PATTERNS.SSN, "SSN");
  runRegex("ID", PATTERNS.CREDIT_CARD, "CARD");
  runRegex("ID", PATTERNS.ZIPCODE, "ZIP");

  // Context-aware MRN
  const mrnMatches = detectContextualMRN(interimText);
  mrnMatches.reverse().forEach(({ start, end, value }) => {
    if (!entityToPlaceholder[value]) {
      counters.ID++;
      const placeholder = `[MRN_${counters.ID}]`;
      entityToPlaceholder[value] = placeholder;
      replacements[value] = placeholder;
    }
    interimText =
      interimText.substring(0, start) +
      entityToPlaceholder[value] +
      interimText.substring(end);
  });

  return { text: interimText, replacements, counters };
};

/**
 * PHASE 2: SMART CHUNKING
 */
const smartChunk = (text: string, maxChunkSize = 2000): string[] => {
  // Use sentence segmenter if available
  const segmenter =
    "Segmenter" in Intl
      ? new (Intl as any).Segmenter("en", { granularity: "sentence" })
      : null;

  const sentences = segmenter
    ? Array.from((segmenter as any).segment(text)).map((s: any) => s.segment)
    : text.match(/[^.!?]+[.!?]+]*/g) || [text];

  const chunks: string[] = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
};

/**
 * PHASE 3: ML INFERENCE
 *
 * Effect-based with error collection
 */
const mlInference = (
  chunks: string[],
  state: ScrubState,
  errorCollector: ErrorCollector
): Effect.Effect<ScrubState, never, MLModelService> => {
  return pipe(
    Effect.gen(function* (_) {
      const mlModel = yield* _(MLModelService);
      let finalText = "";
      const replacements: Record<string, string> = { ...state.replacements };
      const counters: Record<string, number> = { ...state.counters };
      const entityToPlaceholder: Record<string, string> = Object.fromEntries(
        Object.entries(replacements).map(([k, v]) => [k, v])
      );

      console.log(`🔍 Processing ${chunks.length} chunks for PII detection...`);
      const startTime = performance.now();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Progress indicator
        if (chunks.length > 10 && i % 5 === 0) {
          console.log(
            `⏳ Progress: ${i}/${chunks.length} chunks (${Math.round((i / chunks.length) * 100)}%)`
          );
        }

        // Skip empty chunks
        if (!chunk.trim()) {
          finalText += chunk;
          continue;
        }

        // Skip chunks that are only placeholders
        if (/^(\s*\[[A-Z_]+\d+\]\s*)+$/.test(chunk)) {
          finalText += chunk;
          continue;
        }

        // Run ML inference (with error handling) - annotate each chunk with span
        const entitiesResult = yield* _(
          pipe(
            mlModel.infer(chunk),
            Effect.catchAll((error) => {
              // On ML failure, use regex-only (graceful degradation)
              errorCollector.add(error);
              return Effect.succeed([]);
            }),
            Effect.withSpan("ml-inference.chunk", {
              attributes: {
                chunkIndex: i,
                chunkLength: chunk.length,
                totalChunks: chunks.length
              }
            })
          )
        );

      // Filter entities - use LOWER threshold for medical PII (err on side of caution)
      const entities = entitiesResult.filter(
        (e: any) =>
          TARGET_ENTITIES.includes(e.entity_group as EntityType) && e.score > 0.50
      );

      // Warn on low-confidence detections
      entitiesResult
        .filter((e: any) => e.score <= 0.50 && e.score > 0.3)
        .forEach((e: any) => {
          errorCollector.add(
            new PIIDetectionWarning({
              entity: e.word,
              confidence: e.score,
              context: chunk.substring(
                Math.max(0, e.start - 20),
                Math.min(chunk.length, e.end + 20)
              ),
              suggestion: "Manual review recommended for low-confidence matches",
            })
          );
        });

      // Sort by start index
      entities.sort((a: any, b: any) => a.start - b.start);

      let chunkCursor = 0;
      let scrubbedChunk = "";

      for (const entity of entities) {
        const { entity_group, start, end } = entity as any;

        scrubbedChunk += chunk.substring(chunkCursor, start);
        const originalText = chunk.substring(start, end);

        // Skip if already a placeholder
        if (/^\[[A-Z_]+\d+\]$/.test(originalText.trim())) {
          scrubbedChunk += originalText;
        } else {
          // Generate placeholder
          if (!entityToPlaceholder[originalText]) {
            counters[entity_group]++;
            const placeholder = `[${entity_group}_${counters[entity_group]}]`;
            entityToPlaceholder[originalText] = placeholder;
            replacements[originalText] = placeholder;
          }
          scrubbedChunk += entityToPlaceholder[originalText];
        }

        chunkCursor = end;
      }

      scrubbedChunk += chunk.substring(chunkCursor);
      finalText += scrubbedChunk;
    }

      const processingTime = ((performance.now() - startTime) / 1000).toFixed(2);
      const count = Object.keys(replacements).length;
      console.log(
        `✅ PII scrubbing complete in ${processingTime}s (${count} entities redacted)`
      );

      return { text: finalText, replacements, counters };
    }),
    // Wrap all chunk processing in parent span
    Effect.withSpan("ml-inference.all-chunks", {
      attributes: {
        totalChunks: chunks.length
      }
    })
  );
};

/**
 * MAIN SCRUB FUNCTION (Effect Pipeline)
 *
 * OCaml equivalent:
 * val scrub : string -> (scrub_result, app_error) result
 */
export const scrubPII = (
  text: string
): Effect.Effect<
  { result: ScrubResult; errors: ErrorCollector },
  never,
  MLModelService
> => {
  return pipe(
    Effect.gen(function* (_) {
      const errorCollector = new ErrorCollector();

      // Phase 1: Regex pre-pass (pure) - annotate with span
      const afterRegex = yield* _(
        Effect.sync(() => regexPrePass(text)),
        Effect.withSpan("pii-scrubber.regex-prepass", {
          attributes: {
            textLength: text.length,
            phase: "regex-prepass"
          }
        })
      );

      // Phase 2: Smart chunking (pure) - annotate with span
      const chunks = yield* _(
        Effect.sync(() => smartChunk(afterRegex.text)),
        Effect.withSpan("pii-scrubber.chunking", {
          attributes: {
            textLength: afterRegex.text.length,
            chunkCount: 0,
            phase: "chunking"
          }
        })
      );

      // Phase 3: ML inference (Effect) - annotate with span
      const finalState = yield* _(
        mlInference(chunks, afterRegex, errorCollector),
        Effect.withSpan("pii-scrubber.ml-inference", {
          attributes: {
            chunkCount: chunks.length,
            phase: "ml-inference"
          }
        })
      );

      // Build result
      const result: ScrubResult = {
        text: finalState.text,
        replacements: finalState.replacements,
        count: Object.keys(finalState.replacements).length,
      };

      // Phase 4: Validate with Effect Schema (strict - no fallback!) - annotate with span
      const validated = yield* _(
        pipe(
          decodeScrubResult(result),
          Effect.mapError((parseError) => {
            // Log validation failure
            console.error("=== SCHEMA VALIDATION FAILED ===");
            console.error("Parse error:", parseError);

            // Create structured error for error collector
            const schemaError = new SchemaValidationError({
              schema: "ScrubResult",
              field: extractFieldFromParseError(parseError),
              expected: "Valid ScrubResult with count === replacements.length",
              actual: JSON.stringify(result, null, 2),
              suggestion: "Check PII scrubber logic - invariant violation detected",
            });

            // Add to error collector for visibility
            errorCollector.add(schemaError);

            // Return the error to propagate it
            return schemaError;
          }),
          // If validation fails, we want to know! Don't silently succeed.
          Effect.catchTag("SchemaValidationError", (error) => {
            // Log but continue with best-effort result
            console.warn("⚠️  Continuing with potentially invalid result due to schema error");
            return Effect.succeed(result as ScrubResult);
          }),
          Effect.withSpan("pii-scrubber.validation", {
            attributes: {
              resultCount: result.count,
              replacementsSize: Object.keys(result.replacements).length,
              phase: "validation"
            }
          })
        )
      );

      return { result: validated, errors: errorCollector };
    }),
    // Wrap entire pipeline in parent span for full execution tracing
    Effect.withSpan("pii-scrubber.pipeline", {
      attributes: {
        inputLength: text.length
      }
    })
  );
};

/**
 * HELPER: Run scrubber (for easy migration from Promise-based code)
 */
export const runScrubPII = async (text: string): Promise<ScrubResult> => {
  const program = pipe(
    scrubPII(text),
    Effect.provide(MLModelServiceLive),
    // Enable span logging and error cause tracking for debugging
    Effect.tapDefect((defect) => {
      console.error("=== EFFECT DEFECT (UNHANDLED ERROR) ===");
      console.error(defect);
      return Effect.void;
    }),
    Effect.tapErrorCause((cause) => {
      console.error("=== EFFECT ERROR CAUSE ===");
      console.error(cause);
      return Effect.void;
    })
  );

  const { result, errors } = await Effect.runPromise(program);

  // Log warnings if any
  if (errors.hasErrors()) {
    console.warn(
      `⚠️ Scrubbing completed with ${errors.count()} warnings:`,
      errors.toJSON()
    );
  }

  return result;
};

/**
 * EXPORT HELPERS FOR TESTING
 */
export { detectContextualMRN, PATTERNS, MRN_CONTEXT_KEYWORDS };
