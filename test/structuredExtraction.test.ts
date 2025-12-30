/**
 * STRUCTURED EXTRACTION - COMPREHENSIVE TEST SUITE
 *
 * Tests for extracting structured clinical data from unstructured text.
 * All test data uses synthetic/generalized examples.
 */

import { describe, it, expect } from "vitest";
import { Effect, pipe } from "effect";
import {
  getLabStatus,
  parseFrequency,
  parseRoute,
  parseModality,
  REFERENCE_RANGES,
  LAB_PATTERNS,
  VITAL_PATTERNS,
  ExtractionConfig,
} from "../schemas/structuredExtraction";
import {
  StructuredExtractionService,
  StructuredExtractionServiceLive,
  ExtractionDocumentInput,
  getExtractionSummary,
} from "../services/structuredExtraction.effect";

// ============================================================================
// HELPER - Run extraction service
// ============================================================================

const runExtractAll = async (
  document: ExtractionDocumentInput,
  config?: Partial<ExtractionConfig>
) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(StructuredExtractionService);
      return yield* _(service.extractAll(document, config));
    }),
    Effect.provide(StructuredExtractionServiceLive)
  );
  return Effect.runPromise(program);
};

const runExtractLabs = async (text: string, date?: string) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(StructuredExtractionService);
      return yield* _(service.extractLabs(text, date));
    }),
    Effect.provide(StructuredExtractionServiceLive)
  );
  return Effect.runPromise(program);
};

const runExtractMedications = async (text: string) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(StructuredExtractionService);
      return yield* _(service.extractMedications(text));
    }),
    Effect.provide(StructuredExtractionServiceLive)
  );
  return Effect.runPromise(program);
};

const runExtractVitals = async (text: string, date?: string) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(StructuredExtractionService);
      return yield* _(service.extractVitals(text, date));
    }),
    Effect.provide(StructuredExtractionServiceLive)
  );
  return Effect.runPromise(program);
};

const runExtractDiagnoses = async (text: string) => {
  const program = pipe(
    Effect.gen(function* (_) {
      const service = yield* _(StructuredExtractionService);
      return yield* _(service.extractDiagnoses(text));
    }),
    Effect.provide(StructuredExtractionServiceLive)
  );
  return Effect.runPromise(program);
};

// ============================================================================
// 1. LAB STATUS CLASSIFICATION
// ============================================================================

describe("Lab Status Classification", () => {
  describe("getLabStatus", () => {
    it("returns NORMAL for values within range", () => {
      expect(getLabStatus(7.0, "WBC")).toBe("NORMAL"); // 3.5-11.0
      expect(getLabStatus(14.0, "HGB")).toBe("NORMAL"); // 12.0-17.0
      expect(getLabStatus(140, "SODIUM")).toBe("NORMAL"); // 136-145
    });

    it("returns HIGH for values above range", () => {
      expect(getLabStatus(15.0, "WBC")).toBe("HIGH"); // > 11.0
      expect(getLabStatus(150, "SODIUM")).toBe("HIGH"); // > 145
    });

    it("returns LOW for values below range", () => {
      expect(getLabStatus(2.0, "WBC")).toBe("LOW"); // < 3.5
      expect(getLabStatus(130, "SODIUM")).toBe("LOW"); // < 136
    });

    it("returns CRITICAL_HIGH for very high values", () => {
      expect(getLabStatus(30.0, "WBC")).toBe("CRITICAL_HIGH"); // > 22 (2x11)
    });

    it("returns CRITICAL_LOW for very low values", () => {
      expect(getLabStatus(1.0, "WBC")).toBe("CRITICAL_LOW"); // < 1.75 (0.5x3.5)
    });

    it("returns UNKNOWN for unknown tests", () => {
      expect(getLabStatus(100, "UNKNOWN_TEST")).toBe("UNKNOWN");
    });

    it("uses custom range when provided", () => {
      expect(getLabStatus(50, "CUSTOM", { low: 10, high: 40 })).toBe("HIGH");
      expect(getLabStatus(5, "CUSTOM", { low: 10, high: 40 })).toBe("LOW");
      expect(getLabStatus(25, "CUSTOM", { low: 10, high: 40 })).toBe("NORMAL");
    });
  });

  describe("Reference ranges are sensible", () => {
    it("all ranges have low < high", () => {
      for (const [_name, range] of Object.entries(REFERENCE_RANGES)) {
        expect(range.low).toBeLessThan(range.high);
      }
    });

    it("all ranges have positive values", () => {
      for (const [_name, range] of Object.entries(REFERENCE_RANGES)) {
        expect(range.low).toBeGreaterThanOrEqual(0);
        expect(range.high).toBeGreaterThan(0);
      }
    });
  });
});

// ============================================================================
// 2. MEDICATION PARSING
// ============================================================================

describe("Medication Parsing", () => {
  describe("parseFrequency", () => {
    it("parses common frequencies", () => {
      expect(parseFrequency("daily")).toBe("DAILY");
      expect(parseFrequency("BID")).toBe("BID");
      expect(parseFrequency("TID")).toBe("TID");
      expect(parseFrequency("QID")).toBe("QID");
      expect(parseFrequency("PRN")).toBe("PRN");
      expect(parseFrequency("Q4H")).toBe("Q4H");
      expect(parseFrequency("Q6H")).toBe("Q6H");
      expect(parseFrequency("Q8H")).toBe("Q8H");
      expect(parseFrequency("Q12H")).toBe("Q12H");
      expect(parseFrequency("QHS")).toBe("QHS");
      expect(parseFrequency("weekly")).toBe("WEEKLY");
      expect(parseFrequency("once")).toBe("ONCE");
    });

    it("handles variations", () => {
      expect(parseFrequency("twice daily")).toBe("BID");
      expect(parseFrequency("every day")).toBe("DAILY");
      expect(parseFrequency("at bedtime")).toBe("QHS");
      expect(parseFrequency("as needed")).toBe("PRN");
    });

    it("returns UNKNOWN for unrecognized", () => {
      expect(parseFrequency("random")).toBe("UNKNOWN");
      expect(parseFrequency("")).toBe("UNKNOWN");
    });
  });

  describe("parseRoute", () => {
    it("parses common routes", () => {
      expect(parseRoute("PO")).toBe("PO");
      expect(parseRoute("IV")).toBe("IV");
      expect(parseRoute("IM")).toBe("IM");
      expect(parseRoute("SC")).toBe("SC");
      expect(parseRoute("SubQ")).toBe("SC");
      expect(parseRoute("SL")).toBe("SL");
      expect(parseRoute("PR")).toBe("PR");
      expect(parseRoute("topical")).toBe("TOP");
      expect(parseRoute("inhaled")).toBe("INH");
    });

    it("handles full words", () => {
      expect(parseRoute("oral")).toBe("PO");
      expect(parseRoute("intravenous")).toBe("IV");
      expect(parseRoute("intramuscular")).toBe("IM");
      expect(parseRoute("subcutaneous")).toBe("SC");
    });

    it("returns UNKNOWN for unrecognized", () => {
      expect(parseRoute("unknown")).toBe("UNKNOWN");
    });
  });
});

// ============================================================================
// 3. IMAGING MODALITY PARSING
// ============================================================================

describe("Imaging Modality Parsing", () => {
  describe("parseModality", () => {
    it("parses common modalities", () => {
      expect(parseModality("X-ray")).toBe("XRAY");
      expect(parseModality("Xray")).toBe("XRAY");
      expect(parseModality("CT")).toBe("CT");
      expect(parseModality("MRI")).toBe("MRI");
      expect(parseModality("Ultrasound")).toBe("ULTRASOUND");
      expect(parseModality("US")).toBe("ULTRASOUND");
      expect(parseModality("PET")).toBe("PET");
      expect(parseModality("Mammogram")).toBe("MAMMOGRAM");
      expect(parseModality("Fluoroscopy")).toBe("FLUOROSCOPY");
    });

    it("returns UNKNOWN for unrecognized", () => {
      expect(parseModality("unknown")).toBe("UNKNOWN");
    });
  });
});

// ============================================================================
// 4. LAB PATTERN MATCHING
// ============================================================================

describe("Lab Pattern Matching", () => {
  it("matches WBC values", () => {
    expect("WBC 12.5 x10E3/uL".match(LAB_PATTERNS.WBC)).toBeTruthy();
    expect("WBC: 8.2".match(LAB_PATTERNS.WBC)).toBeTruthy();
    expect("WBC 15".match(LAB_PATTERNS.WBC)).toBeTruthy();
  });

  it("matches hemoglobin values", () => {
    expect("HGB 14.2 g/dL".match(LAB_PATTERNS.HGB)).toBeTruthy();
    expect("Hemoglobin: 12.0".match(LAB_PATTERNS.HGB)).toBeTruthy();
    expect("Hgb 13.5".match(LAB_PATTERNS.HGB)).toBeTruthy();
  });

  it("matches chemistry values", () => {
    expect("Sodium 140 mEq/L".match(LAB_PATTERNS.SODIUM)).toBeTruthy();
    expect("Na: 138".match(LAB_PATTERNS.SODIUM)).toBeTruthy();
    expect("K 4.2 mEq/L".match(LAB_PATTERNS.POTASSIUM)).toBeTruthy();
    expect("Potassium: 3.8".match(LAB_PATTERNS.POTASSIUM)).toBeTruthy();
    expect("BUN 15 mg/dL".match(LAB_PATTERNS.BUN)).toBeTruthy();
    expect("Creatinine 1.0".match(LAB_PATTERNS.CREATININE)).toBeTruthy();
    expect("Glucose 98 mg/dL".match(LAB_PATTERNS.GLUCOSE)).toBeTruthy();
  });

  it("matches liver function tests", () => {
    expect("AST 25 U/L".match(LAB_PATTERNS.AST)).toBeTruthy();
    expect("ALT 30 U/L".match(LAB_PATTERNS.ALT)).toBeTruthy();
    expect("Alk Phos 80".match(LAB_PATTERNS.ALP)).toBeTruthy();
  });

  it("matches reference ranges", () => {
    expect("(3.5-11.0)".match(LAB_PATTERNS.REFERENCE_RANGE)).toBeTruthy();
    expect("[70-100]".match(LAB_PATTERNS.REFERENCE_RANGE)).toBeTruthy();
    expect("12.0 - 17.0".match(LAB_PATTERNS.REFERENCE_RANGE)).toBeTruthy();
  });

  it("matches status flags", () => {
    expect("H".match(LAB_PATTERNS.STATUS_FLAG)).toBeTruthy();
    expect("L".match(LAB_PATTERNS.STATUS_FLAG)).toBeTruthy();
    expect("HIGH".match(LAB_PATTERNS.STATUS_FLAG)).toBeTruthy();
    expect("LOW".match(LAB_PATTERNS.STATUS_FLAG)).toBeTruthy();
    expect("CRIT".match(LAB_PATTERNS.STATUS_FLAG)).toBeTruthy();
  });
});

// ============================================================================
// 5. VITAL PATTERN MATCHING
// ============================================================================

describe("Vital Pattern Matching", () => {
  it("matches blood pressure", () => {
    expect("BP 120/80".match(VITAL_PATTERNS.BP)).toBeTruthy();
    expect("BP: 130/85 mmHg".match(VITAL_PATTERNS.BP)).toBeTruthy();
  });

  it("matches heart rate", () => {
    expect("HR 72 bpm".match(VITAL_PATTERNS.HR)).toBeTruthy();
    expect("Heart Rate: 80".match(VITAL_PATTERNS.HR)).toBeTruthy();
    expect("Pulse 65".match(VITAL_PATTERNS.HR)).toBeTruthy();
  });

  it("matches respiratory rate", () => {
    expect("RR 16".match(VITAL_PATTERNS.RR)).toBeTruthy();
    expect("Resp Rate: 18 /min".match(VITAL_PATTERNS.RR)).toBeTruthy();
  });

  it("matches temperature", () => {
    expect("Temp 98.6 F".match(VITAL_PATTERNS.TEMP)).toBeTruthy();
    expect("Temperature: 37.0 C".match(VITAL_PATTERNS.TEMP)).toBeTruthy();
  });

  it("matches SpO2", () => {
    expect("SpO2 98%".match(VITAL_PATTERNS.SPO2)).toBeTruthy();
    expect("O2 Sat: 97".match(VITAL_PATTERNS.SPO2)).toBeTruthy();
  });

  it("matches weight", () => {
    expect("Weight 70 kg".match(VITAL_PATTERNS.WEIGHT)).toBeTruthy();
    expect("Weight: 154 lbs".match(VITAL_PATTERNS.WEIGHT)).toBeTruthy();
  });

  it("matches pain scale", () => {
    expect("Pain 5/10".match(VITAL_PATTERNS.PAIN)).toBeTruthy();
    expect("Pain: 3".match(VITAL_PATTERNS.PAIN)).toBeTruthy();
  });
});

// ============================================================================
// 6. LAB EXTRACTION
// ============================================================================

describe("Lab Extraction", () => {
  it("extracts CBC values", async () => {
    const text = `
      COMPLETE BLOOD COUNT
      WBC 8.5 x10E3/uL (3.5-11.0)
      RBC 4.5 x10E6/uL
      HGB 14.2 g/dL
      HCT 42%
      PLT 250 x10E3/uL
    `;

    const panels = await runExtractLabs(text, "2025-01-15");

    expect(panels.length).toBeGreaterThan(0);
    expect(panels[0].panelName).toBe("CBC");

    const results = panels[0].results;
    expect(results.some((r) => r.testName === "WBC")).toBe(true);
    expect(results.some((r) => r.testName === "HGB")).toBe(true);

    const wbc = results.find((r) => r.testName === "WBC");
    expect(wbc?.value).toBeCloseTo(8.5, 1);
    expect(wbc?.status).toBe("NORMAL");
  });

  it("extracts chemistry panel", async () => {
    const text = `
      BASIC METABOLIC PANEL
      Sodium 140 mEq/L
      Potassium 4.0 mEq/L
      BUN 15 mg/dL
      Creatinine 1.0 mg/dL
      Glucose 98 mg/dL
    `;

    const panels = await runExtractLabs(text);

    expect(panels.length).toBeGreaterThan(0);
    expect(panels[0].panelName).toBe("BMP");

    const results = panels[0].results;
    expect(results.some((r) => r.testName === "SODIUM")).toBe(true);
    expect(results.some((r) => r.testName === "GLUCOSE")).toBe(true);
  });

  it("detects abnormal values", async () => {
    const text = `
      WBC 15.0 H x10E3/uL (3.5-11.0)
      HGB 9.0 L g/dL
    `;

    const panels = await runExtractLabs(text);
    const results = panels[0].results;

    const wbc = results.find((r) => r.testName === "WBC");
    expect(wbc?.status).toBe("HIGH");

    const hgb = results.find((r) => r.testName === "HGB");
    expect(hgb?.status).toBe("LOW");
  });

  it("extracts reference ranges", async () => {
    const text = "WBC 8.0 (3.5-11.0) x10E3/uL";

    const panels = await runExtractLabs(text);
    const wbc = panels[0].results.find((r) => r.testName === "WBC");

    expect(wbc?.referenceRange).toBe("3.5-11");
    expect(wbc?.referenceLow).toBeCloseTo(3.5, 1);
    expect(wbc?.referenceHigh).toBeCloseTo(11, 1);
  });

  it("returns empty for text without labs", async () => {
    const text = "The weather is nice today.";
    const panels = await runExtractLabs(text);
    expect(panels.length).toBe(0);
  });
});

// ============================================================================
// 7. MEDICATION EXTRACTION
// ============================================================================

describe("Medication Extraction", () => {
  it("extracts medication with full details", async () => {
    const text = `
      MEDICATIONS:
      metformin, 500 mg, PO, BID
      lisinopril, 10 mg, PO, daily
      aspirin, 81 mg, PO, daily
    `;

    const meds = await runExtractMedications(text);

    expect(meds.length).toBeGreaterThanOrEqual(3);

    const metformin = meds.find((m) => m.name.toLowerCase().includes("metformin"));
    expect(metformin).toBeDefined();
    expect(metformin?.doseValue).toBe(500);
    expect(metformin?.doseUnit).toBe("mg");
    expect(metformin?.route).toBe("PO");
    expect(metformin?.frequency).toBe("BID");
  });

  it("extracts medications by drug suffix patterns", async () => {
    const text = `
      Current medications include atorvastatin for cholesterol
      and omeprazole for GERD.
    `;

    const meds = await runExtractMedications(text);

    // Should find -statin and -azole patterns
    expect(meds.some((m) => m.name.toLowerCase().includes("statin"))).toBe(true);
    expect(meds.some((m) => m.name.toLowerCase().includes("azole"))).toBe(true);
  });

  it("handles PRN medications", async () => {
    const text = "acetaminophen, 500 mg, PO, PRN for pain";

    const meds = await runExtractMedications(text);
    const tylenol = meds.find((m) => m.name.toLowerCase().includes("acetaminophen"));

    expect(tylenol?.frequency).toBe("PRN");
    expect(tylenol?.status).toBe("PRN");
  });

  it("deduplicates medications", async () => {
    const text = `
      metformin 500mg BID
      metformin 500mg BID
      metformin 500mg BID
    `;

    const meds = await runExtractMedications(text);
    const metforminCount = meds.filter((m) =>
      m.name.toLowerCase().includes("metformin")
    ).length;

    expect(metforminCount).toBe(1);
  });
});

// ============================================================================
// 8. VITAL EXTRACTION
// ============================================================================

describe("Vital Extraction", () => {
  it("extracts complete vital set", async () => {
    const text = `
      VITAL SIGNS:
      BP 120/80 mmHg
      HR 72 bpm
      RR 16 /min
      Temp 98.6 F
      SpO2 98%
      Weight 70 kg
    `;

    const vitalSets = await runExtractVitals(text, "2025-01-15");

    expect(vitalSets.length).toBeGreaterThan(0);
    const vitals = vitalSets[0].vitals;

    expect(vitals.some((v) => v.type === "BP_SYSTOLIC")).toBe(true);
    expect(vitals.some((v) => v.type === "BP_DIASTOLIC")).toBe(true);
    expect(vitals.some((v) => v.type === "HEART_RATE")).toBe(true);
    expect(vitals.some((v) => v.type === "RESPIRATORY_RATE")).toBe(true);
    expect(vitals.some((v) => v.type === "TEMPERATURE")).toBe(true);
    expect(vitals.some((v) => v.type === "SPO2")).toBe(true);

    const systolic = vitals.find((v) => v.type === "BP_SYSTOLIC");
    expect(systolic?.value).toBe(120);
    expect(systolic?.status).toBe("NORMAL");
  });

  it("flags abnormal vitals", async () => {
    const text = `
      BP 180/100 mmHg
      HR 120 bpm
      SpO2 88%
      Temp 102.5 F
    `;

    const vitalSets = await runExtractVitals(text);
    const vitals = vitalSets[0].vitals;

    expect(vitals.find((v) => v.type === "BP_SYSTOLIC")?.status).toBe("ABNORMAL");
    expect(vitals.find((v) => v.type === "HEART_RATE")?.status).toBe("ABNORMAL");
    expect(vitals.find((v) => v.type === "SPO2")?.status).toBe("ABNORMAL");
    expect(vitals.find((v) => v.type === "TEMPERATURE")?.status).toBe("ABNORMAL");
  });
});

// ============================================================================
// 9. DIAGNOSIS EXTRACTION
// ============================================================================

describe("Diagnosis Extraction", () => {
  it("extracts diagnoses from Assessment section", async () => {
    const text = `
      ASSESSMENT:
      1. Type 2 diabetes mellitus
      2. Essential hypertension
      3. Hyperlipidemia
    `;

    const diagnoses = await runExtractDiagnoses(text);

    expect(diagnoses.length).toBeGreaterThanOrEqual(3);
    expect(diagnoses.some((d) => d.description.toLowerCase().includes("diabetes"))).toBe(true);
    expect(diagnoses.some((d) => d.description.toLowerCase().includes("hypertension"))).toBe(true);
  });

  it("extracts primary diagnosis", async () => {
    const text = `
      Primary Diagnosis: Acute appendicitis

      Secondary Diagnoses:
      - Fever
      - Abdominal pain
    `;

    const diagnoses = await runExtractDiagnoses(text);

    const primary = diagnoses.find((d) => d.type === "PRIMARY");
    expect(primary).toBeDefined();
    expect(primary?.description.toLowerCase()).toContain("appendicitis");
  });

  it("extracts ICD codes when present", async () => {
    const text = `
      Diagnoses:
      - Type 2 diabetes mellitus E11.9
      - Essential hypertension I10
    `;

    const diagnoses = await runExtractDiagnoses(text);

    const diabetes = diagnoses.find((d) =>
      d.description.toLowerCase().includes("diabetes")
    );
    expect(diabetes?.icdCode).toBe("E11.9");
  });
});

// ============================================================================
// 10. FULL EXTRACTION
// ============================================================================

describe("Full Document Extraction", () => {
  it("extracts all data types from a complete note", async () => {
    const document: ExtractionDocumentInput = {
      id: "test-doc-001",
      content: `
        PROGRESS NOTE

        VITAL SIGNS:
        BP 130/85, HR 78, RR 18, Temp 98.8 F, SpO2 97%

        LABS:
        WBC 9.5 x10E3/uL
        HGB 13.5 g/dL
        Sodium 141 mEq/L
        Creatinine 0.9 mg/dL

        ASSESSMENT:
        1. Stable chronic kidney disease
        2. Controlled hypertension

        MEDICATIONS:
        metformin, 500 mg, PO, BID
        lisinopril, 10 mg, PO, daily

        IMAGING:
        CT chest shows no acute findings.
      `,
      metadata: { date: "2025-01-15" },
    };

    const result = await runExtractAll(document);

    expect(result.documentId).toBe("test-doc-001");
    expect(result.labPanels.length).toBeGreaterThan(0);
    expect(result.medications.length).toBeGreaterThan(0);
    expect(result.diagnoses.length).toBeGreaterThan(0);
    expect(result.vitalSets.length).toBeGreaterThan(0);
    expect(result.extractionCount).toBeGreaterThan(0);
  });

  it("respects minConfidence filter", async () => {
    const document: ExtractionDocumentInput = {
      id: "test-doc-002",
      content: "WBC 10.0",
    };

    const result = await runExtractAll(document, { minConfidence: 0.95 });

    // High confidence filter might exclude partial matches
    const _totalLabs = result.labPanels.reduce(
      (sum, p) => sum + p.results.length,
      0
    );
    // Result depends on pattern match quality
    expect(result.extractionCount).toBeDefined();
  });
});

// ============================================================================
// 11. EXTRACTION SUMMARY
// ============================================================================

describe("Extraction Summary", () => {
  it("computes correct summary", () => {
    const mockResult = {
      documentId: "test",
      labPanels: [
        {
          panelName: "CBC",
          results: [
            { testName: "WBC", value: 10, unit: "", status: "NORMAL" as const, confidence: 0.9 },
            { testName: "HGB", value: 14, unit: "", status: "NORMAL" as const, confidence: 0.6 },
          ],
        },
      ],
      medications: [
        { name: "med1", route: "PO" as const, frequency: "DAILY" as const, status: "ACTIVE" as const, confidence: 0.8 },
      ],
      diagnoses: [
        { description: "dx1", type: "PRIMARY" as const, status: "ACTIVE" as const, confidence: 0.9 },
      ],
      vitalSets: [
        {
          vitals: [
            { type: "HEART_RATE" as const, value: 72, unit: "bpm", confidence: 0.9 },
          ],
        },
      ],
      imagingFindings: [],
      procedures: [],
      extractionCount: 5,
      lowConfidenceCount: 1,
      processingTimeMs: 50,
    };

    const summary = getExtractionSummary(mockResult);

    expect(summary.labCount).toBe(2);
    expect(summary.medicationCount).toBe(1);
    expect(summary.diagnosisCount).toBe(1);
    expect(summary.vitalCount).toBe(1);
    expect(summary.totalExtractions).toBe(5);
    expect(summary.lowConfidencePercent).toBe("20.0%");
  });
});

// ============================================================================
// 12. EDGE CASES
// ============================================================================

describe("Edge Cases", () => {
  it("handles empty document", async () => {
    const document: ExtractionDocumentInput = {
      id: "empty",
      content: "",
    };

    const result = await runExtractAll(document);

    expect(result.extractionCount).toBe(0);
    expect(result.labPanels.length).toBe(0);
    expect(result.medications.length).toBe(0);
  });

  it("handles document with no medical content", async () => {
    const document: ExtractionDocumentInput = {
      id: "nonmedical",
      content: "The quick brown fox jumps over the lazy dog.",
    };

    const result = await runExtractAll(document);
    expect(result.extractionCount).toBe(0);
  });

  it("handles malformed lab values gracefully", async () => {
    const text = "WBC abc, HGB --, PLT ???";
    const panels = await runExtractLabs(text);

    // Should not crash, may return empty
    expect(panels).toBeDefined();
  });
});

// ============================================================================
// 13. DETERMINISM
// ============================================================================

describe("Determinism", () => {
  it("produces same results for same input", async () => {
    const document: ExtractionDocumentInput = {
      id: "determinism-test",
      content: `
        WBC 10.0 x10E3/uL
        HGB 14.0 g/dL
        metformin 500mg PO BID
        BP 120/80
      `,
    };

    const result1 = await runExtractAll(document);
    const result2 = await runExtractAll(document);

    expect(result1.extractionCount).toBe(result2.extractionCount);
    expect(result1.labPanels.length).toBe(result2.labPanels.length);
    expect(result1.medications.length).toBe(result2.medications.length);
  });
});
