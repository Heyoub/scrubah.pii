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
 * NER ENTITY TYPE (Explicit type for ML model output)
 *
 * Per Effect v3 best practices: NEVER use `any` - always explicit types
 * This prevents TypeScript infinite inference with strict mode
 */
interface NEREntity {
  readonly entity_group: string;
  readonly word: string;
  readonly start: number;
  readonly end: number;
  readonly score: number;
}

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
  loadModel(): Effect.Effect<void, MLModelError, never>;
  infer(text: string): Effect.Effect<ReadonlyArray<NEREntity>, MLModelError, never>;
}

export const MLModelService = Context.GenericTag<MLModelService>(
  "MLModelService"
);

/**
 * ML MODEL IMPLEMENTATION (Factory pattern - avoids `this` inference issues)
 */
/**
 * Intl.Segmenter type (not in all TypeScript libs)
 */
interface IntlSegmenter {
  segment(text: string): Iterable<{ segment: string }>;
}

/**
 * ML Model Pipeline type (from transformers.js)
 */
type NERPipeline = (
  text: string,
  options: { aggregation_strategy: string; ignore_labels: string[] }
) => Promise<NEREntity[]>;

/**
 * Factory function creates MLModelService without `this` inference issues
 * This pattern avoids TypeScript strict mode stack overflow
 */
function createMLModelService(): MLModelService {
  // Captured state (no `this` needed)
  let pipe: NERPipeline | null = null;
  let loadPromise: Promise<void> | null = null;
  const segmenter: IntlSegmenter | undefined =
    "Segmenter" in Intl
      ? new (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => IntlSegmenter }).Segmenter("en", { granularity: "sentence" })
      : undefined;

  const loadModel = (): Effect.Effect<void, MLModelError, never> => {
    return Effect.suspend(() => {
      if (pipe) return Effect.void;
      if (loadPromise) return Effect.promise(() => loadPromise!);

      loadPromise = (async () => {
        try {
          pipe = await pipeline("token-classification", "Xenova/bert-base-NER", {
            quantized: true,
          } as Parameters<typeof pipeline>[2]) as unknown as NERPipeline;
          console.log("✅ NER Model loaded successfully");
        } catch (err) {
          loadPromise = null;
          throw err;
        }
      })();

      return Effect.tryPromise({
        try: () => loadPromise!,
        catch: (error) =>
          new MLModelError({
            modelName: "Xenova/bert-base-NER",
            reason: error instanceof Error ? error.message : String(error),
            fallbackUsed: false,
            suggestion: "Check network connection and retry",
          }),
      });
    });
  };

  const infer = (text: string): Effect.Effect<ReadonlyArray<NEREntity>, MLModelError, never> => {
    return Effect.suspend(() => {
      const loadFirst = pipe ? Effect.void : loadModel();

      return loadFirst.pipe(
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () =>
              Promise.race([
                pipe!(text, {
                  aggregation_strategy: "simple",
                  ignore_labels: ["O"],
                }),
                new Promise<NEREntity[]>((_, reject) =>
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
        ),
        Effect.map((result) => result as ReadonlyArray<NEREntity>)
      );
    });
  };

  return { loadModel, infer };
}

// Helper for sentence segmentation (separate from ML service)
function getSentences(text: string): string[] {
  if ("Segmenter" in Intl) {
    const segmenter = new (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => IntlSegmenter }).Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text)).map((s) => s.segment);
  }
  return text.match(/[^.!?]+[.!?]+]*/g) || [text];
}

/**
 * ML MODEL LAYER (for Effect runtime)
 *
 * EXPLICIT TYPE ANNOTATION per Effect v3 best practices:
 * Layer.Layer<Out, Error, In>
 * - Out: MLModelService (what this layer provides)
 * - Error: never (no errors during layer creation)
 * - In: never (no dependencies)
 */
export const MLModelServiceLive: Layer.Layer<MLModelService, never, never> = Layer.succeed(
  MLModelService,
  createMLModelService()
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
  // Use sentence segmenter if available - explicit type casting
  const segmenter: IntlSegmenter | null =
    "Segmenter" in Intl
      ? new (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => IntlSegmenter }).Segmenter("en", { granularity: "sentence" })
      : null;

  const sentences: string[] = segmenter
    ? Array.from(segmenter.segment(text)).map((s) => s.segment)
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

      // Filter high-confidence entities - explicit NEREntity type
      const entities: NEREntity[] = entitiesResult.filter(
        (e: NEREntity) =>
          TARGET_ENTITIES.includes(e.entity_group as EntityType) && e.score > 0.85
      );

      // Warn on low-confidence detections
      entitiesResult
        .filter((e: NEREntity) => e.score <= 0.85 && e.score > 0.5)
        .forEach((e: NEREntity) => {
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

      // Sort by start index - explicit types prevent inference issues
      entities.sort((a: NEREntity, b: NEREntity) => a.start - b.start);

      let chunkCursor = 0;
      let scrubbedChunk = "";

      for (const entity of entities) {
        const { entity_group, start, end } = entity;

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
