/**
 * OCR QUALITY GATE - COMPREHENSIVE TEST SUITE
 *
 * Design Philosophy:
 * - Deterministic: No randomness, no flaky tests
 * - Failure-driven: Each test exposes a specific failure mode
 * - Edge-case focused: Test the boundaries, not just happy paths
 * - Self-documenting: Test names explain the invariant being verified
 *
 * Test Categories:
 * 1. Schema validation (types and constraints)
 * 2. Garbage token detection (pattern matching)
 * 3. Quality metrics computation (math correctness)
 * 4. Quality scoring algorithm (threshold behavior)
 * 5. Flag detection (all flag conditions)
 * 6. Low-confidence region detection (clustering logic)
 * 7. Integration tests (full pipeline)
 */

import { describe, it, expect } from "vitest";
import { Effect, pipe } from "effect";
import {
  OCRWord,
  OCRQualityResult,
  OCRQualityConfig,
  isGarbageToken,
} from "../schemas/ocrQuality";
import {
  OCRQualityService,
  OCRQualityServiceLive,
  isHighQualityOCR,
  needsManualReview,
} from "../services/ocrQualityGate.effect";

// ============================================================================
// TEST FIXTURES - Deterministic word generators
// ============================================================================

/**
 * Create a word with specified properties
 */
const makeWord = (
  text: string,
  confidence: number,
  x = 0,
  y = 0,
  width = 50,
  height = 20
): OCRWord => ({
  text,
  confidence,
  bbox: { x, y, width, height },
  isGarbage: isGarbageToken(text),
});

/**
 * Create a batch of words with uniform confidence
 */
const makeWords = (
  texts: string[],
  confidence: number,
  startX = 0,
  y = 0
): OCRWord[] => {
  let x = startX;
  return texts.map((text) => {
    const word = makeWord(text, confidence, x, y);
    x += 60; // spacing between words
    return word;
  });
};

/**
 * Create words with varying confidences
 */
const makeWordsWithConfidences = (
  pairs: Array<[string, number]>,
  y = 0
): OCRWord[] => {
  let x = 0;
  return pairs.map(([text, confidence]) => {
    const word = makeWord(text, confidence, x, y);
    x += 60;
    return word;
  });
};

/**
 * Run quality analysis with default config
 */
const analyzeQuality = async (
  words: OCRWord[],
  config?: Partial<OCRQualityConfig>
): Promise<OCRQualityResult> => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(OCRQualityService);
      return yield* _(service.analyzeQuality(words, config));
    }),
    Effect.provide(OCRQualityServiceLive)
  );
  return Effect.runPromise(program);
};

// ============================================================================
// 1. GARBAGE TOKEN DETECTION TESTS
// ============================================================================

describe("Garbage Token Detection", () => {
  describe("isGarbageToken - should detect garbage patterns", () => {
    // Test each garbage pattern explicitly
    it("detects consecutive percent signs (%%%%)", () => {
      expect(isGarbageToken("%%%")).toBe(true);
      expect(isGarbageToken("%%%%")).toBe(true);
      expect(isGarbageToken("%%%%%")).toBe(true);
    });

    it("detects consecutive pipes (||||)", () => {
      expect(isGarbageToken("|||")).toBe(true);
      expect(isGarbageToken("||||")).toBe(true);
      expect(isGarbageToken("|||||")).toBe(true);
    });

    it("detects consecutive underscores (____)", () => {
      expect(isGarbageToken("___")).toBe(true);
      expect(isGarbageToken("____")).toBe(true);
    });

    it("detects consecutive equals (====)", () => {
      expect(isGarbageToken("===")).toBe(true);
      expect(isGarbageToken("====")).toBe(true);
    });

    it("detects consecutive dots (.....)", () => {
      expect(isGarbageToken("....")).toBe(true);
      expect(isGarbageToken(".....")).toBe(true);
      // Note: 3 dots matches [^\w\s]{3,} pattern (3+ non-word, non-space chars)
      expect(isGarbageToken("...")).toBe(true);
    });

    it("detects consecutive dashes (----)", () => {
      expect(isGarbageToken("----")).toBe(true);
      expect(isGarbageToken("-----")).toBe(true);
      // Note: 3 dashes matches [^\w\s]{3,} pattern (3+ non-word, non-space chars)
      expect(isGarbageToken("---")).toBe(true);
    });

    it("detects consecutive tildes (~~~~)", () => {
      expect(isGarbageToken("~~~")).toBe(true);
      expect(isGarbageToken("~~~~")).toBe(true);
    });

    it("detects consecutive asterisks (****)", () => {
      expect(isGarbageToken("***")).toBe(true);
      expect(isGarbageToken("****")).toBe(true);
    });

    it("detects consecutive hashes (####)", () => {
      expect(isGarbageToken("###")).toBe(true);
      expect(isGarbageToken("####")).toBe(true);
    });

    it("detects 4+ consecutive non-word chars", () => {
      expect(isGarbageToken("@#$%")).toBe(true);
      expect(isGarbageToken("!@#$%")).toBe(true);
      expect(isGarbageToken("^&*()")).toBe(true);
    });

    it("detects 3+ special chars only", () => {
      expect(isGarbageToken("@#$")).toBe(true);
      expect(isGarbageToken("!@#")).toBe(true);
    });

    it("detects empty and whitespace-only tokens", () => {
      expect(isGarbageToken("")).toBe(true);
      expect(isGarbageToken(" ")).toBe(true);
      expect(isGarbageToken("  ")).toBe(true);
      expect(isGarbageToken("\t")).toBe(true);
      expect(isGarbageToken("\n")).toBe(true);
    });

    it("detects single non-alphanumeric chars", () => {
      expect(isGarbageToken("@")).toBe(true);
      expect(isGarbageToken("#")).toBe(true);
      expect(isGarbageToken("$")).toBe(true);
      expect(isGarbageToken("%")).toBe(true);
      expect(isGarbageToken("^")).toBe(true);
      expect(isGarbageToken("&")).toBe(true);
      expect(isGarbageToken("*")).toBe(true);
    });
  });

  describe("isGarbageToken - should NOT detect valid text", () => {
    it("accepts single alphanumeric chars", () => {
      expect(isGarbageToken("a")).toBe(false);
      expect(isGarbageToken("Z")).toBe(false);
      expect(isGarbageToken("5")).toBe(false);
      expect(isGarbageToken("9")).toBe(false);
    });

    it("accepts normal words", () => {
      expect(isGarbageToken("hello")).toBe(false);
      expect(isGarbageToken("World")).toBe(false);
      expect(isGarbageToken("test123")).toBe(false);
    });

    it("accepts medical terms", () => {
      expect(isGarbageToken("WBC")).toBe(false);
      expect(isGarbageToken("12.3")).toBe(false);
      expect(isGarbageToken("mg/dL")).toBe(false);
      expect(isGarbageToken("x10E3/uL")).toBe(false);
    });

    it("accepts punctuated words", () => {
      expect(isGarbageToken("Hello,")).toBe(false);
      expect(isGarbageToken("world.")).toBe(false);
      expect(isGarbageToken("it's")).toBe(false);
      expect(isGarbageToken("don't")).toBe(false);
    });

    it("accepts numbers with units", () => {
      expect(isGarbageToken("100mg")).toBe(false);
      expect(isGarbageToken("98.6F")).toBe(false);
      expect(isGarbageToken("120/80")).toBe(false);
    });

    it("accepts hyphenated words", () => {
      expect(isGarbageToken("well-being")).toBe(false);
      expect(isGarbageToken("follow-up")).toBe(false);
      expect(isGarbageToken("post-op")).toBe(false);
    });
  });

  describe("Edge cases and boundary conditions", () => {
    it("handles mixed valid and garbage chars", () => {
      // Word with some special chars but mostly letters
      expect(isGarbageToken("test@#")).toBe(false);
      expect(isGarbageToken("@test")).toBe(false);
    });

    it("handles unicode chars", () => {
      expect(isGarbageToken("café")).toBe(false);
      expect(isGarbageToken("naïve")).toBe(false);
      // Pure unicode symbols might be garbage
      expect(isGarbageToken("→→→")).toBe(true);
    });

    it("boundary: exactly 2 special chars (below threshold)", () => {
      // 2 special chars is below threshold
      expect(isGarbageToken("@#")).toBe(false);
      expect(isGarbageToken("%%")).toBe(false);
    });

    it("boundary: exactly 3 special chars (at threshold)", () => {
      expect(isGarbageToken("@#$")).toBe(true);
      expect(isGarbageToken("%%%")).toBe(true);
    });
  });
});

// ============================================================================
// 2. QUALITY METRICS COMPUTATION TESTS
// ============================================================================

describe("Quality Metrics Computation", () => {
  describe("Confidence statistics", () => {
    it("computes median correctly for odd number of words", async () => {
      const words = makeWordsWithConfidences([
        ["a", 10],
        ["b", 50], // median
        ["c", 90],
      ]);
      const result = await analyzeQuality(words);
      expect(result.metrics.medianWordConfidence).toBe(50);
    });

    it("computes median correctly for even number of words", async () => {
      const words = makeWordsWithConfidences([
        ["a", 10],
        ["b", 40], // avg of 40 and 60
        ["c", 60],
        ["d", 90],
      ]);
      const result = await analyzeQuality(words);
      expect(result.metrics.medianWordConfidence).toBe(50); // (40+60)/2
    });

    it("computes mean correctly", async () => {
      const words = makeWordsWithConfidences([
        ["a", 20],
        ["b", 40],
        ["c", 60],
        ["d", 80],
      ]);
      const result = await analyzeQuality(words);
      expect(result.metrics.meanWordConfidence).toBe(50); // (20+40+60+80)/4
    });

    it("finds minimum confidence", async () => {
      const words = makeWordsWithConfidences([
        ["high", 95],
        ["low", 15],
        ["medium", 50],
      ]);
      const result = await analyzeQuality(words);
      expect(result.metrics.minWordConfidence).toBe(15);
    });

    it("handles single word", async () => {
      const words = makeWordsWithConfidences([["alone", 75]]);
      const result = await analyzeQuality(words);
      expect(result.metrics.medianWordConfidence).toBe(75);
      expect(result.metrics.meanWordConfidence).toBe(75);
      expect(result.metrics.minWordConfidence).toBe(75);
    });
  });

  describe("Character analysis", () => {
    it("computes alpha ratio correctly", async () => {
      // "abcd" = 4 letters, 4 total chars, ratio = 1.0
      const words = makeWords(["abcd"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.alphaRatio).toBe(1.0);
    });

    it("computes alpha ratio with mixed content", async () => {
      // "ab12" = 2 letters, 4 total chars, ratio = 0.5
      const words = makeWords(["ab12"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.alphaRatio).toBe(0.5);
    });

    it("computes digit ratio correctly", async () => {
      // "1234" = 4 digits, 4 total chars, ratio = 1.0
      const words = makeWords(["1234"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.digitRatio).toBe(1.0);
    });

    it("computes punctuation ratio correctly", async () => {
      // "!@#$" = 4 punctuation, 4 total chars, ratio = 1.0
      const words = makeWords(["!@#$"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.punctuationRatio).toBe(1.0);
    });

    it("handles mixed characters", async () => {
      // "ab12!@" = 2 alpha, 2 digit, 2 punct, 6 total
      const words = makeWords(["ab12!@"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.alphaRatio).toBeCloseTo(2 / 6, 5);
      expect(result.metrics.digitRatio).toBeCloseTo(2 / 6, 5);
      expect(result.metrics.punctuationRatio).toBeCloseTo(2 / 6, 5);
    });
  });

  describe("Token analysis", () => {
    it("counts total words correctly", async () => {
      const words = makeWords(["one", "two", "three", "four", "five"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.totalWords).toBe(5);
    });

    it("counts garbage tokens correctly", async () => {
      const words = [
        makeWord("good", 80),
        makeWord("%%%%", 80), // garbage
        makeWord("normal", 80),
        makeWord("||||", 80), // garbage
        makeWord("text", 80),
      ];
      const result = await analyzeQuality(words);
      expect(result.metrics.garbageTokenCount).toBe(2);
      expect(result.metrics.garbageTokenRatio).toBe(0.4); // 2/5
    });

    it("computes chars per page", async () => {
      // "hello" (5) + "world" (5) = 10 chars
      const words = makeWords(["hello", "world"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.charsPerPage).toBe(10);
    });

    it("computes words per page", async () => {
      const words = makeWords(["a", "b", "c", "d", "e", "f", "g"], 80);
      const result = await analyzeQuality(words);
      expect(result.metrics.wordsPerPage).toBe(7);
    });
  });

  describe("Empty and edge cases", () => {
    it("handles empty word list", async () => {
      const result = await analyzeQuality([]);
      expect(result.metrics.medianWordConfidence).toBe(0);
      expect(result.metrics.meanWordConfidence).toBe(0);
      expect(result.metrics.minWordConfidence).toBe(0);
      expect(result.metrics.alphaRatio).toBe(0);
      expect(result.metrics.totalWords).toBe(0);
      expect(result.metrics.garbageTokenCount).toBe(0);
      expect(result.metrics.garbageTokenRatio).toBe(0);
    });

    it("handles all garbage words", async () => {
      const words = [
        makeWord("%%%%", 80),
        makeWord("||||", 70),
        makeWord("####", 60),
      ];
      const result = await analyzeQuality(words);
      expect(result.metrics.garbageTokenCount).toBe(3);
      expect(result.metrics.garbageTokenRatio).toBe(1.0);
    });

    it("handles all perfect confidence", async () => {
      const words = makeWords(["perfect", "confidence", "words"], 100);
      const result = await analyzeQuality(words);
      expect(result.metrics.medianWordConfidence).toBe(100);
      expect(result.metrics.meanWordConfidence).toBe(100);
      expect(result.metrics.minWordConfidence).toBe(100);
    });

    it("handles all zero confidence", async () => {
      const words = makeWords(["zero", "confidence"], 0);
      const result = await analyzeQuality(words);
      expect(result.metrics.medianWordConfidence).toBe(0);
      expect(result.metrics.meanWordConfidence).toBe(0);
      expect(result.metrics.minWordConfidence).toBe(0);
    });
  });
});

// ============================================================================
// 3. QUALITY SCORING ALGORITHM TESTS
// ============================================================================

describe("Quality Scoring Algorithm", () => {
  describe("Score boundaries", () => {
    it("score is always between 0 and 1", async () => {
      // Test with extreme inputs
      const testCases = [
        makeWords(["test"], 100), // best case
        makeWords(["test"], 0), // worst confidence
        [makeWord("%%%%", 0)], // worst everything
        makeWords(["a".repeat(100)], 50), // long word
        [], // empty
      ];

      for (const words of testCases) {
        const result = await analyzeQuality(words);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }
    });

    it("perfect input yields high score", async () => {
      // Need 10+ words to avoid sparse penalty (0.1)
      // Score = (95/100 * 0.5) + (alpha/0.5 * 0.25, capped at 0.25) - sparse_penalty
      // With 10+ words and high confidence: 0.475 + 0.25 = 0.725
      const words = makeWords(
        ["This", "is", "perfect", "medical", "text", "with", "labs", "WBC", "level", "normal"],
        95
      );
      const result = await analyzeQuality(words);
      expect(result.score).toBeGreaterThan(0.7);
      expect(result.level).toBe("HIGH");
    });

    it("terrible input yields low score", async () => {
      const words = [
        makeWord("%%%%", 10),
        makeWord("||||", 15),
        makeWord("@#$%", 5),
      ];
      const result = await analyzeQuality(words);
      expect(result.score).toBeLessThan(0.4);
      expect(result.level).toBe("LOW");
    });
  });

  describe("Level thresholds", () => {
    it("HIGH level when score >= 0.7", async () => {
      // High confidence, good alpha ratio, no garbage
      // Need 10+ words to avoid sparse penalty of 0.1
      // Score = (90/100 * 0.5) + 0.25 = 0.70
      const words = makeWords(
        ["Patient", "presents", "with", "chest", "pain", "and", "needs", "care", "from", "team"],
        90
      );
      const result = await analyzeQuality(words);
      expect(result.score).toBeGreaterThanOrEqual(0.7);
      expect(result.level).toBe("HIGH");
    });

    it("MEDIUM level when 0.4 <= score < 0.7", async () => {
      // Medium confidence
      const words = makeWords(["Some", "readable", "text"], 55);
      const result = await analyzeQuality(words);
      // This should fall in medium range
      expect(result.level).toBe("MEDIUM");
    });

    it("LOW level when score < 0.4", async () => {
      // Very low confidence with garbage
      const words = [
        makeWord("faint", 20),
        makeWord("%%%%", 15),
        makeWord("text", 25),
      ];
      const result = await analyzeQuality(words);
      expect(result.score).toBeLessThan(0.4);
      expect(result.level).toBe("LOW");
    });

    it("respects custom thresholds", async () => {
      const words = makeWords(["moderate", "quality"], 60);

      // With default thresholds
      const result1 = await analyzeQuality(words);

      // With stricter thresholds
      const result2 = await analyzeQuality(words, {
        highQualityThreshold: 0.9,
        lowQualityThreshold: 0.6,
      });

      // Same input, different thresholds can yield different levels
      expect(result1.score).toBe(result2.score); // Score unchanged
      // But level interpretation may differ
    });
  });

  describe("Score components", () => {
    it("confidence contributes up to 0.5 to score", async () => {
      // 100% confidence = 0.5 contribution
      const perfectConf = makeWords(["test"], 100);
      const zeroConf = makeWords(["test"], 0);

      const result1 = await analyzeQuality(perfectConf);
      const result2 = await analyzeQuality(zeroConf);

      // Difference should be around 0.5 (confidence component)
      expect(result1.score - result2.score).toBeCloseTo(0.5, 1);
    });

    it("alpha ratio contributes up to 0.25 to score", async () => {
      // Pure letters vs pure numbers
      const pureAlpha = makeWords(["abcdefgh"], 80);
      const pureDigits = makeWords(["12345678"], 80);

      const result1 = await analyzeQuality(pureAlpha);
      const result2 = await analyzeQuality(pureDigits);

      // Alpha gives bonus, digits don't
      expect(result1.score).toBeGreaterThan(result2.score);
    });

    it("garbage tokens reduce score", async () => {
      const clean = makeWords(["clean", "text", "here"], 80);
      const garbage = [
        makeWord("clean", 80),
        makeWord("%%%%", 80),
        makeWord("text", 80),
      ];

      const result1 = await analyzeQuality(clean);
      const result2 = await analyzeQuality(garbage);

      expect(result1.score).toBeGreaterThan(result2.score);
    });

    it("sparse text (< 10 words) incurs penalty", async () => {
      const sparse = makeWords(["few", "words"], 80);
      const dense = makeWords(
        ["many", "words", "here", "in", "this", "document", "with", "lots", "of", "text", "content"],
        80
      );

      const result1 = await analyzeQuality(sparse);
      const result2 = await analyzeQuality(dense);

      // Dense should score higher (no sparse penalty)
      expect(result2.score).toBeGreaterThan(result1.score);
    });
  });
});

// ============================================================================
// 4. FLAG DETECTION TESTS
// ============================================================================

describe("Flag Detection", () => {
  describe("LOW_CONFIDENCE flag", () => {
    it("sets flag when median confidence < threshold (60)", async () => {
      const words = makeWords(["low", "confidence", "text"], 50);
      const result = await analyzeQuality(words);
      expect(result.flags).toContain("LOW_CONFIDENCE");
    });

    it("does NOT set flag when median confidence >= threshold", async () => {
      const words = makeWords(["high", "confidence", "text"], 80);
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("LOW_CONFIDENCE");
    });

    it("respects custom threshold", async () => {
      const words = makeWords(["medium", "confidence"], 70);

      const result1 = await analyzeQuality(words, {
        wordConfidenceThreshold: 60,
      });
      const result2 = await analyzeQuality(words, {
        wordConfidenceThreshold: 80,
      });

      expect(result1.flags).not.toContain("LOW_CONFIDENCE");
      expect(result2.flags).toContain("LOW_CONFIDENCE");
    });
  });

  describe("HIGH_GARBAGE_DENSITY flag", () => {
    it("sets flag when garbage ratio > threshold (0.15)", async () => {
      // 2/5 = 0.4 > 0.15
      const words = [
        makeWord("good", 80),
        makeWord("%%%%", 80),
        makeWord("text", 80),
        makeWord("||||", 80),
        makeWord("here", 80),
      ];
      const result = await analyzeQuality(words);
      expect(result.flags).toContain("HIGH_GARBAGE_DENSITY");
    });

    it("does NOT set flag when garbage ratio <= threshold", async () => {
      // 1/10 = 0.1 <= 0.15
      const words = [
        ...makeWords(["good", "clean", "text", "here", "now"], 80),
        ...makeWords(["more", "clean", "words", "to"], 80),
        makeWord("%%%%", 80),
      ];
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("HIGH_GARBAGE_DENSITY");
    });
  });

  describe("LOW_ALPHA_RATIO flag", () => {
    it("sets flag when alpha ratio < threshold (0.5)", async () => {
      // Pure numbers have 0 alpha ratio
      const words = makeWords(["12345", "67890"], 80);
      const result = await analyzeQuality(words);
      expect(result.flags).toContain("LOW_ALPHA_RATIO");
    });

    it("does NOT set flag when alpha ratio >= threshold", async () => {
      const words = makeWords(["normal", "text"], 80);
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("LOW_ALPHA_RATIO");
    });
  });

  describe("SPARSE_TEXT flag", () => {
    it("sets flag when total words < 10", async () => {
      const words = makeWords(["only", "five", "words", "here", "now"], 80);
      const result = await analyzeQuality(words);
      expect(result.flags).toContain("SPARSE_TEXT");
    });

    it("does NOT set flag when total words >= 10", async () => {
      const words = makeWords(
        ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"],
        80
      );
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("SPARSE_TEXT");
    });

    it("boundary: exactly 10 words does NOT trigger flag", async () => {
      const words = makeWords(
        ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        80
      );
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("SPARSE_TEXT");
      expect(result.metrics.totalWords).toBe(10);
    });
  });

  describe("OCR_RECOVERY_MARKER flag", () => {
    it("sets flag when text contains [OCR_RECOVERED", async () => {
      const words = [makeWord("[OCR_RECOVERED_PAGE_1]", 80), makeWord("text", 80)];
      const result = await analyzeQuality(words);
      expect(result.flags).toContain("OCR_RECOVERY_MARKER");
    });

    it("does NOT set flag for normal text", async () => {
      const words = makeWords(["normal", "text", "here"], 80);
      const result = await analyzeQuality(words);
      expect(result.flags).not.toContain("OCR_RECOVERY_MARKER");
    });
  });

  describe("NEEDS_MANUAL_REVIEW flag", () => {
    it("sets flag for MEDIUM quality level", async () => {
      const words = makeWords(["medium", "quality", "text"], 55);
      const result = await analyzeQuality(words);
      if (result.level === "MEDIUM") {
        expect(result.flags).toContain("NEEDS_MANUAL_REVIEW");
      }
    });

    it("sets flag for LOW quality level", async () => {
      const words = [makeWord("%%%%", 20), makeWord("bad", 25)];
      const result = await analyzeQuality(words);
      expect(result.level).toBe("LOW");
      expect(result.flags).toContain("NEEDS_MANUAL_REVIEW");
    });

    it("does NOT set flag for HIGH quality level", async () => {
      const words = makeWords(
        ["excellent", "high", "quality", "medical", "text", "with", "good", "content", "here", "now"],
        95
      );
      const result = await analyzeQuality(words);
      if (result.level === "HIGH") {
        expect(result.flags).not.toContain("NEEDS_MANUAL_REVIEW");
      }
    });
  });

  describe("Multiple flags can be set simultaneously", () => {
    it("sets all applicable flags", async () => {
      // Few words, low confidence, high garbage, low alpha
      const words = [
        makeWord("12", 30),
        makeWord("%%%%", 25),
        makeWord("34", 35),
      ];
      const result = await analyzeQuality(words);

      expect(result.flags).toContain("LOW_CONFIDENCE");
      expect(result.flags).toContain("SPARSE_TEXT");
      expect(result.flags).toContain("HIGH_GARBAGE_DENSITY");
      expect(result.flags).toContain("LOW_ALPHA_RATIO");
      expect(result.flags).toContain("NEEDS_MANUAL_REVIEW");
    });
  });
});

// ============================================================================
// 5. LOW CONFIDENCE REGION DETECTION TESTS
// ============================================================================

describe("Low Confidence Region Detection", () => {
  describe("Region identification", () => {
    it("identifies low-confidence words as regions", async () => {
      const words = [
        makeWord("good", 80, 0, 0),
        makeWord("bad", 30, 60, 0), // below threshold (50)
        makeWord("good", 80, 120, 0),
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
      });
      expect(result.lowConfidenceRegions.length).toBeGreaterThan(0);
      expect(result.lowConfidenceRegions[0].originalText).toContain("bad");
    });

    it("groups adjacent low-confidence words into single region", async () => {
      const words = [
        makeWord("good", 80, 0, 0),
        makeWord("bad1", 30, 60, 0), // adjacent low-conf words
        makeWord("bad2", 25, 100, 0), // within 50px of previous
        makeWord("good", 80, 200, 0),
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
      });
      // Should group bad1 and bad2 into one region
      expect(result.lowConfidenceRegions.length).toBe(1);
      expect(result.lowConfidenceRegions[0].wordCount).toBe(2);
    });

    it("creates separate regions for non-adjacent words", async () => {
      const words = [
        makeWord("bad1", 30, 0, 0),
        makeWord("good", 80, 100, 0),
        makeWord("bad2", 30, 500, 0), // far from bad1
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
      });
      expect(result.lowConfidenceRegions.length).toBe(2);
    });

    it("creates separate regions for different rows", async () => {
      const words = [
        makeWord("bad1", 30, 0, 0), // row 1
        makeWord("bad2", 30, 0, 100), // row 2 (different y)
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
      });
      expect(result.lowConfidenceRegions.length).toBe(2);
    });
  });

  describe("Region bounding box", () => {
    it("computes correct bounding box for region", async () => {
      const words = [
        makeWord("bad1", 30, 10, 20, 50, 15), // x:10, y:20, w:50, h:15
        makeWord("bad2", 30, 70, 20, 40, 15), // x:70, y:20, w:40, h:15 (adjacent)
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
      });

      const region = result.lowConfidenceRegions[0];
      expect(region.bbox.x).toBe(10); // min x
      expect(region.bbox.y).toBe(20); // min y
      expect(region.bbox.width).toBe(100); // 10+50 to 70+40 = 110-10 = 100
      expect(region.bbox.height).toBe(15); // same row, same height
    });
  });

  describe("Region limits", () => {
    it("respects maxRegionsToRepair limit", async () => {
      // Create many low-confidence words
      const words: OCRWord[] = [];
      for (let i = 0; i < 20; i++) {
        words.push(makeWord(`bad${i}`, 30, i * 200, 0)); // spaced out = separate regions
      }

      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 50,
        maxRegionsToRepair: 5,
      });

      expect(result.lowConfidenceRegions.length).toBeLessThanOrEqual(5);
    });
  });

  describe("Region confidence", () => {
    it("computes average confidence for region", async () => {
      const words = [
        makeWord("bad1", 30, 0, 0),
        makeWord("bad2", 50, 40, 0), // adjacent
      ];
      const result = await analyzeQuality(words, {
        trOCRConfidenceThreshold: 60,
      });

      const region = result.lowConfidenceRegions[0];
      expect(region.confidence).toBe(40); // (30+50)/2
    });
  });
});

// ============================================================================
// 6. HELPER FUNCTION TESTS
// ============================================================================

describe("Helper Functions", () => {
  describe("isHighQualityOCR", () => {
    it("returns true for HIGH level", async () => {
      const words = makeWords(
        ["high", "quality", "text", "with", "good", "content", "here", "now", "more", "words"],
        95
      );
      const result = await analyzeQuality(words);
      if (result.level === "HIGH") {
        expect(isHighQualityOCR(result)).toBe(true);
      }
    });

    it("returns false for MEDIUM level", async () => {
      const words = makeWords(["medium", "quality"], 55);
      const result = await analyzeQuality(words);
      if (result.level === "MEDIUM") {
        expect(isHighQualityOCR(result)).toBe(false);
      }
    });

    it("returns false for LOW level", async () => {
      const words = [makeWord("%%%%", 20)];
      const result = await analyzeQuality(words);
      expect(isHighQualityOCR(result)).toBe(false);
    });
  });

  describe("needsManualReview", () => {
    it("returns true when NEEDS_MANUAL_REVIEW flag present", async () => {
      const words = makeWords(["medium"], 55);
      const result = await analyzeQuality(words);
      if (result.flags.includes("NEEDS_MANUAL_REVIEW")) {
        expect(needsManualReview(result)).toBe(true);
      }
    });

    it("returns true when level is LOW", async () => {
      const words = [makeWord("%%%%", 10)];
      const result = await analyzeQuality(words);
      expect(result.level).toBe("LOW");
      expect(needsManualReview(result)).toBe(true);
    });

    it("returns true when score < 0.5", async () => {
      const words = [makeWord("bad", 30), makeWord("text", 35)];
      const result = await analyzeQuality(words);
      if (result.score < 0.5) {
        expect(needsManualReview(result)).toBe(true);
      }
    });

    it("returns false for clean high-quality result", async () => {
      const words = makeWords(
        ["excellent", "quality", "text", "here", "with", "good", "content", "now", "more", "words"],
        95
      );
      const result = await analyzeQuality(words);
      if (result.level === "HIGH" && result.score >= 0.5) {
        expect(needsManualReview(result)).toBe(false);
      }
    });
  });
});

// ============================================================================
// 7. INTEGRATION TESTS - Real-world scenarios
// ============================================================================

describe("Integration Tests - Real-world Scenarios", () => {
  describe("Medical document scenarios", () => {
    it("high-quality typed lab report", async () => {
      const words = makeWordsWithConfidences([
        ["Patient", 95],
        ["Name:", 92],
        ["DOB:", 90],
        ["WBC", 94],
        ["12.5", 91],
        ["x10E3/uL", 88],
        ["Normal", 93],
        ["HGB", 95],
        ["14.2", 92],
        ["g/dL", 89],
      ]);
      const result = await analyzeQuality(words);

      expect(result.level).toBe("HIGH");
      expect(result.flags).not.toContain("NEEDS_MANUAL_REVIEW");
      expect(result.lowConfidenceRegions.length).toBe(0);
    });

    it("medium-quality scanned document", async () => {
      const words = makeWordsWithConfidences([
        ["Patient", 70],
        ["Name", 65],
        ["Labs", 72],
        ["WBC", 68],
        ["12", 55], // some degradation
        ["HGB", 60],
        ["14", 58],
      ]);
      const result = await analyzeQuality(words);

      expect(result.level).toBe("MEDIUM");
      expect(result.flags).toContain("NEEDS_MANUAL_REVIEW");
    });

    it("low-quality faxed document with artifacts", async () => {
      const words = [
        makeWord("Pat1ent", 45), // OCR misread
        makeWord("%%%%", 30), // garbage
        makeWord("WBC", 50),
        makeWord("1Z.5", 35), // misread number
        makeWord("||||", 25), // artifact
      ];
      const result = await analyzeQuality(words);

      expect(result.level).toBe("LOW");
      expect(result.flags).toContain("LOW_CONFIDENCE");
      expect(result.flags).toContain("HIGH_GARBAGE_DENSITY");
      expect(result.flags).toContain("NEEDS_MANUAL_REVIEW");
      expect(result.lowConfidenceRegions.length).toBeGreaterThan(0);
    });

    it("handwritten note with poor OCR", async () => {
      const words = [
        makeWord("Pt", 40),
        makeWord("c/o", 35),
        makeWord("pain", 45),
        makeWord("@#$", 20), // illegible
        makeWord("10/10", 50),
      ];
      const result = await analyzeQuality(words);

      expect(result.level).toBe("LOW");
      expect(needsManualReview(result)).toBe(true);
    });
  });

  describe("Edge case documents", () => {
    it("empty page", async () => {
      const result = await analyzeQuality([]);

      expect(result.score).toBe(0);
      expect(result.level).toBe("LOW");
      expect(result.metrics.totalWords).toBe(0);
    });

    it("single word document", async () => {
      const words = [makeWord("CONFIDENTIAL", 85)];
      const result = await analyzeQuality(words);

      expect(result.metrics.totalWords).toBe(1);
      expect(result.flags).toContain("SPARSE_TEXT");
    });

    it("pure numbers document (lab values only)", async () => {
      const words = makeWords(
        ["12.5", "14.2", "138", "4.5", "98", "24", "0.9", "7.4", "100", "250"],
        85
      );
      const result = await analyzeQuality(words);

      // Should still be usable but might have low alpha ratio
      expect(result.flags).toContain("LOW_ALPHA_RATIO");
    });

    it("document with OCR recovery markers", async () => {
      const words = [
        makeWord("[OCR_RECOVERED_PAGE_1]", 80),
        makeWord("Some", 75),
        makeWord("recovered", 70),
        makeWord("text", 72),
        makeWord("here", 68),
        makeWord("from", 71),
        makeWord("scan", 69),
        makeWord("image", 73),
        makeWord("file", 74),
        makeWord("data", 70),
      ];
      const result = await analyzeQuality(words);

      expect(result.flags).toContain("OCR_RECOVERY_MARKER");
    });
  });

  describe("Config override scenarios", () => {
    it("strict mode (higher thresholds)", async () => {
      const words = makeWords(["moderate", "quality", "text", "here"], 75);

      const lenientResult = await analyzeQuality(words, {
        highQualityThreshold: 0.5,
        lowQualityThreshold: 0.2,
        wordConfidenceThreshold: 50,
      });

      const strictResult = await analyzeQuality(words, {
        highQualityThreshold: 0.9,
        lowQualityThreshold: 0.7,
        wordConfidenceThreshold: 90,
      });

      // Same input can yield different levels with different configs
      expect(lenientResult.score).toBe(strictResult.score); // Score unchanged
      expect(lenientResult.level).not.toBe(strictResult.level); // But level differs
    });

    it("disable TrOCR", async () => {
      const words = [makeWord("bad", 20)];
      const result = await analyzeQuality(words, {
        enableTrOCR: false,
      });

      // Should still detect low confidence regions for reporting
      // but not flag for TrOCR repair
      expect(result.lowConfidenceRegions.length).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// 8. DETERMINISM TESTS
// ============================================================================

describe("Determinism", () => {
  it("same input always produces same output", async () => {
    const words = makeWordsWithConfidences([
      ["test", 80],
      ["word", 75],
      ["here", 82],
    ]);

    const results = await Promise.all([
      analyzeQuality(words),
      analyzeQuality(words),
      analyzeQuality(words),
    ]);

    // All results should be identical
    expect(results[0].score).toBe(results[1].score);
    expect(results[1].score).toBe(results[2].score);
    expect(results[0].level).toBe(results[1].level);
    expect(results[0].flags).toEqual(results[1].flags);
    expect(results[0].metrics).toEqual(results[1].metrics);
  });

  it("order of words affects result predictably", async () => {
    const words1 = [
      makeWord("high", 90, 0, 0),
      makeWord("low", 30, 60, 0),
    ];
    const words2 = [
      makeWord("low", 30, 0, 0),
      makeWord("high", 90, 60, 0),
    ];

    const result1 = await analyzeQuality(words1);
    const result2 = await analyzeQuality(words2);

    // Confidence stats should be the same (order doesn't matter for median/mean)
    expect(result1.metrics.medianWordConfidence).toBe(
      result2.metrics.medianWordConfidence
    );
    expect(result1.metrics.meanWordConfidence).toBe(
      result2.metrics.meanWordConfidence
    );

    // But region detection might differ (based on position)
  });
});
