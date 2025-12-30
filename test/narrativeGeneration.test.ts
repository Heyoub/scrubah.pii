/**
 * NARRATIVE GENERATION TESTS
 *
 * Tests for the narrative generation service that creates
 * clinical summaries from extracted structured data.
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import {
  formatDiagnosesSummary,
  formatMedicationsSummary,
  formatLabsSummary,
  formatVitalsSummary,
  formatImagingSummary,
  formatTrendsSummary,
  getSectionTitle,
  truncateText,
  calculateCompressionRatio,
  type NarrativeConfig,
} from "../schemas/narrativeGeneration";
import {
  NarrativeGenerationService,
  NarrativeGenerationServiceLive,
} from "../services/narrativeGeneration.effect";
import type { ExtractionResult } from "../schemas/structuredExtraction";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const runGenerate = async (
  input: {
    documentId: string;
    originalText: string;
    extraction: ExtractionResult;
  },
  config?: Partial<NarrativeConfig>
) => {
  const program = Effect.gen(function* () {
    const service = yield* NarrativeGenerationService;
    return yield* service.generate(input, config);
  });

  return Effect.runPromise(
    Effect.provide(program, NarrativeGenerationServiceLive)
  );
};

const createEmptyExtraction = (): ExtractionResult => ({
  documentId: "test-doc",
  labPanels: [],
  medications: [],
  diagnoses: [],
  vitalSets: [],
  imagingFindings: [],
  procedures: [],
  extractionCount: 0,
  lowConfidenceCount: 0,
  processingTimeMs: 0,
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe("truncateText", () => {
  it("returns text unchanged if under limit", () => {
    expect(truncateText("short", 100)).toBe("short");
  });

  it("truncates with ellipsis if over limit", () => {
    const result = truncateText("this is a long text", 10);
    expect(result).toBe("this is...");
    expect(result.length).toBe(10);
  });

  it("handles exact length", () => {
    expect(truncateText("exact", 5)).toBe("exact");
  });
});

describe("calculateCompressionRatio", () => {
  it("calculates correct ratio", () => {
    expect(calculateCompressionRatio(100, 50)).toBe(0.5);
    expect(calculateCompressionRatio(100, 25)).toBe(0.75);
    expect(calculateCompressionRatio(100, 100)).toBe(0);
  });

  it("handles zero input", () => {
    expect(calculateCompressionRatio(0, 50)).toBe(0);
  });
});

describe("getSectionTitle", () => {
  it("returns abbreviated titles for minimal verbosity", () => {
    expect(getSectionTitle("DIAGNOSES", "MINIMAL")).toBe("Dx");
    expect(getSectionTitle("MEDICATIONS", "MINIMAL")).toBe("Meds");
    expect(getSectionTitle("LABS", "MINIMAL")).toBe("Labs");
    expect(getSectionTitle("VITALS", "MINIMAL")).toBe("VS");
  });

  it("returns full titles for detailed verbosity", () => {
    expect(getSectionTitle("DIAGNOSES", "DETAILED")).toBe("Diagnosis List");
    expect(getSectionTitle("LABS", "DETAILED")).toBe("Laboratory Results");
  });

  it("returns standard titles for standard verbosity", () => {
    expect(getSectionTitle("MEDICATIONS", "STANDARD")).toBe("Medications");
    expect(getSectionTitle("VITALS", "STANDARD")).toBe("Vital Signs");
  });
});

// ============================================================================
// DIAGNOSES FORMATTING TESTS
// ============================================================================

describe("formatDiagnosesSummary", () => {
  const baseDiagnoses = [
    { description: "Acute appendicitis", type: "PRIMARY", icdCode: "K35.80" },
    { description: "Fever", type: "SECONDARY" },
    { description: "Abdominal pain", type: "SECONDARY" },
  ];

  it("formats with primary diagnosis highlighted", () => {
    const result = formatDiagnosesSummary(baseDiagnoses, {
      verbosity: "STANDARD",
      useBulletPoints: true,
    });
    expect(result).toContain("Primary: Acute appendicitis (K35.80)");
    expect(result).toContain("• Fever");
  });

  it("formats minimal verbosity", () => {
    const result = formatDiagnosesSummary(baseDiagnoses, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
    });
    expect(result).toContain("Acute appendicitis");
    expect(result.length).toBeLessThanOrEqual(103); // 100 + "..."
  });

  it("formats brief verbosity with count", () => {
    const result = formatDiagnosesSummary(baseDiagnoses, {
      verbosity: "BRIEF",
      useBulletPoints: true,
    });
    expect(result).toContain("2 additional diagnoses");
  });

  it("handles empty diagnoses", () => {
    const result = formatDiagnosesSummary([], { verbosity: "STANDARD", useBulletPoints: true });
    expect(result).toBe("");
  });
});

// ============================================================================
// MEDICATIONS FORMATTING TESTS
// ============================================================================

describe("formatMedicationsSummary", () => {
  const baseMedications = [
    { name: "Lisinopril", dose: "10 mg", route: "PO", frequency: "DAILY", status: "ACTIVE" },
    { name: "Metformin", dose: "500 mg", route: "PO", frequency: "BID", status: "ACTIVE" },
    { name: "Aspirin", dose: "81 mg", route: "PO", frequency: "DAILY", status: "DISCONTINUED" },
  ];

  it("formats medication list with details", () => {
    const result = formatMedicationsSummary(baseMedications, {
      verbosity: "STANDARD",
      useBulletPoints: true,
      useAbbreviations: true,
    });
    expect(result).toContain("• Lisinopril 10 mg PO DAILY");
    expect(result).toContain("• Metformin 500 mg PO BID");
    // Discontinued should be excluded
    expect(result).not.toContain("Aspirin");
  });

  it("formats minimal verbosity as count", () => {
    const result = formatMedicationsSummary(baseMedications, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
      useAbbreviations: true,
    });
    expect(result).toBe("2 active medications");
  });

  it("handles empty medications", () => {
    const result = formatMedicationsSummary([], {
      verbosity: "STANDARD",
      useBulletPoints: true,
      useAbbreviations: true,
    });
    expect(result).toBe("");
  });
});

// ============================================================================
// LABS FORMATTING TESTS
// ============================================================================

describe("formatLabsSummary", () => {
  const baseLabs = [
    { testName: "WBC", value: 12.5, unit: "x10E3/uL", status: "HIGH" },
    { testName: "HGB", value: 14.0, unit: "g/dL", status: "NORMAL" },
    { testName: "PLT", value: 250, unit: "x10E3/uL", status: "NORMAL" },
    { testName: "Potassium", value: 2.8, unit: "mEq/L", status: "CRITICAL_LOW" },
  ];

  it("highlights abnormal labs", () => {
    const result = formatLabsSummary(baseLabs, {
      verbosity: "STANDARD",
      useBulletPoints: true,
      includeUnits: true,
      highlightAbnormal: true,
    });
    expect(result).toContain("WBC: 12.5 x10E3/uL (H)");
    expect(result).toContain("Potassium: 2.8 mEq/L ⚠️");
  });

  it("shows minimal verbosity", () => {
    const result = formatLabsSummary(baseLabs, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
      includeUnits: false,
      highlightAbnormal: false,
    });
    expect(result).toBe("2 abnormal lab(s)");
  });

  it("shows WNL for all normal labs", () => {
    const normalLabs = [
      { testName: "HGB", value: 14.0, unit: "g/dL", status: "NORMAL" },
      { testName: "PLT", value: 250, unit: "x10E3/uL", status: "NORMAL" },
    ];
    const result = formatLabsSummary(normalLabs, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
      includeUnits: false,
      highlightAbnormal: false,
    });
    expect(result).toBe("Labs WNL");
  });

  it("handles empty labs", () => {
    const result = formatLabsSummary([], {
      verbosity: "STANDARD",
      useBulletPoints: true,
      includeUnits: true,
      highlightAbnormal: true,
    });
    expect(result).toBe("");
  });
});

// ============================================================================
// VITALS FORMATTING TESTS
// ============================================================================

describe("formatVitalsSummary", () => {
  const baseVitals = [
    { type: "BP_SYSTOLIC", value: 120, unit: "mmHg" },
    { type: "BP_DIASTOLIC", value: 80, unit: "mmHg" },
    { type: "HEART_RATE", value: 72, unit: "bpm" },
    { type: "TEMPERATURE", value: 98.6, unit: "°F" },
    { type: "SPO2", value: 98, unit: "%" },
  ];

  it("formats vitals with abbreviations", () => {
    const result = formatVitalsSummary(baseVitals, {
      verbosity: "STANDARD",
      useAbbreviations: true,
      includeUnits: true,
    });
    expect(result).toContain("BP 120/80");
    expect(result).toContain("HR 72");
    expect(result).toContain("T 98.6°F");
    expect(result).toContain("SpO2 98%");
  });

  it("formats vitals without abbreviations", () => {
    const result = formatVitalsSummary(baseVitals, {
      verbosity: "STANDARD",
      useAbbreviations: false,
      includeUnits: true,
    });
    expect(result).toContain("Blood Pressure 120/80 mmHg");
    expect(result).toContain("Heart Rate 72 bpm");
  });

  it("handles empty vitals", () => {
    const result = formatVitalsSummary([], {
      verbosity: "STANDARD",
      useAbbreviations: true,
      includeUnits: true,
    });
    expect(result).toBe("");
  });
});

// ============================================================================
// IMAGING FORMATTING TESTS
// ============================================================================

describe("formatImagingSummary", () => {
  const baseFindings = [
    {
      modality: "CT",
      bodyPart: "Abdomen",
      finding: "Appendicitis with periappendiceal inflammation",
      isAbnormal: true,
      impression: "Acute appendicitis",
    },
    {
      modality: "XRAY",
      bodyPart: "Chest",
      finding: "Clear lung fields, no infiltrate",
      isAbnormal: false,
    },
  ];

  it("formats imaging with findings", () => {
    const result = formatImagingSummary(baseFindings, {
      verbosity: "STANDARD",
      useBulletPoints: true,
      highlightAbnormal: true,
    });
    expect(result).toContain("CT Abdomen: Acute appendicitis ⚠️");
    expect(result).toContain("XRAY Chest: Clear lung fields");
  });

  it("formats brief verbosity", () => {
    const result = formatImagingSummary(baseFindings, {
      verbosity: "BRIEF",
      useBulletPoints: true,
      highlightAbnormal: true,
    });
    expect(result).toContain("CT Abdomen: Abnormal ⚠️");
    expect(result).toContain("XRAY Chest: Normal");
  });

  it("formats minimal verbosity", () => {
    const result = formatImagingSummary(baseFindings, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
      highlightAbnormal: false,
    });
    expect(result).toBe("1 abnormal imaging finding(s)");
  });

  it("handles empty findings", () => {
    const result = formatImagingSummary([], {
      verbosity: "STANDARD",
      useBulletPoints: true,
      highlightAbnormal: true,
    });
    expect(result).toBe("");
  });
});

// ============================================================================
// TRENDS FORMATTING TESTS
// ============================================================================

describe("formatTrendsSummary", () => {
  const baseTrends = [
    {
      testName: "WBC",
      trend: "INCREASING",
      values: [
        { date: "2024-01-01", value: 10.0 },
        { date: "2024-01-02", value: 12.0 },
        { date: "2024-01-03", value: 14.0 },
      ],
    },
    {
      testName: "HGB",
      trend: "STABLE",
      values: [
        { date: "2024-01-01", value: 14.0 },
        { date: "2024-01-02", value: 14.1 },
      ],
    },
    {
      testName: "PLT",
      trend: "DECREASING",
      values: [
        { date: "2024-01-01", value: 300 },
        { date: "2024-01-02", value: 250 },
      ],
    },
  ];

  it("formats trends with direction arrows", () => {
    const result = formatTrendsSummary(baseTrends, {
      verbosity: "STANDARD",
      useBulletPoints: true,
    });
    expect(result).toContain("WBC: ↑ increasing");
    expect(result).toContain("PLT: ↓ decreasing");
    // Stable trends are filtered out
    expect(result).not.toContain("HGB");
  });

  it("formats minimal verbosity as count", () => {
    const result = formatTrendsSummary(baseTrends, {
      verbosity: "MINIMAL",
      useBulletPoints: false,
    });
    expect(result).toBe("2 trending lab value(s)");
  });

  it("handles all stable trends", () => {
    const stableTrends = [
      { testName: "HGB", trend: "STABLE", values: [] },
      { testName: "WBC", trend: "STABLE", values: [] },
    ];
    const result = formatTrendsSummary(stableTrends, {
      verbosity: "STANDARD",
      useBulletPoints: true,
    });
    expect(result).toBe("No significant lab trends");
  });

  it("handles empty trends", () => {
    const result = formatTrendsSummary([], {
      verbosity: "STANDARD",
      useBulletPoints: true,
    });
    expect(result).toBe("");
  });
});

// ============================================================================
// SERVICE INTEGRATION TESTS
// ============================================================================

describe("NarrativeGenerationService", () => {
  describe("generate", () => {
    it("generates narrative from extraction", async () => {
      const extraction: ExtractionResult = {
        ...createEmptyExtraction(),
        diagnoses: [
          {
            description: "Acute appendicitis",
            type: "PRIMARY",
            icdCode: "K35.80",
            status: "ACTIVE",
            confidence: 0.9,
          },
        ],
        medications: [
          {
            name: "Cefazolin",
            dose: "1 g",
            route: "IV",
            frequency: "Q8H",
            status: "ACTIVE",
            confidence: 0.8,
          },
        ],
        labPanels: [
          {
            panelName: "CBC",
            results: [
              {
                testName: "WBC",
                value: 15.0,
                unit: "x10E3/uL",
                status: "HIGH",
                confidence: 0.9,
              },
            ],
          },
        ],
      };

      const result = await runGenerate({
        documentId: "test-doc",
        originalText: "A".repeat(1000), // 1000 chars original
        extraction,
      });

      expect(result.documentId).toBe("test-doc");
      expect(result.sections.length).toBeGreaterThan(0);
      expect(result.fullNarrative).toContain("Acute appendicitis");
      expect(result.fullNarrative).toContain("Cefazolin");
      expect(result.fullNarrative).toContain("WBC");
      expect(result.diagnosisCount).toBe(1);
      expect(result.medicationCount).toBe(1);
      expect(result.labCount).toBe(1);
      expect(result.abnormalLabCount).toBe(1);
      expect(result.compressionRatio).toBeGreaterThan(0);
    });

    it("respects verbosity settings", async () => {
      const extraction: ExtractionResult = {
        ...createEmptyExtraction(),
        diagnoses: [
          { description: "Type 2 diabetes", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
          { description: "Hypertension", type: "SECONDARY", status: "ACTIVE", confidence: 0.9 },
          { description: "Hyperlipidemia", type: "SECONDARY", status: "ACTIVE", confidence: 0.9 },
        ],
      };

      const minimalResult = await runGenerate(
        { documentId: "test", originalText: "test", extraction },
        { verbosity: "MINIMAL" }
      );

      const detailedResult = await runGenerate(
        { documentId: "test", originalText: "test", extraction },
        { verbosity: "DETAILED" }
      );

      expect(detailedResult.fullNarrative.length).toBeGreaterThan(
        minimalResult.fullNarrative.length
      );
    });

    it("handles empty extraction", async () => {
      const result = await runGenerate({
        documentId: "empty-doc",
        originalText: "Some original text",
        extraction: createEmptyExtraction(),
      });

      expect(result.sections.length).toBe(0);
      expect(result.fullNarrative).toBe("");
      expect(result.diagnosisCount).toBe(0);
    });

    it("calculates compression ratio correctly", async () => {
      const extraction: ExtractionResult = {
        ...createEmptyExtraction(),
        diagnoses: [
          { description: "Test diagnosis", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
        ],
      };

      const result = await runGenerate({
        documentId: "test",
        originalText: "A".repeat(1000),
        extraction,
      });

      expect(result.inputCharCount).toBe(1000);
      expect(result.outputCharCount).toBeLessThan(1000);
      expect(result.compressionRatio).toBeGreaterThan(0);
      expect(result.compressionRatio).toBeLessThanOrEqual(1);
    });

    it("excludes sections based on config", async () => {
      const extraction: ExtractionResult = {
        ...createEmptyExtraction(),
        diagnoses: [
          { description: "Test", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
        ],
        medications: [
          { name: "Test Med", route: "PO", frequency: "DAILY", status: "ACTIVE", confidence: 0.9 },
        ],
      };

      const result = await runGenerate(
        { documentId: "test", originalText: "test", extraction },
        { includeDiagnoses: true, includeMedications: false }
      );

      expect(result.fullNarrative).toContain("Test");
      expect(result.fullNarrative).not.toContain("Test Med");
    });
  });

  describe("generateSection", () => {
    it("generates individual sections", async () => {
      const program = Effect.gen(function* () {
        const service = yield* NarrativeGenerationService;
        const extraction: ExtractionResult = {
          ...createEmptyExtraction(),
          diagnoses: [
            { description: "Pneumonia", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
          ],
        };
        return yield* service.generateSection("DIAGNOSES", extraction);
      });

      const result = await Effect.runPromise(
        Effect.provide(program, NarrativeGenerationServiceLive)
      );

      expect(result.type).toBe("DIAGNOSES");
      expect(result.content).toContain("Pneumonia");
      expect(result.itemCount).toBe(1);
    });
  });

  describe("generateBatch", () => {
    it("generates multiple narratives", async () => {
      const program = Effect.gen(function* () {
        const service = yield* NarrativeGenerationService;
        return yield* service.generateBatch([
          {
            documentId: "doc1",
            originalText: "text1",
            extraction: {
              ...createEmptyExtraction(),
              diagnoses: [
                { description: "Dx1", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
              ],
            },
          },
          {
            documentId: "doc2",
            originalText: "text2",
            extraction: {
              ...createEmptyExtraction(),
              diagnoses: [
                { description: "Dx2", type: "PRIMARY", status: "ACTIVE", confidence: 0.9 },
              ],
            },
          },
        ]);
      });

      const results = await Effect.runPromise(
        Effect.provide(program, NarrativeGenerationServiceLive)
      );

      expect(results.length).toBe(2);
      expect(results[0].documentId).toBe("doc1");
      expect(results[1].documentId).toBe("doc2");
    });
  });
});

// ============================================================================
// INTEGRATION TEST - REALISTIC SCENARIO
// ============================================================================

describe("Integration - Realistic Medical Summary", () => {
  it("generates comprehensive clinical summary", async () => {
    const extraction: ExtractionResult = {
      documentId: "patient-chart-001",
      labPanels: [
        {
          panelName: "CBC",
          results: [
            { testName: "WBC", value: 15.2, unit: "x10E3/uL", status: "HIGH", confidence: 0.95 },
            { testName: "HGB", value: 12.1, unit: "g/dL", status: "NORMAL", confidence: 0.95 },
            { testName: "PLT", value: 220, unit: "x10E3/uL", status: "NORMAL", confidence: 0.95 },
          ],
        },
        {
          panelName: "BMP",
          results: [
            { testName: "Sodium", value: 138, unit: "mEq/L", status: "NORMAL", confidence: 0.9 },
            { testName: "Potassium", value: 3.2, unit: "mEq/L", status: "LOW", confidence: 0.9 },
            { testName: "Creatinine", value: 1.1, unit: "mg/dL", status: "NORMAL", confidence: 0.9 },
          ],
        },
      ],
      medications: [
        {
          name: "Ceftriaxone",
          dose: "1 g",
          route: "IV",
          frequency: "DAILY",
          status: "ACTIVE",
          confidence: 0.9,
        },
        {
          name: "Metronidazole",
          dose: "500 mg",
          route: "IV",
          frequency: "Q8H",
          status: "ACTIVE",
          confidence: 0.9,
        },
        {
          name: "Morphine",
          dose: "2 mg",
          route: "IV",
          frequency: "PRN",
          status: "PRN",
          confidence: 0.85,
        },
      ],
      diagnoses: [
        {
          description: "Acute appendicitis",
          type: "PRIMARY",
          icdCode: "K35.80",
          status: "ACTIVE",
          confidence: 0.95,
        },
        {
          description: "Hypokalemia",
          type: "SECONDARY",
          icdCode: "E87.6",
          status: "ACTIVE",
          confidence: 0.9,
        },
      ],
      vitalSets: [
        {
          vitals: [
            { type: "BP_SYSTOLIC", value: 118, unit: "mmHg", status: "NORMAL", confidence: 0.95 },
            { type: "BP_DIASTOLIC", value: 76, unit: "mmHg", status: "NORMAL", confidence: 0.95 },
            { type: "HEART_RATE", value: 92, unit: "bpm", status: "NORMAL", confidence: 0.95 },
            { type: "TEMPERATURE", value: 101.2, unit: "°F", status: "ABNORMAL", confidence: 0.9 },
            { type: "SPO2", value: 97, unit: "%", status: "NORMAL", confidence: 0.95 },
          ],
        },
      ],
      imagingFindings: [
        {
          modality: "CT",
          bodyPart: "Abdomen/Pelvis",
          finding: "Dilated appendix with periappendiceal fat stranding",
          impression: "Acute appendicitis without perforation",
          isAbnormal: true,
          confidence: 0.95,
        },
      ],
      procedures: [],
      extractionCount: 15,
      lowConfidenceCount: 0,
      processingTimeMs: 50,
    };

    const originalText = `
      ADMISSION NOTE

      Chief Complaint: Abdominal pain x 2 days

      History of Present Illness: Patient is a previously healthy individual
      presenting with 2 days of progressively worsening right lower quadrant
      abdominal pain. Pain began periumbilically and migrated to RLQ. Associated
      with nausea, vomiting, and fever. No diarrhea.

      Physical Exam: Temperature 101.2F, BP 118/76, HR 92, RR 16, SpO2 97%
      Abdomen: Tender RLQ with rebound, positive McBurney's point

      Laboratory Results:
      WBC 15.2 x10E3/uL (H), HGB 12.1 g/dL, PLT 220 x10E3/uL
      Na 138 mEq/L, K 3.2 mEq/L (L), Cr 1.1 mg/dL

      Imaging: CT Abdomen/Pelvis shows dilated appendix with periappendiceal
      fat stranding consistent with acute appendicitis without perforation.

      Assessment/Plan:
      1. Acute appendicitis - plan for laparoscopic appendectomy
      2. Hypokalemia - replete with IV KCl

      Medications:
      - Ceftriaxone 1g IV daily
      - Metronidazole 500mg IV Q8H
      - Morphine 2mg IV PRN pain
    `.trim();

    const result = await runGenerate({
      documentId: "patient-chart-001",
      originalText,
      extraction,
    });

    // Check structure
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.fullNarrative.length).toBeGreaterThan(0);

    // Check content
    expect(result.fullNarrative).toContain("appendicitis");
    expect(result.fullNarrative).toContain("Ceftriaxone");
    expect(result.fullNarrative).toContain("WBC");

    // Check metrics
    expect(result.diagnosisCount).toBe(2);
    expect(result.medicationCount).toBe(3);
    expect(result.labCount).toBe(6);
    expect(result.abnormalLabCount).toBe(2); // WBC high, K low
    expect(result.imagingCount).toBe(1);

    // Check compression
    expect(result.compressionRatio).toBeGreaterThan(0);
    expect(result.outputCharCount).toBeLessThan(result.inputCharCount);

    console.log("=== Generated Clinical Summary ===");
    console.log(result.fullNarrative);
    console.log(`\nCompression: ${(result.compressionRatio * 100).toFixed(1)}%`);
    console.log(`Input: ${result.inputCharCount} chars -> Output: ${result.outputCharCount} chars`);
  });
});
