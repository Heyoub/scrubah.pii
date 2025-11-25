/**
 * MEDICAL TIMELINE FORMATTER - EFFECT VERSION
 * 
 * Converts ExtractedMedicalRecord[] → Clean Markdown Timeline
 * 
 * This is the OUTPUT stage - all PII should already be excluded
 * via the whitelist extraction approach.
 */

import { Effect, pipe, Array as A } from "effect";
import type {
  ExtractedMedicalRecord,
  MedicalTimeline,
  MedicalTimelineEntry,
  LabResult,
  LabPanel,
  Diagnosis,
  Medication,
  ImagingFinding,
  VitalSigns,
  PathologyResult,
  LabStatus,
} from "../../../schemas/index";

// ============================================================================
// STATUS EMOJI MAPPING
// ============================================================================

const LAB_STATUS_EMOJI: Record<LabStatus, string> = {
  normal: "✅",
  low: "⬇️",
  high: "⬆️",
  critical: "🚨",
  abnormal: "⚠️",
  unknown: "❓",
};

const DOC_TYPE_EMOJI: Record<string, string> = {
  lab_report: "🧪",
  imaging: "🔬",
  pathology: "🔬",
  discharge_summary: "🏠",
  progress_note: "📝",
  medication_list: "💊",
  procedure_note: "🏥",
  consultation: "👨‍⚕️",
  unknown: "📄",
};

// ============================================================================
// LAB RESULT FORMATTING
// ============================================================================

const formatLabTable = (panel: LabPanel): string => {
  if (panel.results.length === 0) return "";
  
  const lines: string[] = [
    `**Collection Date**: ${panel.collectionDate}`,
    "",
    "| Test | Value | Reference | Status |",
    "|------|-------|-----------|--------|",
  ];
  
  for (const result of panel.results) {
    const status = result.status || "unknown";
    const emoji = LAB_STATUS_EMOJI[status];
    const ref = result.referenceRange || "—";
    const unit = result.unit ? ` ${result.unit}` : "";
    
    lines.push(
      `| ${result.testName} | ${result.value}${unit} | ${ref} | ${emoji} ${status} |`
    );
  }
  
  return lines.join("\n");
};

const formatLabTrends = (
  currentPanel: LabPanel,
  previousPanel: LabPanel | undefined
): string => {
  if (!previousPanel) return "";
  
  const trends: string[] = [];
  
  for (const current of currentPanel.results) {
    const previous = previousPanel.results.find(r => r.testName === current.testName);
    if (previous) {
      const currentVal = parseFloat(current.value);
      const prevVal = parseFloat(previous.value);
      
      if (!isNaN(currentVal) && !isNaN(prevVal) && prevVal !== 0) {
        const change = ((currentVal - prevVal) / prevVal) * 100;
        if (Math.abs(change) > 5) {
          const arrow = change > 0 ? "↑" : "↓";
          trends.push(
            `- ${current.testName}: ${previous.value} → ${current.value} (${arrow} ${Math.abs(change).toFixed(1)}%)`
          );
        }
      }
    }
  }
  
  if (trends.length === 0) return "";
  
  return [
    "",
    "#### Trends vs Previous",
    ...trends,
  ].join("\n");
};

// ============================================================================
// DIAGNOSIS FORMATTING
// ============================================================================

const formatDiagnoses = (diagnoses: readonly Diagnosis[]): string => {
  if (diagnoses.length === 0) return "";
  
  const lines: string[] = [
    "#### Diagnoses",
    "",
  ];
  
  for (const dx of diagnoses) {
    const parts: string[] = [`- **${dx.condition}**`];
    if (dx.icdCode) parts.push(`(${dx.icdCode})`);
    if (dx.severity && dx.severity !== "unspecified") parts.push(`— ${dx.severity}`);
    if (dx.status) parts.push(`[${dx.status}]`);
    lines.push(parts.join(" "));
  }
  
  return lines.join("\n");
};

// ============================================================================
// MEDICATION FORMATTING
// ============================================================================

const formatMedications = (medications: readonly Medication[]): string => {
  if (medications.length === 0) return "";
  
  const lines: string[] = [
    "#### Medications",
    "",
  ];
  
  for (const med of medications) {
    const parts: string[] = [`- **${med.name}**`];
    if (med.dose && med.unit) parts.push(`${med.dose} ${med.unit}`);
    if (med.route) parts.push(`(${med.route})`);
    if (med.frequency) parts.push(`— ${med.frequency}`);
    lines.push(parts.join(" "));
  }
  
  return lines.join("\n");
};

// ============================================================================
// IMAGING FORMATTING
// ============================================================================

const formatImagingFindings = (findings: readonly ImagingFinding[]): string => {
  if (findings.length === 0) return "";
  
  const lines: string[] = [];
  
  for (const finding of findings) {
    lines.push(
      `#### ${finding.modality.toUpperCase()} — ${finding.bodyPart}`,
      ""
    );
    
    if (finding.findings.length > 0) {
      lines.push("**Findings:**");
      for (const f of finding.findings) {
        lines.push(`- ${f}`);
      }
      lines.push("");
    }
    
    if (finding.impression) {
      lines.push(`**Impression:** ${finding.impression}`, "");
    }
  }
  
  return lines.join("\n");
};

// ============================================================================
// VITAL SIGNS FORMATTING
// ============================================================================

const formatVitalSigns = (vitals: readonly VitalSigns[]): string => {
  if (vitals.length === 0) return "";
  
  const v = vitals[0]; // Usually one set per encounter
  const parts: string[] = [];
  
  if (v.bloodPressureSystolic && v.bloodPressureDiastolic) {
    parts.push(`BP: ${v.bloodPressureSystolic}/${v.bloodPressureDiastolic}`);
  }
  if (v.heartRate) parts.push(`HR: ${v.heartRate}`);
  if (v.respiratoryRate) parts.push(`RR: ${v.respiratoryRate}`);
  if (v.temperature) {
    parts.push(`Temp: ${v.temperature}°${v.temperatureUnit || "F"}`);
  }
  if (v.oxygenSaturation) parts.push(`SpO2: ${v.oxygenSaturation}%`);
  if (v.painScale !== undefined) parts.push(`Pain: ${v.painScale}/10`);
  
  if (parts.length === 0) return "";
  
  return [
    "#### Vital Signs",
    "",
    parts.join(" | "),
    "",
  ].join("\n");
};

// ============================================================================
// PATHOLOGY FORMATTING
// ============================================================================

const formatPathology = (results: readonly PathologyResult[]): string => {
  if (results.length === 0) return "";
  
  const lines: string[] = [
    "#### Pathology",
    "",
  ];
  
  for (const result of results) {
    lines.push(`**Specimen:** ${result.specimenType}`);
    lines.push(`**Diagnosis:** ${result.diagnosis}`);
    if (result.grade) lines.push(`**Grade:** ${result.grade}`);
    if (result.stage) lines.push(`**Stage:** ${result.stage}`);
    if (result.margins) lines.push(`**Margins:** ${result.margins}`);
    lines.push("");
  }
  
  return lines.join("\n");
};

// ============================================================================
// SINGLE DOCUMENT FORMATTING
// ============================================================================

const formatDocument = (
  record: ExtractedMedicalRecord,
  index: number,
  previousLabPanel: LabPanel | undefined
): string => {
  const emoji = DOC_TYPE_EMOJI[record.documentType] || "📄";
  const date = record.documentDate || "Unknown Date";
  
  const sections: string[] = [
    `### ${emoji} ${date} | ${record.documentType.replace(/_/g, " ").toUpperCase()}`,
    `**Document #${index + 1}** | Hash: \`${record.sourceDocumentHash.substring(0, 8)}\` | Confidence: ${record.extractionConfidence}%`,
    "",
  ];
  
  // Add vital signs if present
  const vitalsSection = formatVitalSigns(record.vitalSigns);
  if (vitalsSection) sections.push(vitalsSection);
  
  // Add diagnoses if present
  const dxSection = formatDiagnoses(record.diagnoses);
  if (dxSection) sections.push(dxSection, "");
  
  // Add lab results if present
  for (const panel of record.labPanels) {
    sections.push(formatLabTable(panel));
    sections.push(formatLabTrends(panel, previousLabPanel));
    sections.push("");
  }
  
  // Add medications if present
  const medsSection = formatMedications(record.medications);
  if (medsSection) sections.push(medsSection, "");
  
  // Add imaging findings if present
  const imagingSection = formatImagingFindings(record.imagingFindings);
  if (imagingSection) sections.push(imagingSection);
  
  // Add pathology if present
  const pathSection = formatPathology(record.pathology);
  if (pathSection) sections.push(pathSection);
  
  // Add warnings if any
  if (record.warnings.length > 0) {
    sections.push(
      "",
      "> ⚠️ **Extraction Warnings:**",
      ...record.warnings.map(w => `> - ${w}`),
    );
  }
  
  sections.push("", "---", "");
  
  return sections.join("\n");
};

// ============================================================================
// SUMMARY STATISTICS
// ============================================================================

interface TimelineSummary {
  dateRange: { earliest: string; latest: string };
  totalDocuments: number;
  byType: Record<string, number>;
  totalDiagnoses: number;
  totalLabPanels: number;
  totalMedications: number;
  activeMedications: Medication[];
  activeDiagnoses: Diagnosis[];
}

const calculateSummary = (records: ExtractedMedicalRecord[]): TimelineSummary => {
  const dates = records
    .map(r => r.documentDate)
    .filter((d): d is string => d !== undefined)
    .sort();
  
  const byType: Record<string, number> = {};
  let totalDiagnoses = 0;
  let totalLabPanels = 0;
  let totalMedications = 0;
  const allMedications: Medication[] = [];
  const allDiagnoses: Diagnosis[] = [];
  
  for (const record of records) {
    byType[record.documentType] = (byType[record.documentType] || 0) + 1;
    totalDiagnoses += record.diagnoses.length;
    totalLabPanels += record.labPanels.length;
    totalMedications += record.medications.length;
    allMedications.push(...record.medications);
    allDiagnoses.push(...record.diagnoses);
  }
  
  // Deduplicate active medications
  const seenMeds = new Set<string>();
  const activeMedications = allMedications.filter(m => {
    const key = m.name.toLowerCase();
    if (seenMeds.has(key)) return false;
    seenMeds.add(key);
    return m.status === "active";
  });
  
  // Deduplicate active diagnoses
  const seenDx = new Set<string>();
  const activeDiagnoses = allDiagnoses.filter(d => {
    const key = d.condition.toLowerCase();
    if (seenDx.has(key)) return false;
    seenDx.add(key);
    return d.status === "active";
  });
  
  return {
    dateRange: {
      earliest: dates[0] || "Unknown",
      latest: dates[dates.length - 1] || "Unknown",
    },
    totalDocuments: records.length,
    byType,
    totalDiagnoses,
    totalLabPanels,
    totalMedications,
    activeMedications,
    activeDiagnoses,
  };
};

const formatSummary = (summary: TimelineSummary): string => {
  const lines: string[] = [
    "## 📊 Summary Statistics",
    "",
    `- **Date Range**: ${summary.dateRange.earliest} → ${summary.dateRange.latest}`,
    `- **Total Documents**: ${summary.totalDocuments}`,
    "- **Document Types**:",
  ];
  
  for (const [type, count] of Object.entries(summary.byType)) {
    const emoji = DOC_TYPE_EMOJI[type] || "📄";
    lines.push(`  - ${emoji} ${type.replace(/_/g, " ")}: ${count}`);
  }
  
  lines.push(
    "",
    "### 🎯 Active Diagnoses",
    "",
  );
  
  if (summary.activeDiagnoses.length > 0) {
    for (const dx of summary.activeDiagnoses) {
      lines.push(`- ${dx.condition}${dx.severity !== "unspecified" ? ` (${dx.severity})` : ""}`);
    }
  } else {
    lines.push("_No active diagnoses extracted_");
  }
  
  lines.push(
    "",
    "### 💊 Current Medications",
    "",
  );
  
  if (summary.activeMedications.length > 0) {
    for (const med of summary.activeMedications) {
      const dose = med.dose && med.unit ? ` ${med.dose} ${med.unit}` : "";
      const freq = med.frequency ? ` — ${med.frequency}` : "";
      lines.push(`- ${med.name}${dose}${freq}`);
    }
  } else {
    lines.push("_No active medications extracted_");
  }
  
  lines.push("", "---", "");
  
  return lines.join("\n");
};

// ============================================================================
// MAIN TIMELINE FORMATTER
// ============================================================================

export interface FormatTimelineInput {
  records: ExtractedMedicalRecord[];
  title?: string;
}

export const formatMedicalTimeline = (
  input: FormatTimelineInput
): Effect.Effect<string, never, never> => {
  return Effect.sync(() => {
    const { records, title = "Medical Record Timeline" } = input;
    
    // Sort by date (oldest first)
    const sorted = [...records].sort((a, b) => {
      const dateA = a.documentDate || "9999";
      const dateB = b.documentDate || "9999";
      return dateA.localeCompare(dateB);
    });
    
    // Build header
    const header = [
      `# 🏥 ${title}`,
      "",
      "_Extracted using whitelist approach — only clinical data, no PII_",
      "",
      `_Generated: ${new Date().toISOString().split("T")[0]}_`,
      "",
    ].join("\n");
    
    // Build summary
    const summary = calculateSummary(sorted);
    const summarySection = formatSummary(summary);
    
    // Build timeline
    const timelineHeader = [
      "## 📅 Chronological Timeline",
      "",
      "_Documents ordered oldest → newest_",
      "",
    ].join("\n");
    
    // Track previous lab panel for trends
    let previousLabPanel: LabPanel | undefined;
    
    const documentSections = sorted.map((record, index) => {
      const section = formatDocument(record, index, previousLabPanel);
      
      // Update previous lab panel for next iteration
      if (record.labPanels.length > 0) {
        previousLabPanel = record.labPanels[record.labPanels.length - 1];
      }
      
      return section;
    });
    
    // Build footer
    const footer = [
      "",
      "---",
      "",
      "_This timeline was generated using whitelist extraction. Only structured clinical data_",
      "_was extracted — names, addresses, phone numbers, and other PII were never captured._",
      "",
      `_Scrubah.PII Medical Extractor v2.0 — ${new Date().toISOString()}_`,
    ].join("\n");
    
    return [
      header,
      summarySection,
      timelineHeader,
      ...documentSections,
      footer,
    ].join("\n");
  });
};

// ============================================================================
// SYNC WRAPPER
// ============================================================================

export const formatMedicalTimelineSync = (input: FormatTimelineInput): string => {
  return Effect.runSync(formatMedicalTimeline(input));
};
