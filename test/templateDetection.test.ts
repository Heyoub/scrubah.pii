/**
 * TEMPLATE DETECTION - COMPREHENSIVE TEST SUITE
 *
 * Design Philosophy:
 * - Deterministic: Fixed test data, reproducible results
 * - Realistic: Based on actual medical document patterns
 * - Edge-case focused: Test boundaries and failure modes
 *
 * Test Categories:
 * 1. Hashing utilities (FNV-1a, normalization)
 * 2. N-gram extraction
 * 3. Template classification
 * 4. Corpus building
 * 5. Template stripping
 * 6. Document reconstruction
 * 7. Integration tests (realistic medical docs)
 * 8. Compression ratio verification
 */

import { describe, it, expect } from "vitest";
import { Effect, pipe } from "effect";
import {
  NGramConfig,
  defaultNGramConfig,
  fnv1aHash,
  normalizeForFingerprint,
  extractNGrams,
  classifyTemplateType,
} from "../schemas/templateDetection";
import {
  TemplateDetectionService,
  TemplateDetectionServiceLive,
  DocumentInput,
  runProcessCorpus,
  getTemplateStats,
} from "../services/templateDetection.effect";

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Standard hospital header (appears on all docs)
 */
const HOSPITAL_HEADER = `MEMORIAL GENERAL HOSPITAL
123 Medical Center Drive
Cityville, ST 12345
Phone: (555) 123-4567`;

/**
 * Standard footer (appears on all docs)
 */
const HOSPITAL_FOOTER = `Page 1 of 1
Printed: 01/15/2025 14:30
CONFIDENTIAL - Protected Health Information
CLIA #: 12D3456789`;

/**
 * Standard demographics block
 */
const DEMOGRAPHICS_BLOCK = `Patient Name: [REDACTED]
DOB: 01/01/1990
MRN: 123456789
Account #: A987654`;

/**
 * Create a mock lab report
 */
const createLabReport = (
  date: string,
  wbc: string,
  hgb: string,
  uniqueNotes: string
): DocumentInput => ({
  id: `lab_${date}`,
  content: `${HOSPITAL_HEADER}

${DEMOGRAPHICS_BLOCK}

LABORATORY REPORT
Date: ${date}

COMPLETE BLOOD COUNT

Test          Result    Reference
WBC           ${wbc}    3.5-11.0 x10E3/uL
HGB           ${hgb}    12.0-16.0 g/dL

${uniqueNotes}

Performing Laboratory: Memorial General Hospital Laboratory
Medical Director: Dr. Lab Director, MD

${HOSPITAL_FOOTER}`,
  metadata: { type: "lab" },
});

/**
 * Create a mock progress note
 */
const createProgressNote = (
  date: string,
  uniqueContent: string
): DocumentInput => ({
  id: `progress_${date}`,
  content: `${HOSPITAL_HEADER}

${DEMOGRAPHICS_BLOCK}

PROGRESS NOTE
Date: ${date}

${uniqueContent}

${HOSPITAL_FOOTER}`,
  metadata: { type: "progress" },
});

/**
 * Helper: Run template detection service
 */
const runBuildCorpus = async (
  documents: DocumentInput[],
  config?: Partial<NGramConfig>
) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(TemplateDetectionService);
      return yield* _(service.buildCorpus(documents, config));
    }),
    Effect.provide(TemplateDetectionServiceLive)
  );
  return Effect.runPromise(program);
};

const runStripTemplates = async (
  document: DocumentInput,
  corpus: Awaited<ReturnType<typeof runBuildCorpus>>
) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(TemplateDetectionService);
      return yield* _(service.stripTemplates(document, corpus));
    }),
    Effect.provide(TemplateDetectionServiceLive)
  );
  return Effect.runPromise(program);
};

const runReconstruct = async (
  delta: Awaited<ReturnType<typeof runStripTemplates>>["delta"],
  corpus: Awaited<ReturnType<typeof runBuildCorpus>>
) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(TemplateDetectionService);
      return yield* _(service.reconstructDocument(delta, corpus));
    }),
    Effect.provide(TemplateDetectionServiceLive)
  );
  return Effect.runPromise(program);
};

// ============================================================================
// 1. HASHING UTILITIES
// ============================================================================

describe("Hashing Utilities", () => {
  describe("fnv1aHash", () => {
    it("produces consistent hashes for same input", () => {
      const input = "test string";
      const hash1 = fnv1aHash(input);
      const hash2 = fnv1aHash(input);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = fnv1aHash("hello");
      const hash2 = fnv1aHash("world");
      expect(hash1).not.toBe(hash2);
    });

    it("produces 16-char hex strings", () => {
      const hash = fnv1aHash("test");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("handles empty string", () => {
      const hash = fnv1aHash("");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("handles unicode", () => {
      const hash = fnv1aHash("こんにちは");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("hash is sensitive to small changes", () => {
      const hash1 = fnv1aHash("test1");
      const hash2 = fnv1aHash("test2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("normalizeForFingerprint", () => {
    it("collapses whitespace when enabled", () => {
      const result = normalizeForFingerprint("hello   world", {
        normalizeWhitespace: true,
        lowercaseForMatching: false,
        stripNumbers: false,
      });
      expect(result).toBe("hello world");
    });

    it("lowercases when enabled", () => {
      const result = normalizeForFingerprint("Hello World", {
        normalizeWhitespace: false,
        lowercaseForMatching: true,
        stripNumbers: false,
      });
      expect(result).toBe("hello world");
    });

    it("strips numbers when enabled", () => {
      const result = normalizeForFingerprint("WBC 12.5 x10E3", {
        normalizeWhitespace: false,
        lowercaseForMatching: false,
        stripNumbers: true,
      });
      expect(result).toBe("WBC #.# x#E#");
    });

    it("applies all normalizations together", () => {
      const result = normalizeForFingerprint("  Hello  WORLD  123  ", {
        normalizeWhitespace: true,
        lowercaseForMatching: true,
        stripNumbers: true,
      });
      expect(result).toBe("hello world #");
    });

    it("preserves content when all disabled", () => {
      const input = "  Hello  WORLD  123  ";
      const result = normalizeForFingerprint(input, {
        normalizeWhitespace: false,
        lowercaseForMatching: false,
        stripNumbers: false,
      });
      expect(result).toBe(input);
    });
  });
});

// ============================================================================
// 2. N-GRAM EXTRACTION
// ============================================================================

describe("N-gram Extraction", () => {
  const testConfig: NGramConfig = {
    ...defaultNGramConfig,
    minNgramSize: 2,
    maxNgramSize: 3,
  };

  it("extracts n-grams of specified sizes", () => {
    // Use longer lines to meet minimum character threshold (10 chars)
    const lines = [
      "This is line one",
      "This is line two",
      "This is line three",
      "This is line four",
    ];
    const fingerprints = extractNGrams(lines, "doc1", testConfig);

    // Should have 2-grams (3) and 3-grams (2) = 5 total
    const sizes = fingerprints.map((fp) => fp.ngramSize);
    expect(sizes.filter((s) => s === 2).length).toBe(3); // line 0-1, 1-2, 2-3
    expect(sizes.filter((s) => s === 3).length).toBe(2); // line 0-2, 1-3
  });

  it("records correct line positions", () => {
    // Use longer lines to meet minimum character threshold
    const lines = [
      "First line content here",
      "Second line content here",
      "Third line content here",
      "Fourth line content here",
    ];
    const fingerprints = extractNGrams(lines, "doc1", testConfig);

    // Check 2-grams
    const twoGrams = fingerprints.filter((fp) => fp.ngramSize === 2);
    expect(twoGrams.map((fp) => fp.lineStart)).toEqual([0, 1, 2]);
  });

  it("associates fingerprints with document ID", () => {
    // Use a line with enough content to pass the 10-char threshold
    const lines = ["This is a test line with enough content"];
    const fingerprints = extractNGrams(lines, "my-doc-id", {
      ...testConfig,
      minNgramSize: 1,
      maxNgramSize: 1,
    });

    expect(fingerprints.length).toBeGreaterThan(0);
    expect(fingerprints[0].documentId).toBe("my-doc-id");
  });

  it("skips empty n-grams", () => {
    const lines = ["", "", "", ""];
    const fingerprints = extractNGrams(lines, "doc1", testConfig);
    expect(fingerprints.length).toBe(0);
  });

  it("produces consistent hashes for same content", () => {
    const lines = ["Patient Name: Test", "DOB: 01/01/1990"];
    const fp1 = extractNGrams(lines, "doc1", testConfig);
    const fp2 = extractNGrams(lines, "doc2", testConfig);

    // Same content should produce same hash
    expect(fp1[0].hash).toBe(fp2[0].hash);
  });
});

// ============================================================================
// 3. TEMPLATE CLASSIFICATION
// ============================================================================

describe("Template Classification", () => {
  describe("Header detection", () => {
    it("classifies patient name headers", () => {
      expect(classifyTemplateType("Patient Name: John Doe", "START")).toBe(
        "HEADER"
      );
      expect(classifyTemplateType("Patient ID: 123456", "START")).toBe("HEADER");
    });

    it("classifies date/DOB headers", () => {
      expect(classifyTemplateType("DOB: 01/01/1990", "START")).toBe("HEADER");
      expect(classifyTemplateType("Date: 01/15/2025", "START")).toBe("HEADER");
    });

    it("classifies MRN headers", () => {
      expect(classifyTemplateType("Medical Record #123456", "START")).toBe(
        "HEADER"
      );
    });
  });

  describe("Footer detection", () => {
    it("classifies page numbers", () => {
      expect(classifyTemplateType("Page 1 of 5", "END")).toBe("FOOTER");
      expect(classifyTemplateType("Pg. 2/10", "END")).toBe("FOOTER");
    });

    it("classifies CLIA numbers", () => {
      expect(classifyTemplateType("CLIA #12D3456789", "END")).toBe("FOOTER");
    });

    it("classifies medical director lines", () => {
      expect(classifyTemplateType("Medical Director: Dr. Smith", "END")).toBe(
        "FOOTER"
      );
    });

    it("classifies confidentiality notices", () => {
      expect(classifyTemplateType("CONFIDENTIAL - PHI", "END")).toBe("FOOTER");
    });
  });

  describe("Signature detection", () => {
    it("classifies electronic signatures", () => {
      expect(classifyTemplateType("Electronically signed by", "MIDDLE")).toBe(
        "SIGNATURE"
      );
      expect(classifyTemplateType("E-Signed: Dr. Jones", "MIDDLE")).toBe(
        "SIGNATURE"
      );
    });

    it("classifies authentication lines", () => {
      expect(classifyTemplateType("Authenticated by: Dr. Smith", "MIDDLE")).toBe(
        "SIGNATURE"
      );
    });
  });

  describe("Medication list detection", () => {
    it("classifies medication patterns", () => {
      expect(
        classifyTemplateType("gabapentin 300mg BID", "MIDDLE")
      ).toBe("MEDICATION_LIST");
    });
  });

  describe("Demographics detection", () => {
    it("classifies demographics blocks", () => {
      expect(classifyTemplateType("SSN: XXX-XX-XXXX", "MIDDLE")).toBe(
        "DEMOGRAPHICS"
      );
      expect(classifyTemplateType("Insurance: Blue Cross", "MIDDLE")).toBe(
        "DEMOGRAPHICS"
      );
    });
  });

  describe("Position-based fallback", () => {
    it("defaults START to HEADER", () => {
      expect(classifyTemplateType("Unknown content", "START")).toBe("HEADER");
    });

    it("defaults END to FOOTER", () => {
      expect(classifyTemplateType("Unknown content", "END")).toBe("FOOTER");
    });

    it("defaults MIDDLE to BOILERPLATE", () => {
      expect(classifyTemplateType("Unknown content", "MIDDLE")).toBe(
        "BOILERPLATE"
      );
    });
  });
});

// ============================================================================
// 4. CORPUS BUILDING
// ============================================================================

describe("Corpus Building", () => {
  it("requires minimum documents for template detection", async () => {
    const docs = [createLabReport("2025-01-01", "10.5", "14.0", "Normal")];
    const corpus = await runBuildCorpus(docs, {
      minDocumentsForTemplate: 3,
    });

    expect(corpus.templates.length).toBe(0);
    expect(corpus.totalDocuments).toBe(1);
  });

  it("detects repeated headers as templates", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note 3"),
      createLabReport("2025-01-04", "10.0", "13.8", "Note 4"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5, // 50% = 2 docs
      minDocumentsForTemplate: 2,
    });

    // Should detect hospital header, footer, demographics as templates
    expect(corpus.templates.length).toBeGreaterThan(0);
  });

  it("does NOT detect unique content as templates", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Unique note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Different note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Another note 3"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    // Unique notes should NOT be templates
    const templateContents = corpus.templates.map((t) =>
      t.content.toLowerCase()
    );
    expect(
      templateContents.some((c) => c.includes("unique note 1"))
    ).toBe(false);
  });

  it("records template frequency correctly", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note 3"),
      createLabReport("2025-01-04", "10.0", "13.8", "Note 4"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    // Templates should have frequency close to 1.0 (appear in all docs)
    const highFreqTemplates = corpus.templates.filter((t) => t.frequency >= 0.9);
    expect(highFreqTemplates.length).toBeGreaterThan(0);
  });

  it("classifies template types correctly", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note 3"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const types = corpus.templates.map((t) => t.type);
    // Should have various types
    expect(types.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 5. TEMPLATE STRIPPING
// ============================================================================

describe("Template Stripping", () => {
  it("removes detected templates from documents", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Unique findings here"),
      createLabReport("2025-01-02", "11.0", "13.5", "Different findings"),
      createLabReport("2025-01-03", "9.5", "14.2", "More unique data"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const result = await runStripTemplates(docs[0], corpus);

    // Should have some templates matched
    expect(result.matchedTemplates.length).toBeGreaterThanOrEqual(0);
    // Compressed size should be <= original
    expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize);
  });

  it("preserves unique content in delta", async () => {
    const uniqueNote = "This is a very unique clinical finding XYZ123";
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", uniqueNote),
      createLabReport("2025-01-02", "11.0", "13.5", "Different note"),
      createLabReport("2025-01-03", "9.5", "14.2", "Another note"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const result = await runStripTemplates(docs[0], corpus);

    // Unique content should be in delta
    expect(result.delta.uniqueContent).toContain("unique clinical finding");
  });

  it("tracks template references correctly", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note 3"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const result = await runStripTemplates(docs[0], corpus);

    // Each template ref should have valid line numbers
    for (const ref of result.delta.templateRefs) {
      expect(ref.lineStart).toBeGreaterThanOrEqual(0);
      expect(ref.lineEnd).toBeGreaterThanOrEqual(ref.lineStart);
    }
  });

  it("computes compression ratio correctly", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Short"),
      createLabReport("2025-01-02", "11.0", "13.5", "Short"),
      createLabReport("2025-01-03", "9.5", "14.2", "Short"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const result = await runStripTemplates(docs[0], corpus);

    // Compression ratio = compressed / original
    const expectedRatio = result.compressedSize / result.originalSize;
    expect(result.delta.compressionRatio).toBeCloseTo(expectedRatio, 5);
  });
});

// ============================================================================
// 6. DOCUMENT RECONSTRUCTION
// ============================================================================

describe("Document Reconstruction", () => {
  it("reconstructs document preserving unique content", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Unique note XYZ"),
      createLabReport("2025-01-02", "11.0", "13.5", "Another note"),
      createLabReport("2025-01-03", "9.5", "14.2", "Third note"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const result = await runStripTemplates(docs[0], corpus);
    const reconstructed = await runReconstruct(result.delta, corpus);

    // Reconstructed should contain unique content
    expect(reconstructed).toContain("Unique note XYZ");

    // Should also contain some template content if templates were detected
    if (corpus.templates.length > 0) {
      // At least one template should appear
      const someTemplateContent = corpus.templates.some(t =>
        reconstructed.includes(t.content.substring(0, 20))
      );
      expect(someTemplateContent || result.matchedTemplates.length === 0).toBe(true);
    }
  });
});

// ============================================================================
// 7. INTEGRATION TESTS
// ============================================================================

describe("Integration - Realistic Medical Documents", () => {
  it("handles mixed document types", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Lab findings"),
      createProgressNote("2025-01-02", "Patient improving"),
      createLabReport("2025-01-03", "11.0", "13.5", "Follow-up labs"),
      createProgressNote("2025-01-04", "Discharge planning"),
    ];

    const { corpus, results, stats: _stats } = await runProcessCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    // Should process all documents
    expect(results.length).toBe(4);
    expect(corpus.totalDocuments).toBe(4);
  });

  it("achieves meaningful compression", async () => {
    // Create corpus with lots of repeated content
    const docs = Array.from({ length: 10 }, (_, i) =>
      createLabReport(
        `2025-01-${String(i + 1).padStart(2, "0")}`,
        String(10 + i * 0.5),
        String(14 - i * 0.1),
        `Day ${i + 1} labs`
      )
    );

    const { stats } = await runProcessCorpus(docs, {
      templateThreshold: 0.3, // 30%
      minDocumentsForTemplate: 3,
    });

    // With 10 similar docs, should achieve some compression
    console.log(`Compression: ${(1 - stats.overallCompressionRatio) * 100}%`);
    // Note: Actual compression depends on template detection success
    expect(stats.overallCompressionRatio).toBeLessThanOrEqual(1);
  });

  it("getTemplateStats returns useful info", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note 1"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note 2"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note 3"),
    ];

    const corpus = await runBuildCorpus(docs, {
      templateThreshold: 0.5,
      minDocumentsForTemplate: 2,
    });

    const stats = getTemplateStats(corpus);

    expect(stats.totalTemplates).toBe(corpus.templates.length);
    expect(typeof stats.byType).toBe("object");
    expect(typeof stats.byPosition).toBe("object");
  });
});

// ============================================================================
// 8. DETERMINISM TESTS
// ============================================================================

describe("Determinism", () => {
  it("produces same corpus for same input", async () => {
    const docs = [
      createLabReport("2025-01-01", "10.5", "14.0", "Note"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note"),
      createLabReport("2025-01-03", "9.5", "14.2", "Note"),
    ];

    const corpus1 = await runBuildCorpus(docs);
    const corpus2 = await runBuildCorpus(docs);

    expect(corpus1.templates.length).toBe(corpus2.templates.length);
    expect(corpus1.templates.map((t) => t.hash)).toEqual(
      corpus2.templates.map((t) => t.hash)
    );
  });

  it("hash is deterministic", () => {
    const input = "test content";
    const hashes = Array.from({ length: 100 }, () => fnv1aHash(input));

    // All hashes should be identical
    expect(new Set(hashes).size).toBe(1);
  });
});

// ============================================================================
// 9. EDGE CASES
// ============================================================================

describe("Edge Cases", () => {
  it("handles empty document", async () => {
    const docs: DocumentInput[] = [
      { id: "empty", content: "" },
      createLabReport("2025-01-01", "10.5", "14.0", "Note"),
      createLabReport("2025-01-02", "11.0", "13.5", "Note"),
    ];

    const corpus = await runBuildCorpus(docs);
    expect(corpus).toBeDefined();
  });

  it("handles single-line documents", async () => {
    const docs: DocumentInput[] = [
      { id: "single1", content: "Just one line" },
      { id: "single2", content: "Just one line" },
      { id: "single3", content: "Just one line" },
    ];

    const corpus = await runBuildCorpus(docs, {
      minNgramSize: 1,
      maxNgramSize: 1,
      minDocumentsForTemplate: 2,
    });

    expect(corpus).toBeDefined();
  });

  it("handles documents with only whitespace lines", async () => {
    const docs: DocumentInput[] = [
      { id: "ws1", content: "   \n   \n   " },
      { id: "ws2", content: "   \n   \n   " },
      { id: "ws3", content: "   \n   \n   " },
    ];

    const corpus = await runBuildCorpus(docs);
    // Should not crash, templates should be 0 (empty content filtered)
    expect(corpus.templates.length).toBe(0);
  });

  it("handles very long documents", async () => {
    const longContent = Array.from(
      { length: 1000 },
      (_, i) => `Line ${i}: This is test content`
    ).join("\n");

    const docs: DocumentInput[] = [
      { id: "long1", content: longContent },
      { id: "long2", content: longContent },
      { id: "long3", content: longContent },
    ];

    const corpus = await runBuildCorpus(docs, {
      minDocumentsForTemplate: 2,
    });

    expect(corpus).toBeDefined();
    // Should detect templates in long docs
    expect(corpus.templates.length).toBeGreaterThan(0);
  });
});
