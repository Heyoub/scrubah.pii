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

import { Effect, Context, Layer, pipe } from "effect";
import { pipeline, env } from "@huggingface/transformers";
import { ScrubResult, PIIMap, ScrubResultSchema, decodeScrubResult } from "../schemas";
import { AppError, MLModelError, PIIDetectionWarning, ErrorCollector } from "./errors";

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
    interimText = interimText.replace(regex, (match) => {
      if (!entityToPlaceholder[match]) {
        counters[type]++;
        const placeholder = `[${prefix}_${counters[type]}]`;
        entityToPlaceholder[match] = placeholder;
        replacements[match] = placeholder;
      }
      return entityToPlaceholder[match];
    });
  };

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
  return Effect.gen(function* (_) {
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

      // Run ML inference (with error handling)
      const entitiesResult = yield* _(
        pipe(
          mlModel.infer(chunk),
          Effect.catchAll((error) => {
            // On ML failure, use regex-only (graceful degradation)
            errorCollector.add(error);
            return Effect.succeed([]);
          })
        )
      );

      // Filter high-confidence entities
      const entities = entitiesResult.filter(
        (e: any) =>
          TARGET_ENTITIES.includes(e.entity_group as EntityType) && e.score > 0.85
      );

      // Warn on low-confidence detections
      entitiesResult
        .filter((e: any) => e.score <= 0.85 && e.score > 0.5)
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
  });
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
  return Effect.gen(function* (_) {
    const errorCollector = new ErrorCollector();

    // Phase 1: Regex pre-pass (pure)
    const afterRegex = regexPrePass(text);

    // Phase 2: Smart chunking (pure)
    const chunks = smartChunk(afterRegex.text);

    // Phase 3: ML inference (Effect)
    const finalState = yield* _(mlInference(chunks, afterRegex, errorCollector));

    // Build result
    const result: ScrubResult = {
      text: finalState.text,
      replacements: finalState.replacements,
      count: Object.keys(finalState.replacements).length,
    };

    // Validate with Effect Schema
    const validated = yield* _(
      pipe(
        decodeScrubResult(result),
        Effect.catchAll((error) => {
          // Schema validation failed - this shouldn't happen, but log it
          console.error("Schema validation failed:", error);
          return Effect.succeed(result);
        })
      )
    );

    return { result: validated, errors: errorCollector };
  });
};

/**
 * HELPER: Run scrubber (for easy migration from Promise-based code)
 */
export const runScrubPII = async (text: string): Promise<ScrubResult> => {
  const program = pipe(scrubPII(text), Effect.provide(MLModelServiceLive));

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
