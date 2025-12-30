/**
 * NARRATIVE GENERATION SERVICE - EFFECT-TS
 *
 * Generates clinical summaries from extracted structured data.
 * Uses template-based generation (no ML/LLM) for deterministic output.
 *
 * Design:
 * - Combines structured extractions into readable summaries
 * - Configurable verbosity levels
 * - Preserves clinical accuracy
 * - Deterministic output
 */

import { Effect, Context, Layer } from "effect";
import {
  NarrativeConfig,
  defaultNarrativeConfig,
  NarrativeResult,
  NarrativeSection,
  SectionType,
  formatDiagnosesSummary,
  formatMedicationsSummary,
  formatLabsSummary,
  formatVitalsSummary,
  formatImagingSummary,
  formatTrendsSummary,
  getSectionTitle,
  truncateText,
  calculateCompressionRatio,
} from "../schemas/narrativeGeneration";
import {
  ExtractionResult,
  LabResult,
  Medication,
  Diagnosis,
  VitalSign,
  ImagingFinding,
  LabTrend,
} from "../schemas/structuredExtraction";

// ============================================================================
// SERVICE ERROR TYPE
// ============================================================================

export class NarrativeError extends Error {
  readonly _tag = "NarrativeError";
  constructor(
    readonly message: string,
    readonly documentId?: string
  ) {
    super(message);
  }
}

// ============================================================================
// INPUT TYPES
// ============================================================================

export interface NarrativeInput {
  documentId: string;
  originalText: string; // For compression calculation
  extraction: ExtractionResult;
  trends?: LabTrend[];
}

// ============================================================================
// SERVICE INTERFACE
// ============================================================================

export interface NarrativeGenerationService {
  /**
   * Generate full narrative from extraction result
   */
  readonly generate: (
    input: NarrativeInput,
    config?: Partial<NarrativeConfig>
  ) => Effect.Effect<NarrativeResult, NarrativeError, never>;

  /**
   * Generate specific section only
   */
  readonly generateSection: (
    type: SectionType,
    extraction: ExtractionResult,
    config?: Partial<NarrativeConfig>
  ) => Effect.Effect<NarrativeSection, never, never>;

  /**
   * Generate batch of narratives
   */
  readonly generateBatch: (
    inputs: NarrativeInput[],
    config?: Partial<NarrativeConfig>
  ) => Effect.Effect<NarrativeResult[], NarrativeError, never>;
}

export const NarrativeGenerationService =
  Context.GenericTag<NarrativeGenerationService>("NarrativeGenerationService");

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class NarrativeGenerationServiceImpl implements NarrativeGenerationService {
  /**
   * Generate diagnoses section
   */
  private generateDiagnosesSection = (
    diagnoses: Diagnosis[],
    config: NarrativeConfig
  ): NarrativeSection => {
    const content = formatDiagnosesSummary(
      diagnoses.map((d) => ({
        description: d.description,
        type: d.type,
        icdCode: d.icdCode,
        status: d.status,
      })),
      config
    );

    return {
      type: "DIAGNOSES",
      title: getSectionTitle("DIAGNOSES", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: diagnoses.length,
      hasAbnormal: false, // Diagnoses are inherently "findings"
    };
  };

  /**
   * Generate medications section
   */
  private generateMedicationsSection = (
    medications: Medication[],
    config: NarrativeConfig
  ): NarrativeSection => {
    const content = formatMedicationsSummary(
      medications.map((m) => ({
        name: m.name,
        dose: m.dose,
        route: m.route,
        frequency: m.frequency,
        status: m.status,
      })),
      config
    );

    return {
      type: "MEDICATIONS",
      title: getSectionTitle("MEDICATIONS", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: medications.length,
      hasAbnormal: false,
    };
  };

  /**
   * Generate labs section
   */
  private generateLabsSection = (
    labPanels: ReadonlyArray<{ results: readonly LabResult[] }>,
    config: NarrativeConfig
  ): NarrativeSection => {
    // Flatten all lab results
    const allLabs = labPanels.flatMap((p) => p.results);

    const content = formatLabsSummary(
      allLabs.map((l) => ({
        testName: l.testName,
        value: l.value,
        unit: l.unit,
        status: l.status,
      })),
      config
    );

    const abnormalCount = allLabs.filter(
      (l) => l.status !== "NORMAL" && l.status !== "UNKNOWN"
    ).length;

    return {
      type: "LABS",
      title: getSectionTitle("LABS", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: allLabs.length,
      hasAbnormal: abnormalCount > 0,
    };
  };

  /**
   * Generate vitals section
   */
  private generateVitalsSection = (
    vitalSets: ReadonlyArray<{ vitals: readonly VitalSign[] }>,
    config: NarrativeConfig
  ): NarrativeSection => {
    // Use most recent vital set (or merge all)
    const mostRecent = vitalSets[vitalSets.length - 1]?.vitals || [];

    const content = formatVitalsSummary(
      mostRecent.map((v) => ({
        type: v.type,
        value: v.value,
        unit: v.unit,
        status: v.status,
      })),
      config
    );

    const hasAbnormal = mostRecent.some((v) => v.status === "ABNORMAL" || v.status === "CRITICAL");

    return {
      type: "VITALS",
      title: getSectionTitle("VITALS", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: mostRecent.length,
      hasAbnormal,
    };
  };

  /**
   * Generate imaging section
   */
  private generateImagingSection = (
    findings: ImagingFinding[],
    config: NarrativeConfig
  ): NarrativeSection => {
    const content = formatImagingSummary(
      findings.map((f) => ({
        modality: f.modality,
        bodyPart: f.bodyPart,
        finding: f.finding,
        isAbnormal: f.isAbnormal,
        impression: f.impression,
      })),
      config
    );

    return {
      type: "IMAGING",
      title: getSectionTitle("IMAGING", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: findings.length,
      hasAbnormal: findings.some((f) => f.isAbnormal),
    };
  };

  /**
   * Generate trends section
   */
  private generateTrendsSection = (
    trends: LabTrend[],
    config: NarrativeConfig
  ): NarrativeSection => {
    const content = formatTrendsSummary(
      trends.map((t) => ({
        testName: t.testName,
        trend: t.trend,
        values: [...t.values],
        clinicalSignificance: t.clinicalSignificance,
      })),
      config
    );

    return {
      type: "TRENDS",
      title: getSectionTitle("TRENDS", config.verbosity),
      content: truncateText(content, config.maxSectionLength),
      charCount: content.length,
      itemCount: trends.length,
      hasAbnormal: trends.some((t) => t.trend === "INCREASING" || t.trend === "DECREASING"),
    };
  };

  /**
   * Generate a specific section
   */
  readonly generateSection = (
    type: SectionType,
    extraction: ExtractionResult,
    configOverrides?: Partial<NarrativeConfig>
  ) => {
    return Effect.sync(() => {
      const config = { ...defaultNarrativeConfig, ...configOverrides };

      switch (type) {
        case "DIAGNOSES":
          return this.generateDiagnosesSection([...extraction.diagnoses], config);
        case "MEDICATIONS":
          return this.generateMedicationsSection([...extraction.medications], config);
        case "LABS":
          return this.generateLabsSection([...extraction.labPanels], config);
        case "VITALS":
          return this.generateVitalsSection([...extraction.vitalSets], config);
        case "IMAGING":
          return this.generateImagingSection([...extraction.imagingFindings], config);
        case "TRENDS":
          return this.generateTrendsSection([...(extraction.labTrends || [])], config);
        default:
          return {
            type,
            title: "",
            content: "",
            charCount: 0,
            itemCount: 0,
            hasAbnormal: false,
          };
      }
    });
  };

  /**
   * Generate full narrative
   */
  readonly generate = (
    input: NarrativeInput,
    configOverrides?: Partial<NarrativeConfig>
  ) => {
    return Effect.gen(this, function* () {
      const startTime = Date.now();
      const config = { ...defaultNarrativeConfig, ...configOverrides };
      const sections: NarrativeSection[] = [];

      // Generate each section based on config (spread readonly arrays for mutable use)
      if (config.includeDiagnoses && input.extraction.diagnoses.length > 0) {
        sections.push(this.generateDiagnosesSection([...input.extraction.diagnoses], config));
      }

      if (config.includeMedications && input.extraction.medications.length > 0) {
        sections.push(this.generateMedicationsSection([...input.extraction.medications], config));
      }

      if (config.includeLabSummary && input.extraction.labPanels.length > 0) {
        sections.push(this.generateLabsSection([...input.extraction.labPanels], config));
      }

      if (config.includeVitals && input.extraction.vitalSets.length > 0) {
        sections.push(this.generateVitalsSection([...input.extraction.vitalSets], config));
      }

      if (config.includeImaging && input.extraction.imagingFindings.length > 0) {
        sections.push(this.generateImagingSection([...input.extraction.imagingFindings], config));
      }

      if (config.includeTrends && input.trends && input.trends.length > 0) {
        sections.push(this.generateTrendsSection([...input.trends], config));
      }

      // Combine sections into full narrative
      const fullNarrative = sections
        .filter((s) => s.content.length > 0)
        .map((s) => {
          if (s.title) {
            return `${s.title}:\n${s.content}`;
          }
          return s.content;
        })
        .join("\n\n");

      // Calculate metrics
      const inputCharCount = input.originalText.length;
      const outputCharCount = fullNarrative.length;
      const compressionRatio = calculateCompressionRatio(inputCharCount, outputCharCount);

      // Count items
      const allLabs = input.extraction.labPanels.flatMap((p) => p.results);
      const abnormalLabCount = allLabs.filter(
        (l) => l.status !== "NORMAL" && l.status !== "UNKNOWN"
      ).length;

      return {
        documentId: input.documentId,
        sections,
        fullNarrative: truncateText(fullNarrative, config.maxSummaryLength),
        inputCharCount,
        outputCharCount,
        compressionRatio,
        diagnosisCount: input.extraction.diagnoses.length,
        medicationCount: input.extraction.medications.length,
        labCount: allLabs.length,
        abnormalLabCount,
        imagingCount: input.extraction.imagingFindings.length,
        configUsed: config,
        processingTimeMs: Date.now() - startTime,
      };
    });
  };

  /**
   * Generate batch of narratives
   */
  readonly generateBatch = (
    inputs: NarrativeInput[],
    configOverrides?: Partial<NarrativeConfig>
  ) => {
    return Effect.all(
      inputs.map((input) => this.generate(input, configOverrides)),
      { concurrency: 10 }
    );
  };
}

// ============================================================================
// LAYER
// ============================================================================

export const NarrativeGenerationServiceLive = Layer.succeed(
  NarrativeGenerationService,
  new NarrativeGenerationServiceImpl()
);
