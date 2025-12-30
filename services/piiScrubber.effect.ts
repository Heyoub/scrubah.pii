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
 * - SSOT: All types from schemas/schemas.ts
 *
 * Pipeline:
 * 1. Regex pre-pass (structural PII)
 * 2. Context-aware detection (labeled names, MRN)
 * 3. Smart chunking (sentence-aware)
 * 4. ML inference (BERT NER)
 * 5. Result validation (Effect Schema)
 */

import { Effect, Context, Layer, pipe } from "effect";
import { pipeline, env } from "@huggingface/transformers";
import {
  ScrubResult,
  // Types from SSOT
  type NEREntity,
  type PIIEntityType,
  type MutableScrubState,
  type LabeledDetection,
  type ScrubConfig,
  // Constants from SSOT
  PII_PATTERNS,
  MRN_CONTEXT_KEYWORDS,
  NAME_LABELS,
  DEFAULT_SCRUB_CONFIG,
} from "../schemas/schemas";
import { markAsScrubbed } from "../schemas/phi";
import { MLModelError, PIIDetectionWarning, ErrorCollector } from "./errors";

// Configure Hugging Face
env.allowLocalModels = false;
env.useBrowserCache = true;

// ML model target entities
const TARGET_ENTITIES = ["PER", "LOC", "ORG"] as const;
type MLEntityType = (typeof TARGET_ENTITIES)[number];

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
 * Create IntlSegmenter safely with proper typing
 */
const createSegmenter = (): IntlSegmenter | undefined => {
  if ("Segmenter" in Intl) {
    const SegmenterClass = (Intl as unknown as { Segmenter: new (locale: string, options: { granularity: string }) => IntlSegmenter }).Segmenter;
    return new SegmenterClass("en", { granularity: "sentence" });
  }
  return undefined;
};

// ============================================================================
// ML MODEL SERVICE (Effect Layer for dependency injection)
// ============================================================================

/**
 * ML MODEL SERVICE INTERFACE
 *
 * OCaml equivalent:
 * module type MLModel = sig
 *   val load : unit -> (unit, error) result
 *   val infer : string -> (entity list, error) result
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
 * Factory function creates MLModelService without `this` inference issues
 * This pattern avoids TypeScript strict mode stack overflow
 */
function createMLModelService(): MLModelService {
  // Captured state (no `this` needed)
  let nerPipeline: NERPipeline | null = null;
  let loadPromise: Promise<void> | null = null;

  const loadModel = (): Effect.Effect<void, MLModelError, never> => {
    return Effect.suspend(() => {
      if (nerPipeline) return Effect.void;
      if (loadPromise) return Effect.promise(() => loadPromise!);

      loadPromise = (async () => {
        try {
          nerPipeline = await pipeline("token-classification", "Xenova/bert-base-NER", {
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
      const loadFirst = nerPipeline ? Effect.void : loadModel();

      return loadFirst.pipe(
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () =>
              Promise.race([
                nerPipeline!(text, {
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

/**
 * ML MODEL LAYER (for Effect runtime)
 */
export const MLModelServiceLive: Layer.Layer<MLModelService, never, never> = Layer.succeed(
  MLModelService,
  createMLModelService()
);

/**
 * EXPORTED LOAD MODEL (for testing)
 */
export const loadModel = async (): Promise<void> => {
  const service = createMLModelService();
  return new Promise((resolve, reject) => {
    Effect.runPromise(service.loadModel())
      .then(() => resolve())
      .catch(reject);
  });
};

// ============================================================================
// CONTEXT-AWARE DETECTION FUNCTIONS
// ============================================================================

/**
 * CONTEXT-AWARE MRN DETECTION
 * Uses MRN_CONTEXT_KEYWORDS from schemas (SSOT)
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
 * LABELED NAME DETECTION
 * Detects names that appear after common labels like "Patient Name:", "Dr.", etc.
 * Uses NAME_LABELS from schemas (SSOT)
 */
const detectLabeledName = (
  text: string
): LabeledDetection[] => {
  const matches: LabeledDetection[] = [];

  // Build pattern from NAME_LABELS
  const labelsPattern = NAME_LABELS
    .map(label => label.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')) // Escape special chars
    .join("|");

  // Pattern: Label followed by colon/space then name (First Last or Title First Last)
  const namePattern = new RegExp(
    `(${labelsPattern})[:\\s]+(?:(Dr\\.|Mr\\.|Ms\\.|Mrs\\.|Miss|Nurse)\\s+)?([A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+)`,
    "gi"
  );

  let match;
  while ((match = namePattern.exec(text)) !== null) {
    const label = match[1];
    const title = match[2] || "";
    const name = match[3];
    const fullValue = title ? `${title} ${name}` : name;

    // Calculate start position of the name (after label and colon/space)
    const _labelEnd = match.index + label.length;
    const valueStart = match[0].indexOf(fullValue, label.length) + match.index;

    matches.push({
      start: valueStart,
      end: valueStart + fullValue.length,
      value: fullValue,
      label,
    });
  }

  return matches;
};

/**
 * ADDRESS DETECTION (using new patterns)
 */
const detectAddresses = (
  text: string
): Array<{ start: number; end: number; value: string; type: PIIEntityType }> => {
  const matches: Array<{ start: number; end: number; value: string; type: PIIEntityType }> = [];

  // Street addresses
  const addressPattern = new RegExp(PII_PATTERNS.ADDRESS.source, PII_PATTERNS.ADDRESS.flags);
  let match;
  while ((match = addressPattern.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      type: "ADDRESS",
    });
  }

  // City, State patterns
  const cityStatePattern = new RegExp(PII_PATTERNS.CITY_STATE.source, PII_PATTERNS.CITY_STATE.flags);
  while ((match = cityStatePattern.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      type: "CITY_STATE",
    });
  }

  // P.O. Box patterns
  const poBoxPattern = new RegExp(PII_PATTERNS.PO_BOX.source, PII_PATTERNS.PO_BOX.flags);
  while ((match = poBoxPattern.exec(text)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      value: match[0],
      type: "PO_BOX",
    });
  }

  return matches;
};

// ============================================================================
// SCRUBBING PHASES
// ============================================================================

/**
 * PHASE 1: REGEX PRE-PASS
 * Pure function - no side effects
 */
const regexPrePass = (text: string, config: ScrubConfig): MutableScrubState => {
  let interimText = text;
  const replacements: Record<string, string> = {};
  const counters: Record<string, number> = {
    PER: 0,
    LOC: 0,
    ORG: 0,
    EMAIL: 0,
    PHONE: 0,
    ID: 0,
    ADDRESS: 0,
    CITY_STATE: 0,
    ZIP: 0,
    NAME: 0,
    PO_BOX: 0,
  };
  const entityToPlaceholder: Record<string, string> = {};

  const runRegex = (type: string, regex: RegExp, prefix: string) => {
    // Create new regex instance to reset lastIndex
    const pattern = new RegExp(regex.source, regex.flags);
    const matches = [...interimText.matchAll(pattern)];

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

  // Run standard patterns
  runRegex("EMAIL", PII_PATTERNS.EMAIL, "EMAIL");
  runRegex("PHONE", PII_PATTERNS.PHONE, "PHONE");
  runRegex("ID", PII_PATTERNS.SSN, "SSN");
  runRegex("ID", PII_PATTERNS.CREDIT_CARD, "CARD");
  runRegex("ZIP", PII_PATTERNS.ZIPCODE, "ZIP");

  // Run new address patterns
  if (config.enableContextDetection) {
    runRegex("ADDRESS", PII_PATTERNS.ADDRESS, "ADDR");
    runRegex("CITY_STATE", PII_PATTERNS.CITY_STATE, "CITY");
    runRegex("PO_BOX", PII_PATTERNS.PO_BOX, "POBOX");
  }

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

  // Labeled name detection
  if (config.enableContextDetection) {
    const nameMatches = detectLabeledName(interimText);
    nameMatches.reverse().forEach(({ start, end, value }) => {
      if (!entityToPlaceholder[value]) {
        counters.NAME++;
        const placeholder = `[NAME_${counters.NAME}]`;
        entityToPlaceholder[value] = placeholder;
        replacements[value] = placeholder;
      }
      interimText =
        interimText.substring(0, start) +
        entityToPlaceholder[value] +
        interimText.substring(end);
    });
  }

  return { text: interimText, replacements, counters };
};

/**
 * PHASE 2: SMART CHUNKING
 */
const smartChunk = (text: string, maxChunkSize = 2000): string[] => {
  const segmenter = createSegmenter();

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
 * Effect-based with error collection
 * Uses configurable confidence threshold from DEFAULT_SCRUB_CONFIG
 */
const mlInference = (
  chunks: string[],
  state: MutableScrubState,
  errorCollector: ErrorCollector,
  config: ScrubConfig
): Effect.Effect<MutableScrubState, never, MLModelService> => {
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

      // Filter entities using configurable threshold (FIXED: was 0.85, now uses config)
      const entities: NEREntity[] = entitiesResult.filter(
        (e: NEREntity) =>
          TARGET_ENTITIES.includes(e.entity_group as MLEntityType) &&
          e.score > config.mlConfidenceThreshold
      );

      // Warn on low-confidence detections (between threshold and 0.5)
      const warningThreshold = Math.max(0.5, config.mlConfidenceThreshold - 0.15);
      entitiesResult
        .filter((e: NEREntity) =>
          e.score <= config.mlConfidenceThreshold &&
          e.score > warningThreshold
        )
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

      // Sort by start index
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
            counters[entity_group] = (counters[entity_group] || 0) + 1;
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

// ============================================================================
// MAIN SCRUB FUNCTION (Effect Pipeline)
// ============================================================================

/**
 * MAIN SCRUB FUNCTION
 *
 * OCaml equivalent:
 * val scrub : string -> (scrub_result, app_error) result
 */
export const scrubPII = (
  text: string,
  config: ScrubConfig = DEFAULT_SCRUB_CONFIG
): Effect.Effect<
  { result: ScrubResult; errors: ErrorCollector },
  never,
  MLModelService
> => {
  return Effect.gen(function* (_) {
    const errorCollector = new ErrorCollector();

    // Phase 1: Regex pre-pass (pure)
    const afterRegex = regexPrePass(text, config);

    // Phase 2: Smart chunking (pure)
    const chunks = smartChunk(afterRegex.text);

    // Phase 3: ML inference (Effect) - only if enabled
    let finalState: MutableScrubState;
    if (config.enableML) {
      finalState = yield* _(mlInference(chunks, afterRegex, errorCollector, config));
    } else {
      finalState = afterRegex;
    }

    // Build result with branded ScrubbedText type
    const result: ScrubResult = {
      text: markAsScrubbed(finalState.text),
      replacements: finalState.replacements,
      count: Object.keys(finalState.replacements).length,
    };

    return { result, errors: errorCollector };
  });
};

/**
 * HELPER: Run scrubber (for easy migration from Promise-based code)
 */
export const runScrubPII = async (
  text: string,
  config: ScrubConfig = DEFAULT_SCRUB_CONFIG
): Promise<ScrubResult> => {
  const program = pipe(scrubPII(text, config), Effect.provide(MLModelServiceLive));

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

// ============================================================================
// EXPORT HELPERS FOR TESTING
// ============================================================================

// Re-export from schemas for backward compatibility
export {
  PII_PATTERNS as PATTERNS,
  MRN_CONTEXT_KEYWORDS,
  NAME_LABELS,
  DEFAULT_SCRUB_CONFIG,
};

// Export detection functions for testing
export {
  detectContextualMRN,
  detectLabeledName,
  detectAddresses,
};
