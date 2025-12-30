/**
 * STRUCTURED EXTRACTION SERVICE - EFFECT-TS
 *
 * Extracts structured clinical data from unstructured medical text.
 * Uses regex patterns with confidence scoring - no ML required.
 *
 * Design:
 * - Generalized patterns work across different document formats
 * - Confidence scoring based on match quality
 * - Temporal grouping for trend analysis
 * - Safe extraction (uncertain data is flagged)
 */

import { Effect, Context, Layer } from "effect";
import {
  ExtractionConfig,
  defaultExtractionConfig,
  ExtractionResult,
  LabResult,
  LabPanel,
  LabTrend,
  Medication,
  Diagnosis,
  VitalSign,
  VitalSet,
  ImagingFinding,
  Procedure,
  LabStatus,
  LAB_PATTERNS,
  MEDICATION_PATTERNS,
  VITAL_PATTERNS,
  DIAGNOSIS_PATTERNS,
  IMAGING_PATTERNS,
  REFERENCE_RANGES,
  getLabStatus,
  parseFrequency,
  parseRoute,
  parseModality,
} from "../schemas/structuredExtraction";

// ============================================================================
// SERVICE ERROR TYPE
// ============================================================================

export class ExtractionError extends Error {
  readonly _tag = "ExtractionError";
  constructor(
    readonly message: string,
    readonly documentId?: string
  ) {
    super(message);
  }
}

// ============================================================================
// DOCUMENT INPUT TYPE
// ============================================================================

export interface ExtractionDocumentInput {
  id: string;
  content: string;
  metadata?: {
    date?: string;
    type?: string;
  };
}

// ============================================================================
// SERVICE INTERFACE
// ============================================================================

export interface StructuredExtractionService {
  /**
   * Extract all structured data from a document
   */
  readonly extractAll: (
    document: ExtractionDocumentInput,
    config?: Partial<ExtractionConfig>
  ) => Effect.Effect<ExtractionResult, ExtractionError, never>;

  /**
   * Extract lab results only
   */
  readonly extractLabs: (
    text: string,
    documentDate?: string
  ) => Effect.Effect<LabPanel[], never, never>;

  /**
   * Extract medications only
   */
  readonly extractMedications: (
    text: string
  ) => Effect.Effect<Medication[], never, never>;

  /**
   * Extract diagnoses only
   */
  readonly extractDiagnoses: (
    text: string
  ) => Effect.Effect<Diagnosis[], never, never>;

  /**
   * Extract vital signs only
   */
  readonly extractVitals: (
    text: string,
    documentDate?: string
  ) => Effect.Effect<VitalSet[], never, never>;

  /**
   * Extract imaging findings only
   */
  readonly extractImaging: (
    text: string
  ) => Effect.Effect<ImagingFinding[], never, never>;

  /**
   * Analyze lab trends across multiple extractions
   */
  readonly analyzeTrends: (
    labPanels: LabPanel[]
  ) => Effect.Effect<LabTrend[], never, never>;

  /**
   * Extract from multiple documents and merge
   */
  readonly extractBatch: (
    documents: ExtractionDocumentInput[],
    config?: Partial<ExtractionConfig>
  ) => Effect.Effect<ExtractionResult[], ExtractionError, never>;
}

export const StructuredExtractionService =
  Context.GenericTag<StructuredExtractionService>("StructuredExtractionService");

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class StructuredExtractionServiceImpl implements StructuredExtractionService {
  /**
   * Extract lab results from text
   */
  readonly extractLabs = (text: string, documentDate?: string) => {
    return Effect.sync(() => {
      const results: LabResult[] = [];
      const lines = text.split("\n");

      // Process each line for lab values
      for (const line of lines) {
        for (const [testName, pattern] of Object.entries(LAB_PATTERNS)) {
          if (testName === "REFERENCE_RANGE" || testName === "STATUS_FLAG") continue;

          const match = line.match(pattern);
          if (match) {
            const value = parseFloat(match[1]);
            if (isNaN(value)) continue;

            const unit = match[2] || REFERENCE_RANGES[testName]?.unit || "";

            // Check for H/L flags
            const statusMatch = line.match(LAB_PATTERNS.STATUS_FLAG);
            let status: LabStatus = getLabStatus(value, testName);
            if (statusMatch) {
              const flag = statusMatch[1].toUpperCase();
              if (flag === "H" || flag === "HIGH") status = "HIGH";
              if (flag === "L" || flag === "LOW") status = "LOW";
              if (flag === "HH" || flag === "CRIT") status = "CRITICAL_HIGH";
              if (flag === "LL") status = "CRITICAL_LOW";
            }

            // Look for reference range in same line
            const rangeMatch = line.match(LAB_PATTERNS.REFERENCE_RANGE);
            let refRange: string | undefined;
            let refLow: number | undefined;
            let refHigh: number | undefined;
            if (rangeMatch) {
              refLow = parseFloat(rangeMatch[1]);
              refHigh = parseFloat(rangeMatch[2]);
              refRange = `${refLow}-${refHigh}`;
            }

            // Calculate confidence based on match quality
            let confidence = 0.8; // base confidence
            if (unit) confidence += 0.1;
            if (rangeMatch) confidence += 0.1;

            results.push({
              testName,
              value,
              unit,
              referenceRange: refRange,
              referenceLow: refLow,
              referenceHigh: refHigh,
              status,
              date: documentDate,
              confidence: Math.min(confidence, 1),
            });
          }
        }
      }

      // Group into panels (simplified - just one panel per extraction)
      if (results.length === 0) return [];

      // Determine panel name based on tests found
      const testNames = results.map((r) => r.testName);
      let panelName = "General";
      if (testNames.some((t) => ["WBC", "RBC", "HGB", "PLT"].includes(t))) {
        panelName = "CBC";
      } else if (testNames.some((t) => ["SODIUM", "POTASSIUM", "BUN", "CREATININE"].includes(t))) {
        panelName = "BMP";
      } else if (testNames.some((t) => ["AST", "ALT", "ALP", "BILIRUBIN"].includes(t))) {
        panelName = "LFT";
      }

      return [
        {
          panelName,
          date: documentDate,
          results,
        },
      ];
    });
  };

  /**
   * Extract medications from text
   */
  readonly extractMedications = (text: string) => {
    return Effect.sync(() => {
      const medications: Medication[] = [];
      const lines = text.split("\n");
      const seen = new Set<string>();

      for (const line of lines) {
        // Try full order pattern first
        const fullMatch = line.match(MEDICATION_PATTERNS.FULL_ORDER);
        if (fullMatch) {
          const name = fullMatch[1].trim();
          const key = name.toLowerCase();

          if (seen.has(key)) continue;
          seen.add(key);

          const doseValue = fullMatch[2] ? parseFloat(fullMatch[2]) : undefined;
          const doseUnit = fullMatch[3] || undefined;
          const route = fullMatch[4] ? parseRoute(fullMatch[4]) : "UNKNOWN";
          const frequency = fullMatch[5] ? parseFrequency(fullMatch[5]) : "UNKNOWN";

          medications.push({
            name,
            dose: doseValue && doseUnit ? `${doseValue} ${doseUnit}` : undefined,
            doseValue,
            doseUnit,
            route,
            frequency,
            status: frequency === "PRN" ? "PRN" : "ACTIVE",
            confidence: 0.7,
          });
        } else {
          // Try to find medication names with common drug suffixes
          const drugPatterns = [
            /\b([A-Za-z]+(?:pril|olol|statin|azole|mycin|cillin|pam|lam|pine|done|one|ide|ate|ine))\b/gi,
          ];

          for (const pattern of drugPatterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
              const name = match[1];
              const key = name.toLowerCase();

              if (seen.has(key)) continue;
              if (name.length < 4) continue; // Skip short matches
              seen.add(key);

              // Look for dose, route, frequency in same line
              const doseMatch = line.match(MEDICATION_PATTERNS.DOSE);
              const routeMatch = line.match(MEDICATION_PATTERNS.ROUTE);
              const freqMatch = line.match(MEDICATION_PATTERNS.FREQUENCY);

              medications.push({
                name,
                dose: doseMatch ? doseMatch[0] : undefined,
                doseValue: doseMatch ? parseFloat(doseMatch[1]) : undefined,
                doseUnit: doseMatch ? doseMatch[2] : undefined,
                route: routeMatch ? parseRoute(routeMatch[1]) : "UNKNOWN",
                frequency: freqMatch ? parseFrequency(freqMatch[1]) : "UNKNOWN",
                status: "ACTIVE",
                confidence: 0.5, // Lower confidence for pattern-based detection
              });
            }
          }
        }
      }

      return medications;
    });
  };

  /**
   * Extract diagnoses from text
   */
  readonly extractDiagnoses = (text: string) => {
    return Effect.sync(() => {
      const diagnoses: Diagnosis[] = [];
      const lines = text.split("\n");
      let inDiagnosisSection = false;
      let currentType: Diagnosis["type"] = "UNKNOWN";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Check for diagnosis section headers
        // Handle case where diagnosis is on same line: "Primary Diagnosis: Acute appendicitis"
        const primaryMatch = line.match(DIAGNOSIS_PATTERNS.PRIMARY);
        if (primaryMatch) {
          inDiagnosisSection = true;
          currentType = "PRIMARY";
          // Check if there's content after the header on the same line
          const afterHeader = line.slice(primaryMatch.index! + primaryMatch[0].length).trim();
          if (afterHeader && afterHeader.length >= 3) {
            const icdMatch = afterHeader.match(DIAGNOSIS_PATTERNS.ICD10);
            diagnoses.push({
              description: afterHeader.replace(DIAGNOSIS_PATTERNS.ICD10, "").trim() || afterHeader,
              icdCode: icdMatch ? icdMatch[1] : undefined,
              type: "PRIMARY",
              status: "ACTIVE",
              confidence: icdMatch ? 0.9 : 0.8,
            });
          }
          continue;
        }
        const dischargeMatch = line.match(DIAGNOSIS_PATTERNS.DISCHARGE);
        if (dischargeMatch) {
          inDiagnosisSection = true;
          currentType = "DISCHARGE";
          // Check if there's content after the header on the same line
          const afterHeader = line.slice(dischargeMatch.index! + dischargeMatch[0].length).trim();
          if (afterHeader && afterHeader.length >= 3) {
            const icdMatch = afterHeader.match(DIAGNOSIS_PATTERNS.ICD10);
            diagnoses.push({
              description: afterHeader.replace(DIAGNOSIS_PATTERNS.ICD10, "").trim() || afterHeader,
              icdCode: icdMatch ? icdMatch[1] : undefined,
              type: "DISCHARGE",
              status: "ACTIVE",
              confidence: icdMatch ? 0.9 : 0.8,
            });
          }
          continue;
        }
        if (DIAGNOSIS_PATTERNS.DIAGNOSIS_HEADER.test(line)) {
          inDiagnosisSection = true;
          continue;
        }

        // If in diagnosis section, capture lines as diagnoses
        if (inDiagnosisSection) {
          // Stop at next section header
          if (/^[A-Z][A-Z\s]+:$/.test(line) && !DIAGNOSIS_PATTERNS.DIAGNOSIS_HEADER.test(line)) {
            inDiagnosisSection = false;
            continue;
          }

          // Skip numbered list prefixes
          const cleanLine = line.replace(/^[\d\.\)\-]+\s*/, "").trim();
          if (!cleanLine || cleanLine.length < 3) continue;

          // Look for ICD code
          const icdMatch = cleanLine.match(DIAGNOSIS_PATTERNS.ICD10);

          diagnoses.push({
            description: cleanLine.replace(DIAGNOSIS_PATTERNS.ICD10, "").trim() || cleanLine,
            icdCode: icdMatch ? icdMatch[1] : undefined,
            type: currentType,
            status: "ACTIVE",
            confidence: icdMatch ? 0.9 : 0.7,
          });
        }
      }

      return diagnoses;
    });
  };

  /**
   * Extract vital signs from text
   */
  readonly extractVitals = (text: string, documentDate?: string) => {
    return Effect.sync(() => {
      const vitals: VitalSign[] = [];

      // Blood pressure
      const bpMatch = text.match(VITAL_PATTERNS.BP);
      if (bpMatch) {
        vitals.push({
          type: "BP_SYSTOLIC",
          value: parseInt(bpMatch[1]),
          unit: "mmHg",
          date: documentDate,
          status: parseInt(bpMatch[1]) > 140 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
        vitals.push({
          type: "BP_DIASTOLIC",
          value: parseInt(bpMatch[2]),
          unit: "mmHg",
          date: documentDate,
          status: parseInt(bpMatch[2]) > 90 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
      }

      // Heart rate
      const hrMatch = text.match(VITAL_PATTERNS.HR);
      if (hrMatch) {
        const hr = parseInt(hrMatch[1]);
        vitals.push({
          type: "HEART_RATE",
          value: hr,
          unit: "bpm",
          date: documentDate,
          status: hr < 60 || hr > 100 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
      }

      // Respiratory rate
      const rrMatch = text.match(VITAL_PATTERNS.RR);
      if (rrMatch) {
        const rr = parseInt(rrMatch[1]);
        vitals.push({
          type: "RESPIRATORY_RATE",
          value: rr,
          unit: "/min",
          date: documentDate,
          status: rr < 12 || rr > 20 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
      }

      // Temperature
      const tempMatch = text.match(VITAL_PATTERNS.TEMP);
      if (tempMatch) {
        let temp = parseFloat(tempMatch[1]);
        const unit = tempMatch[2] || "F";
        // Convert C to F for status check
        const tempF = unit.toUpperCase().includes("C") ? temp * 9 / 5 + 32 : temp;

        vitals.push({
          type: "TEMPERATURE",
          value: temp,
          unit: unit.includes("C") ? "°C" : "°F",
          date: documentDate,
          status: tempF > 100.4 || tempF < 96.8 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
      }

      // SpO2
      const spo2Match = text.match(VITAL_PATTERNS.SPO2);
      if (spo2Match) {
        const spo2 = parseInt(spo2Match[1]);
        vitals.push({
          type: "SPO2",
          value: spo2,
          unit: "%",
          date: documentDate,
          status: spo2 < 94 ? "ABNORMAL" : "NORMAL",
          confidence: 0.9,
        });
      }

      // Weight
      const weightMatch = text.match(VITAL_PATTERNS.WEIGHT);
      if (weightMatch) {
        vitals.push({
          type: "WEIGHT",
          value: parseFloat(weightMatch[1]),
          unit: weightMatch[2] || "kg",
          date: documentDate,
          confidence: 0.8,
        });
      }

      // Pain scale
      const painMatch = text.match(VITAL_PATTERNS.PAIN);
      if (painMatch) {
        vitals.push({
          type: "PAIN_SCALE",
          value: parseInt(painMatch[1]),
          unit: "/10",
          date: documentDate,
          confidence: 0.8,
        });
      }

      if (vitals.length === 0) return [];

      return [
        {
          date: documentDate,
          vitals,
        },
      ];
    });
  };

  /**
   * Extract imaging findings from text
   */
  readonly extractImaging = (text: string) => {
    return Effect.sync(() => {
      const findings: ImagingFinding[] = [];

      // Find modality mentions
      const modalityMatches = text.matchAll(new RegExp(IMAGING_PATTERNS.MODALITY, "gi"));

      for (const match of modalityMatches) {
        const modality = parseModality(match[0]);

        // Look for body part near modality
        const context = text.slice(Math.max(0, match.index! - 50), match.index! + 100);
        const bodyParts = context.match(/\b(chest|abdomen|head|brain|spine|knee|shoulder|hip|pelvis|neck|lung|heart|liver)\b/i);
        const bodyPart = bodyParts ? bodyParts[1] : "unspecified";

        // Look for impression/findings section
        const impressionStart = text.indexOf("IMPRESSION", match.index!);
        let finding = "";
        let impression = "";

        if (impressionStart !== -1 && impressionStart < match.index! + 500) {
          const impressionEnd = text.indexOf("\n\n", impressionStart);
          impression = text.slice(impressionStart + 11, impressionEnd !== -1 ? impressionEnd : impressionStart + 200).trim();
          finding = impression;
        } else {
          finding = `${modality} ${bodyPart} performed`;
        }

        // Check for abnormal keywords
        const isAbnormal = IMAGING_PATTERNS.ABNORMAL_KEYWORDS.test(context);

        findings.push({
          modality,
          bodyPart,
          finding,
          impression: impression || undefined,
          isAbnormal,
          confidence: impression ? 0.8 : 0.5,
        });
      }

      return findings;
    });
  };

  /**
   * Analyze lab trends across multiple panels
   */
  readonly analyzeTrends = (labPanels: LabPanel[]) => {
    return Effect.sync(() => {
      // Group by test name
      const byTest = new Map<string, Array<{ date: string; value: number; status: LabStatus }>>();

      for (const panel of labPanels) {
        if (!panel.date) continue;

        for (const result of panel.results) {
          if (!byTest.has(result.testName)) {
            byTest.set(result.testName, []);
          }
          byTest.get(result.testName)!.push({
            date: panel.date,
            value: result.value,
            status: result.status,
          });
        }
      }

      // Analyze each test
      const trends: LabTrend[] = [];

      for (const [testName, values] of byTest) {
        if (values.length < 2) {
          trends.push({
            testName,
            values,
            trend: "INSUFFICIENT_DATA",
          });
          continue;
        }

        // Sort by date
        values.sort((a, b) => a.date.localeCompare(b.date));

        // Calculate trend
        const first = values[0].value;
        const last = values[values.length - 1].value;
        const diff = last - first;
        const percentChange = Math.abs(diff / first) * 100;

        let trend: LabTrend["trend"];
        if (percentChange < 5) {
          trend = "STABLE";
        } else if (diff > 0) {
          trend = "INCREASING";
        } else {
          trend = "DECREASING";
        }

        // Check for fluctuation
        let maxSwing = 0;
        for (let i = 1; i < values.length; i++) {
          maxSwing = Math.max(maxSwing, Math.abs(values[i].value - values[i - 1].value));
        }
        if (maxSwing > Math.abs(diff) * 1.5) {
          trend = "FLUCTUATING";
        }

        trends.push({
          testName,
          values,
          trend,
        });
      }

      return trends;
    });
  };

  /**
   * Extract all structured data from a document
   */
  readonly extractAll = (
    document: ExtractionDocumentInput,
    configOverrides?: Partial<ExtractionConfig>
  ) => {
    return Effect.gen(this, function* (_) {
      const startTime = performance.now();
      const config = { ...defaultExtractionConfig, ...configOverrides };
      const text = document.content;
      const date = document.metadata?.date;

      let labPanels: LabPanel[] = [];
      let medications: Medication[] = [];
      let diagnoses: Diagnosis[] = [];
      let vitalSets: VitalSet[] = [];
      let imagingFindings: ImagingFinding[] = [];
      const procedures: Procedure[] = []; // TODO: implement procedure extraction

      if (config.extractLabs) {
        labPanels = yield* _(this.extractLabs(text, date));
      }

      if (config.extractMedications) {
        medications = yield* _(this.extractMedications(text));
      }

      if (config.extractDiagnoses) {
        diagnoses = yield* _(this.extractDiagnoses(text));
      }

      if (config.extractVitals) {
        vitalSets = yield* _(this.extractVitals(text, date));
      }

      if (config.extractImaging) {
        imagingFindings = yield* _(this.extractImaging(text));
      }

      // Filter by confidence threshold
      if (config.minConfidence > 0) {
        labPanels = labPanels.map((p) => ({
          ...p,
          results: p.results.filter((r) => r.confidence >= config.minConfidence),
        }));
        medications = medications.filter((m) => m.confidence >= config.minConfidence);
        diagnoses = diagnoses.filter((d) => d.confidence >= config.minConfidence);
        imagingFindings = imagingFindings.filter((f) => f.confidence >= config.minConfidence);
      }

      // Analyze trends if enabled and we have lab data
      let labTrends: LabTrend[] | undefined;
      if (config.detectTrends && labPanels.length > 0) {
        labTrends = yield* _(this.analyzeTrends(labPanels));
      }

      // Count extractions
      const extractionCount =
        labPanels.reduce((sum, p) => sum + p.results.length, 0) +
        medications.length +
        diagnoses.length +
        vitalSets.reduce((sum, v) => sum + v.vitals.length, 0) +
        imagingFindings.length +
        procedures.length;

      // Count low confidence
      const lowConfidenceCount =
        labPanels.reduce((sum, p) => sum + p.results.filter((r) => r.confidence < 0.7).length, 0) +
        medications.filter((m) => m.confidence < 0.7).length +
        diagnoses.filter((d) => d.confidence < 0.7).length +
        imagingFindings.filter((f) => f.confidence < 0.7).length;

      const processingTimeMs = Math.round(performance.now() - startTime);

      return {
        documentId: document.id,
        labPanels,
        medications,
        diagnoses,
        vitalSets,
        imagingFindings,
        procedures,
        labTrends,
        extractionCount,
        lowConfidenceCount,
        processingTimeMs,
      } satisfies ExtractionResult;
    });
  };

  /**
   * Extract from multiple documents
   */
  readonly extractBatch = (
    documents: ExtractionDocumentInput[],
    configOverrides?: Partial<ExtractionConfig>
  ) => {
    return Effect.gen(this, function* (_) {
      const results: ExtractionResult[] = [];

      for (const doc of documents) {
        const result = yield* _(this.extractAll(doc, configOverrides));
        results.push(result);
      }

      return results;
    });
  };
}

// ============================================================================
// SERVICE LAYER
// ============================================================================

export const StructuredExtractionServiceLive = Layer.succeed(
  StructuredExtractionService,
  new StructuredExtractionServiceImpl()
);

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Extract all data from a document (standalone)
 */
export const extractFromDocument = async (
  document: ExtractionDocumentInput,
  config?: Partial<ExtractionConfig>
): Promise<ExtractionResult> => {
  const program = Effect.gen(function* (_) {
    const service = yield* _(StructuredExtractionService);
    return yield* _(service.extractAll(document, config));
  }).pipe(Effect.provide(StructuredExtractionServiceLive));

  return Effect.runPromise(program);
};

/**
 * Get extraction summary
 */
export const getExtractionSummary = (result: ExtractionResult) => {
  return {
    documentId: result.documentId,
    labCount: result.labPanels.reduce((sum, p) => sum + p.results.length, 0),
    medicationCount: result.medications.length,
    diagnosisCount: result.diagnoses.length,
    vitalCount: result.vitalSets.reduce((sum, v) => sum + v.vitals.length, 0),
    imagingCount: result.imagingFindings.length,
    totalExtractions: result.extractionCount,
    lowConfidencePercent:
      result.extractionCount > 0
        ? ((result.lowConfidenceCount / result.extractionCount) * 100).toFixed(1) + "%"
        : "0%",
    processingTime: result.processingTimeMs + "ms",
  };
};
