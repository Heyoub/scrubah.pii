/**
 * NARRATIVE GENERATION SCHEMA
 *
 * Generates concise clinical summaries from extracted structured data.
 * Combines:
 * - Template-stripped unique content
 * - Structured extractions (labs, meds, diagnoses)
 * - Temporal organization
 *
 * Design principles:
 * - Templated generation (not free-form LLM generation)
 * - Deterministic output for same input
 * - Configurable verbosity levels
 * - Preserves clinical accuracy
 */

import { Schema as S } from "effect";

// ============================================================================
// GENERATION CONFIGURATION
// ============================================================================

export const VerbosityLevelSchema = S.Union(
  S.Literal("MINIMAL"), // One-line summary per section
  S.Literal("BRIEF"), // Key findings only
  S.Literal("STANDARD"), // Normal clinical summary
  S.Literal("DETAILED") // Comprehensive narrative
);
export type VerbosityLevel = S.Schema.Type<typeof VerbosityLevelSchema>;

export const NarrativeConfigSchema = S.Struct({
  verbosity: VerbosityLevelSchema,

  // Section inclusion
  includeDemographics: S.Boolean,
  includeDiagnoses: S.Boolean,
  includeMedications: S.Boolean,
  includeLabSummary: S.Boolean,
  includeVitals: S.Boolean,
  includeImaging: S.Boolean,
  includeProcedures: S.Boolean,
  includeTrends: S.Boolean,

  // Formatting
  useBulletPoints: S.Boolean,
  useAbbreviations: S.Boolean,
  includeUnits: S.Boolean,
  highlightAbnormal: S.Boolean,

  // Length limits
  maxSummaryLength: S.Int, // characters
  maxSectionLength: S.Int,
});
export type NarrativeConfig = S.Schema.Type<typeof NarrativeConfigSchema>;

export const defaultNarrativeConfig: NarrativeConfig = {
  verbosity: "STANDARD",
  includeDemographics: true,
  includeDiagnoses: true,
  includeMedications: true,
  includeLabSummary: true,
  includeVitals: true,
  includeImaging: true,
  includeProcedures: true,
  includeTrends: true,
  useBulletPoints: true,
  useAbbreviations: true,
  includeUnits: true,
  highlightAbnormal: true,
  maxSummaryLength: 5000,
  maxSectionLength: 1000,
};

// ============================================================================
// NARRATIVE SECTION
// ============================================================================

export const SectionTypeSchema = S.Union(
  S.Literal("HEADER"),
  S.Literal("DEMOGRAPHICS"),
  S.Literal("CHIEF_COMPLAINT"),
  S.Literal("DIAGNOSES"),
  S.Literal("MEDICATIONS"),
  S.Literal("LABS"),
  S.Literal("VITALS"),
  S.Literal("IMAGING"),
  S.Literal("PROCEDURES"),
  S.Literal("TRENDS"),
  S.Literal("SUMMARY"),
  S.Literal("CUSTOM")
);
export type SectionType = S.Schema.Type<typeof SectionTypeSchema>;

export const NarrativeSectionSchema = S.Struct({
  type: SectionTypeSchema,
  title: S.String,
  content: S.String,
  charCount: S.Int,
  itemCount: S.Int, // number of items summarized (meds, labs, etc.)
  hasAbnormal: S.Boolean,
});
export type NarrativeSection = S.Schema.Type<typeof NarrativeSectionSchema>;

// ============================================================================
// NARRATIVE RESULT
// ============================================================================

export const NarrativeResultSchema = S.Struct({
  documentId: S.String,

  // Generated narrative
  sections: S.Array(NarrativeSectionSchema),
  fullNarrative: S.String,

  // Compression metrics
  inputCharCount: S.Int,
  outputCharCount: S.Int,
  compressionRatio: S.Number, // 1 - (output/input)

  // Content summary
  diagnosisCount: S.Int,
  medicationCount: S.Int,
  labCount: S.Int,
  abnormalLabCount: S.Int,
  imagingCount: S.Int,

  // Processing metadata
  configUsed: NarrativeConfigSchema,
  processingTimeMs: S.Int,
});
export type NarrativeResult = S.Schema.Type<typeof NarrativeResultSchema>;

// ============================================================================
// SECTION TEMPLATES
// ============================================================================

/**
 * Template for generating diagnosis summary
 */
export const formatDiagnosesSummary = (
  diagnoses: Array<{
    description: string;
    type: string;
    icdCode?: string;
    status?: string;
  }>,
  config: Pick<NarrativeConfig, "verbosity" | "useBulletPoints">
): string => {
  if (diagnoses.length === 0) return "";

  const primary = diagnoses.find((d) => d.type === "PRIMARY");
  const secondary = diagnoses.filter((d) => d.type !== "PRIMARY");

  const lines: string[] = [];

  if (config.verbosity === "MINIMAL") {
    const all = diagnoses.map((d) => d.description).join(", ");
    return all.slice(0, 100) + (all.length > 100 ? "..." : "");
  }

  if (primary) {
    const icdStr = primary.icdCode ? ` (${primary.icdCode})` : "";
    lines.push(`Primary: ${primary.description}${icdStr}`);
  }

  if (secondary.length > 0) {
    if (config.verbosity === "BRIEF") {
      lines.push(`Secondary: ${secondary.length} additional diagnoses`);
    } else {
      const prefix = config.useBulletPoints ? "• " : "- ";
      secondary.forEach((d) => {
        const icdStr = d.icdCode ? ` (${d.icdCode})` : "";
        lines.push(`${prefix}${d.description}${icdStr}`);
      });
    }
  }

  return lines.join("\n");
};

/**
 * Template for generating medication summary
 */
export const formatMedicationsSummary = (
  medications: Array<{
    name: string;
    dose?: string;
    route: string;
    frequency: string;
    status?: string;
  }>,
  config: Pick<NarrativeConfig, "verbosity" | "useBulletPoints" | "useAbbreviations">
): string => {
  if (medications.length === 0) return "";

  const active = medications.filter((m) => m.status !== "DISCONTINUED");

  if (config.verbosity === "MINIMAL") {
    return `${active.length} active medications`;
  }

  const lines: string[] = [];
  const prefix = config.useBulletPoints ? "• " : "- ";

  active.forEach((med) => {
    const parts = [med.name];
    if (med.dose) parts.push(med.dose);
    if (med.route && med.route !== "UNKNOWN" && config.useAbbreviations) {
      parts.push(med.route);
    }
    if (med.frequency && med.frequency !== "UNKNOWN") {
      parts.push(med.frequency);
    }
    lines.push(`${prefix}${parts.join(" ")}`);
  });

  if (config.verbosity === "BRIEF" && lines.length > 5) {
    return lines.slice(0, 5).join("\n") + `\n... and ${lines.length - 5} more`;
  }

  return lines.join("\n");
};

/**
 * Template for generating lab summary
 */
export const formatLabsSummary = (
  labs: Array<{
    testName: string;
    value: number;
    unit: string;
    status: string;
  }>,
  config: Pick<
    NarrativeConfig,
    "verbosity" | "useBulletPoints" | "includeUnits" | "highlightAbnormal"
  >
): string => {
  if (labs.length === 0) return "";

  const abnormal = labs.filter(
    (l) => l.status !== "NORMAL" && l.status !== "UNKNOWN"
  );
  const normal = labs.filter(
    (l) => l.status === "NORMAL" || l.status === "UNKNOWN"
  );

  if (config.verbosity === "MINIMAL") {
    if (abnormal.length === 0) return "Labs WNL";
    return `${abnormal.length} abnormal lab(s)`;
  }

  const lines: string[] = [];
  const prefix = config.useBulletPoints ? "• " : "- ";

  // Always show abnormal labs
  abnormal.forEach((lab) => {
    const unit = config.includeUnits ? ` ${lab.unit}` : "";
    const flag =
      config.highlightAbnormal && lab.status.includes("CRITICAL")
        ? " ⚠️"
        : lab.status.includes("HIGH")
          ? " (H)"
          : lab.status.includes("LOW")
            ? " (L)"
            : "";
    lines.push(`${prefix}${lab.testName}: ${lab.value}${unit}${flag}`);
  });

  // Show normal labs based on verbosity
  if (config.verbosity === "DETAILED") {
    normal.forEach((lab) => {
      const unit = config.includeUnits ? ` ${lab.unit}` : "";
      lines.push(`${prefix}${lab.testName}: ${lab.value}${unit}`);
    });
  } else if (config.verbosity === "STANDARD" && normal.length > 0) {
    lines.push(`${normal.length} other labs within normal limits`);
  }

  return lines.join("\n");
};

/**
 * Template for generating vitals summary
 */
export const formatVitalsSummary = (
  vitals: Array<{
    type: string;
    value: number;
    unit: string;
    status?: string;
  }>,
  config: Pick<NarrativeConfig, "verbosity" | "useAbbreviations" | "includeUnits">
): string => {
  if (vitals.length === 0) return "";

  // Group related vitals (BP systolic/diastolic)
  const bpSys = vitals.find((v) => v.type === "BP_SYSTOLIC");
  const bpDia = vitals.find((v) => v.type === "BP_DIASTOLIC");
  const hr = vitals.find((v) => v.type === "HEART_RATE");
  const rr = vitals.find((v) => v.type === "RESPIRATORY_RATE");
  const temp = vitals.find((v) => v.type === "TEMPERATURE");
  const spo2 = vitals.find((v) => v.type === "SPO2");

  const parts: string[] = [];

  if (bpSys && bpDia) {
    parts.push(config.useAbbreviations ? `BP ${bpSys.value}/${bpDia.value}` : `Blood Pressure ${bpSys.value}/${bpDia.value} mmHg`);
  }
  if (hr) {
    parts.push(config.useAbbreviations ? `HR ${hr.value}` : `Heart Rate ${hr.value} bpm`);
  }
  if (rr) {
    parts.push(config.useAbbreviations ? `RR ${rr.value}` : `Respiratory Rate ${rr.value}/min`);
  }
  if (temp) {
    const tempUnit = config.includeUnits ? "°F" : "";
    parts.push(config.useAbbreviations ? `T ${temp.value}${tempUnit}` : `Temperature ${temp.value}${tempUnit}`);
  }
  if (spo2) {
    parts.push(config.useAbbreviations ? `SpO2 ${spo2.value}%` : `Oxygen Saturation ${spo2.value}%`);
  }

  if (config.verbosity === "MINIMAL") {
    return parts.slice(0, 3).join(", ");
  }

  return parts.join(", ");
};

/**
 * Template for generating imaging summary
 */
export const formatImagingSummary = (
  findings: Array<{
    modality: string;
    bodyPart: string;
    finding: string;
    isAbnormal: boolean;
    impression?: string;
  }>,
  config: Pick<NarrativeConfig, "verbosity" | "useBulletPoints" | "highlightAbnormal">
): string => {
  if (findings.length === 0) return "";

  const abnormal = findings.filter((f) => f.isAbnormal);

  if (config.verbosity === "MINIMAL") {
    if (abnormal.length === 0) return `${findings.length} imaging study(ies), unremarkable`;
    return `${abnormal.length} abnormal imaging finding(s)`;
  }

  const lines: string[] = [];
  const prefix = config.useBulletPoints ? "• " : "- ";

  findings.forEach((f) => {
    const flag = config.highlightAbnormal && f.isAbnormal ? " ⚠️" : "";
    if (config.verbosity === "BRIEF") {
      lines.push(`${prefix}${f.modality} ${f.bodyPart}: ${f.isAbnormal ? "Abnormal" : "Normal"}${flag}`);
    } else {
      const content = f.impression || f.finding;
      lines.push(`${prefix}${f.modality} ${f.bodyPart}: ${content}${flag}`);
    }
  });

  return lines.join("\n");
};

/**
 * Template for generating trend summary
 */
export const formatTrendsSummary = (
  trends: Array<{
    testName: string;
    trend: string;
    values: Array<{ date: string; value: number }>;
    clinicalSignificance?: string;
  }>,
  config: Pick<NarrativeConfig, "verbosity" | "useBulletPoints">
): string => {
  if (trends.length === 0) return "";

  // Filter to meaningful trends
  const meaningful = trends.filter(
    (t) => t.trend !== "STABLE" && t.trend !== "INSUFFICIENT_DATA"
  );

  if (meaningful.length === 0) {
    return config.verbosity === "MINIMAL" ? "" : "No significant lab trends";
  }

  if (config.verbosity === "MINIMAL") {
    return `${meaningful.length} trending lab value(s)`;
  }

  const lines: string[] = [];
  const prefix = config.useBulletPoints ? "• " : "- ";

  meaningful.forEach((t) => {
    const trendWord =
      t.trend === "INCREASING"
        ? "↑ increasing"
        : t.trend === "DECREASING"
          ? "↓ decreasing"
          : "fluctuating";
    lines.push(`${prefix}${t.testName}: ${trendWord}`);
  });

  return lines.join("\n");
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Truncate text to max length with ellipsis
 */
export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
};

/**
 * Calculate compression ratio
 */
export const calculateCompressionRatio = (
  inputLength: number,
  outputLength: number
): number => {
  if (inputLength === 0) return 0;
  return 1 - outputLength / inputLength;
};

/**
 * Section title formatters by verbosity
 */
export const getSectionTitle = (
  type: SectionType,
  verbosity: VerbosityLevel
): string => {
  const titles: Record<SectionType, Record<VerbosityLevel, string>> = {
    HEADER: { MINIMAL: "", BRIEF: "", STANDARD: "", DETAILED: "" },
    DEMOGRAPHICS: {
      MINIMAL: "Pt",
      BRIEF: "Patient",
      STANDARD: "Patient Information",
      DETAILED: "Patient Demographics",
    },
    CHIEF_COMPLAINT: {
      MINIMAL: "CC",
      BRIEF: "CC",
      STANDARD: "Chief Complaint",
      DETAILED: "Chief Complaint",
    },
    DIAGNOSES: {
      MINIMAL: "Dx",
      BRIEF: "Diagnoses",
      STANDARD: "Diagnoses",
      DETAILED: "Diagnosis List",
    },
    MEDICATIONS: {
      MINIMAL: "Meds",
      BRIEF: "Medications",
      STANDARD: "Medications",
      DETAILED: "Medication List",
    },
    LABS: {
      MINIMAL: "Labs",
      BRIEF: "Labs",
      STANDARD: "Laboratory Results",
      DETAILED: "Laboratory Results",
    },
    VITALS: {
      MINIMAL: "VS",
      BRIEF: "Vitals",
      STANDARD: "Vital Signs",
      DETAILED: "Vital Signs",
    },
    IMAGING: {
      MINIMAL: "Img",
      BRIEF: "Imaging",
      STANDARD: "Imaging",
      DETAILED: "Imaging Studies",
    },
    PROCEDURES: {
      MINIMAL: "Proc",
      BRIEF: "Procedures",
      STANDARD: "Procedures",
      DETAILED: "Procedures Performed",
    },
    TRENDS: {
      MINIMAL: "Trends",
      BRIEF: "Trends",
      STANDARD: "Lab Trends",
      DETAILED: "Laboratory Trends",
    },
    SUMMARY: {
      MINIMAL: "Sum",
      BRIEF: "Summary",
      STANDARD: "Summary",
      DETAILED: "Clinical Summary",
    },
    CUSTOM: { MINIMAL: "", BRIEF: "", STANDARD: "", DETAILED: "" },
  };

  return titles[type][verbosity];
};
