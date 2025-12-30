/**
 * OCR QUALITY GATE - EFFECT-TS SERVICE
 *
 * Quality scoring and routing for OCR-processed documents.
 * Implements Tesseract → TrOCR cascade for optimal text extraction.
 *
 * Architecture:
 * - Effect<OCRQualityResult, OCRError, OCRQualityService>
 * - Word-level confidence analysis
 * - Garbage token detection
 * - TrOCR repair for low-confidence regions
 *
 * Flow:
 * 1. Tesseract extracts text with word-level confidence
 * 2. Compute quality metrics (median confidence, alpha ratio, garbage density)
 * 3. Score and route: HIGH (proceed) / MEDIUM (flag) / LOW (repair or skip)
 * 4. For LOW: identify low-confidence regions → TrOCR repair → merge
 */

import { Effect, Context, Layer } from "effect";
import Tesseract from "tesseract.js";
import { pipeline } from "@huggingface/transformers";
import {
  OCRWord,
  OCRQualityResult,
  OCRQualityMetrics,
  OCRQualityConfig,
  OCRQualityLevel,
  OCRQualityFlag,
  LowConfidenceRegion,
  defaultOCRQualityConfig,
  isGarbageToken,
} from "../schemas/ocrQuality";
import { OCRError } from "./errors";

// ============================================================================
// TESSERACT WORD TYPE (from tesseract.js)
// ============================================================================

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    words: TesseractWord[];
  };
}

// ============================================================================
// TROCR MODEL (lazy loaded)
// ============================================================================

 
let trOCRPipeline: any = null;

const loadTrOCR = async (): Promise<typeof trOCRPipeline> => {
  if (trOCRPipeline) return trOCRPipeline;

  console.log("[OCR Quality] Loading TrOCR model (first time only)...");
  trOCRPipeline = await pipeline(
    "image-to-text",
    "Xenova/trocr-small-printed",
    { dtype: "q8" } // quantized for browser
  );
  console.log("[OCR Quality] TrOCR model loaded");
  return trOCRPipeline;
};

// ============================================================================
// OCR QUALITY SERVICE INTERFACE
// ============================================================================

export interface OCRQualityService {
  /**
   * Analyze OCR quality from Tesseract word-level output
   */
  readonly analyzeQuality: (
    words: OCRWord[],
    config?: Partial<OCRQualityConfig>
  ) => Effect.Effect<OCRQualityResult, never, never>;

  /**
   * Run Tesseract with word-level output and quality analysis
   */
  readonly runOCRWithQuality: (
    image: Blob | ImageData,
    config?: Partial<OCRQualityConfig>
  ) => Effect.Effect<
    { text: string; quality: OCRQualityResult },
    OCRError,
    never
  >;

  /**
   * Repair low-confidence regions using TrOCR
   */
  readonly repairWithTrOCR: (
    image: Blob | ImageData,
    regions: LowConfidenceRegion[],
    canvas?: HTMLCanvasElement
  ) => Effect.Effect<LowConfidenceRegion[], OCRError, never>;
}

export const OCRQualityService = Context.GenericTag<OCRQualityService>(
  "OCRQualityService"
);

// ============================================================================
// QUALITY METRICS COMPUTATION
// ============================================================================

const computeMetrics = (words: OCRWord[]): OCRQualityMetrics => {
  if (words.length === 0) {
    return {
      medianWordConfidence: 0,
      meanWordConfidence: 0,
      minWordConfidence: 0,
      alphaRatio: 0,
      digitRatio: 0,
      punctuationRatio: 0,
      totalWords: 0,
      garbageTokenCount: 0,
      garbageTokenRatio: 0,
      charsPerPage: 0,
      wordsPerPage: 0,
    };
  }

  // Confidence analysis
  const confidences = words.map((w) => w.confidence).sort((a, b) => a - b);
  const medianWordConfidence =
    confidences.length % 2 === 0
      ? (confidences[confidences.length / 2 - 1] +
          confidences[confidences.length / 2]) /
        2
      : confidences[Math.floor(confidences.length / 2)];
  const meanWordConfidence =
    confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const minWordConfidence = confidences[0];

  // Character analysis
  const allText = words.map((w) => w.text).join("");
  const totalChars = allText.length;
  const alphaChars = (allText.match(/[a-zA-Z]/g) || []).length;
  const digitChars = (allText.match(/[0-9]/g) || []).length;
  const punctChars = (allText.match(/[^\w\s]/g) || []).length;

  const alphaRatio = totalChars > 0 ? alphaChars / totalChars : 0;
  const digitRatio = totalChars > 0 ? digitChars / totalChars : 0;
  const punctuationRatio = totalChars > 0 ? punctChars / totalChars : 0;

  // Garbage token analysis
  const garbageTokenCount = words.filter(
    (w) => w.isGarbage || isGarbageToken(w.text)
  ).length;
  const garbageTokenRatio =
    words.length > 0 ? garbageTokenCount / words.length : 0;

  return {
    medianWordConfidence,
    meanWordConfidence,
    minWordConfidence,
    alphaRatio,
    digitRatio,
    punctuationRatio,
    totalWords: words.length,
    garbageTokenCount,
    garbageTokenRatio,
    charsPerPage: totalChars,
    wordsPerPage: words.length,
  };
};

// ============================================================================
// QUALITY SCORING
// ============================================================================

const computeScore = (
  metrics: OCRQualityMetrics,
  config: OCRQualityConfig
): number => {
  // Base score from median confidence (0-100 → 0-0.5)
  const confidenceScore = (metrics.medianWordConfidence / 100) * 0.5;

  // Alpha ratio bonus (0-0.25)
  const alphaScore = Math.min(metrics.alphaRatio / config.minAlphaRatio, 1) * 0.25;

  // Garbage penalty (0-0.25)
  const garbagePenalty =
    Math.min(metrics.garbageTokenRatio / config.maxGarbageRatio, 1) * 0.25;

  // Sparse text penalty
  const sparsePenalty = metrics.totalWords < 10 ? 0.1 : 0;

  // Final score (0-1)
  const score = Math.max(
    0,
    Math.min(1, confidenceScore + alphaScore - garbagePenalty - sparsePenalty)
  );

  return score;
};

// ============================================================================
// FLAG DETECTION
// ============================================================================

const detectFlags = (
  metrics: OCRQualityMetrics,
  config: OCRQualityConfig,
  hasOCRMarker: boolean
): OCRQualityFlag[] => {
  const flags: OCRQualityFlag[] = [];

  if (metrics.medianWordConfidence < config.wordConfidenceThreshold) {
    flags.push("LOW_CONFIDENCE");
  }

  if (metrics.garbageTokenRatio > config.maxGarbageRatio) {
    flags.push("HIGH_GARBAGE_DENSITY");
  }

  if (metrics.alphaRatio < config.minAlphaRatio) {
    flags.push("LOW_ALPHA_RATIO");
  }

  if (metrics.totalWords < 10) {
    flags.push("SPARSE_TEXT");
  }

  if (hasOCRMarker) {
    flags.push("OCR_RECOVERY_MARKER");
  }

  return flags;
};

// ============================================================================
// LOW CONFIDENCE REGION DETECTION
// ============================================================================

const findLowConfidenceRegions = (
  words: OCRWord[],
  config: OCRQualityConfig
): LowConfidenceRegion[] => {
  const lowConfWords = words.filter(
    (w) => w.confidence < config.trOCRConfidenceThreshold
  );

  if (lowConfWords.length === 0) return [];

  // Group adjacent low-confidence words into regions
  const regions: LowConfidenceRegion[] = [];
  let currentRegion: OCRWord[] = [];

  for (const word of lowConfWords) {
    if (currentRegion.length === 0) {
      currentRegion.push(word);
      continue;
    }

    // Check if word is adjacent (within 50px)
    const lastWord = currentRegion[currentRegion.length - 1];
    const distance = Math.abs(
      word.bbox.x - (lastWord.bbox.x + lastWord.bbox.width)
    );
    const sameRow = Math.abs(word.bbox.y - lastWord.bbox.y) < 20;

    if (distance < 50 && sameRow) {
      currentRegion.push(word);
    } else {
      // Finish current region
      if (currentRegion.length > 0) {
        regions.push(wordsToRegion(currentRegion));
      }
      currentRegion = [word];
    }
  }

  // Don't forget last region
  if (currentRegion.length > 0) {
    regions.push(wordsToRegion(currentRegion));
  }

  // Limit regions to repair
  return regions.slice(0, config.maxRegionsToRepair);
};

const wordsToRegion = (words: OCRWord[]): LowConfidenceRegion => {
  const minX = Math.min(...words.map((w) => w.bbox.x));
  const minY = Math.min(...words.map((w) => w.bbox.y));
  const maxX = Math.max(...words.map((w) => w.bbox.x + w.bbox.width));
  const maxY = Math.max(...words.map((w) => w.bbox.y + w.bbox.height));

  return {
    bbox: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
    originalText: words.map((w) => w.text).join(" "),
    confidence:
      words.reduce((sum, w) => sum + w.confidence, 0) / words.length,
    wordCount: words.length,
  };
};

// ============================================================================
// TESSERACT WORD CONVERSION
// ============================================================================

const convertTesseractWords = (tesseractWords: TesseractWord[]): OCRWord[] => {
  return tesseractWords.map((tw) => ({
    text: tw.text,
    confidence: tw.confidence,
    bbox: {
      x: tw.bbox.x0,
      y: tw.bbox.y0,
      width: tw.bbox.x1 - tw.bbox.x0,
      height: tw.bbox.y1 - tw.bbox.y0,
    },
    isGarbage: isGarbageToken(tw.text),
  }));
};

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class OCRQualityServiceImpl implements OCRQualityService {
  readonly analyzeQuality = (
    words: OCRWord[],
    configOverrides?: Partial<OCRQualityConfig>
  ) => {
    return Effect.sync(() => {
      const config = { ...defaultOCRQualityConfig, ...configOverrides };
      const startTime = performance.now();

      // Compute metrics
      const metrics = computeMetrics(words);

      // Compute score
      const score = computeScore(metrics, config);

      // Determine level
      let level: OCRQualityLevel;
      if (score >= config.highQualityThreshold) {
        level = "HIGH";
      } else if (score >= config.lowQualityThreshold) {
        level = "MEDIUM";
      } else {
        level = "LOW";
      }

      // Detect flags
      const hasOCRMarker = words.some((w) =>
        w.text.includes("[OCR_RECOVERED")
      );
      const flags = detectFlags(metrics, config, hasOCRMarker);

      // Find low-confidence regions
      const lowConfidenceRegions = findLowConfidenceRegions(words, config);

      // Add review flag if quality is medium or low
      if (level !== "HIGH" && !flags.includes("NEEDS_MANUAL_REVIEW")) {
        flags.push("NEEDS_MANUAL_REVIEW");
      }

      const processingTimeMs = Math.round(performance.now() - startTime);

      return {
        score,
        level,
        metrics,
        flags,
        lowConfidenceRegions,
        processingTimeMs,
        trOCRApplied: false,
      } satisfies OCRQualityResult;
    });
  };

  readonly runOCRWithQuality = (
    image: Blob | ImageData,
    configOverrides?: Partial<OCRQualityConfig>
  ) => {
    return Effect.gen(this, function* (_) {
      const config = { ...defaultOCRQualityConfig, ...configOverrides };

      // Run Tesseract with word-level output
      const tesseractResult = yield* _(
        Effect.tryPromise({
          try: async (): Promise<TesseractResult> => {
            const result = await Tesseract.recognize(image, "eng", {
              logger: (m) => {
                if (m.status === "recognizing text") {
                  console.debug(
                    `[OCR] Progress: ${Math.round(m.progress * 100)}%`
                  );
                }
              },
            });
            return result as TesseractResult;
          },
          catch: (_error) =>
            new OCRError({
              file: "image",
              confidence: 0,
              suggestion:
                "Image quality may be too low. Try increasing resolution.",
            }),
        })
      );

      // Convert to our word format
      const words = convertTesseractWords(tesseractResult.data.words || []);

      // Analyze quality
      let quality = yield* _(this.analyzeQuality(words, config));

      // If LOW quality and TrOCR enabled, attempt repair
      if (
        quality.level === "LOW" &&
        config.enableTrOCR &&
        quality.lowConfidenceRegions.length > 0
      ) {
        console.log(
          `[OCR Quality] Low quality detected (score: ${quality.score.toFixed(2)}). ` +
            `Attempting TrOCR repair on ${quality.lowConfidenceRegions.length} regions...`
        );

        // Note: TrOCR repair requires canvas context which we don't have here
        // The caller should use repairWithTrOCR if they have canvas access
        quality = {
          ...quality,
          flags: [...quality.flags, "NEEDS_MANUAL_REVIEW"],
        };
      }

      return {
        text: tesseractResult.data.text,
        quality,
      };
    });
  };

  readonly repairWithTrOCR = (
    image: Blob | ImageData,
    regions: LowConfidenceRegion[],
    canvas?: HTMLCanvasElement
  ) => {
    return Effect.tryPromise({
      try: async () => {
        if (regions.length === 0) return regions;

        // Load TrOCR model
        const model = await loadTrOCR();

        if (!model) {
          console.warn("[OCR Quality] TrOCR model not available, skipping repair");
          return regions;
        }

        // For each region, crop and run TrOCR
        const repairedRegions: LowConfidenceRegion[] = [];

        for (const region of regions) {
          try {
            // Create canvas for cropping if not provided
            const cropCanvas = canvas || document.createElement("canvas");
            const ctx = cropCanvas.getContext("2d");

            if (!ctx) {
              repairedRegions.push(region);
              continue;
            }

            // We need the original image as ImageBitmap
            const imageBitmap = await createImageBitmap(image);

            // Crop the region
            cropCanvas.width = region.bbox.width;
            cropCanvas.height = region.bbox.height;
            ctx.drawImage(
              imageBitmap,
              region.bbox.x,
              region.bbox.y,
              region.bbox.width,
              region.bbox.height,
              0,
              0,
              region.bbox.width,
              region.bbox.height
            );

            // Convert to blob for TrOCR
            const cropBlob = await new Promise<Blob>((resolve, reject) => {
              cropCanvas.toBlob((b) => (b ? resolve(b) : reject("Blob is null")));
            });

            // Run TrOCR
            const result = await model(cropBlob);
            const repairedText =
              Array.isArray(result) && result[0]?.generated_text
                ? result[0].generated_text
                : region.originalText;

            repairedRegions.push({
              ...region,
              repairedText,
            });

            console.log(
              `[TrOCR] Repaired: "${region.originalText}" → "${repairedText}"`
            );
          } catch (error) {
            console.warn(
              `[TrOCR] Failed to repair region: ${error}`,
              region
            );
            repairedRegions.push(region);
          }
        }

        return repairedRegions;
      },
      catch: (error) =>
        new OCRError({
          file: "trocr-repair",
          confidence: 0,
          suggestion: `TrOCR repair failed: ${error}`,
        }),
    });
  };
}

// ============================================================================
// SERVICE LAYER
// ============================================================================

export const OCRQualityServiceLive = Layer.succeed(
  OCRQualityService,
  new OCRQualityServiceImpl()
);

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run OCR with quality analysis (convenience wrapper)
 */
export const runOCRWithQuality = (
  image: Blob | ImageData,
  config?: Partial<OCRQualityConfig>
): Effect.Effect<
  { text: string; quality: OCRQualityResult },
  OCRError,
  OCRQualityService
> => {
  return Effect.gen(function* (_) {
    const service = yield* _(OCRQualityService);
    return yield* _(service.runOCRWithQuality(image, config));
  });
};

/**
 * Analyze quality from existing word data
 */
export const analyzeOCRQuality = (
  words: OCRWord[],
  config?: Partial<OCRQualityConfig>
): Effect.Effect<OCRQualityResult, never, OCRQualityService> => {
  return Effect.gen(function* (_) {
    const service = yield* _(OCRQualityService);
    return yield* _(service.analyzeQuality(words, config));
  });
};

/**
 * Simple quality check (for quick gating)
 */
export const isHighQualityOCR = (quality: OCRQualityResult): boolean => {
  return quality.level === "HIGH";
};

/**
 * Check if document needs review
 */
export const needsManualReview = (quality: OCRQualityResult): boolean => {
  return (
    quality.flags.includes("NEEDS_MANUAL_REVIEW") ||
    quality.level === "LOW" ||
    quality.score < 0.5
  );
};
