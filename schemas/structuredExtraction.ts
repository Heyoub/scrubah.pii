/**
 * STRUCTURED EXTRACTION SCHEMA
 *
 * Extracts structured clinical data from medical documents:
 * - Laboratory results with values, units, reference ranges
 * - Medications with dose, route, frequency
 * - Diagnoses and problem lists
 * - Vital signs
 * - Imaging findings
 *
 * Design principles:
 * - Generalized patterns (not specific to any institution)
 * - Regex-based extraction with confidence scoring
 * - Temporal grouping for trends
 * - Safe defaults (mark uncertain extractions)
 */

import { Schema as S } from "effect";

// ============================================================================
// EXTRACTION CONFIGURATION
// ============================================================================

export const ExtractionConfigSchema = S.Struct({
  // What to extract
  extractLabs: S.Boolean,
  extractMedications: S.Boolean,
  extractDiagnoses: S.Boolean,
  extractVitals: S.Boolean,
  extractImaging: S.Boolean,
  extractProcedures: S.Boolean,

  // Confidence thresholds
  minConfidence: S.Number, // 0-1, skip extractions below this
  flagLowConfidence: S.Boolean, // mark uncertain extractions

  // Temporal settings
  groupByEncounter: S.Boolean, // group related data by date
  detectTrends: S.Boolean, // analyze lab trends over time

  // Output format
  includeSourceText: S.Boolean, // include original text snippets
  normalizeUnits: S.Boolean, // convert to standard units
});
export type ExtractionConfig = S.Schema.Type<typeof ExtractionConfigSchema>;

export const defaultExtractionConfig: ExtractionConfig = {
  extractLabs: true,
  extractMedications: true,
  extractDiagnoses: true,
  extractVitals: true,
  extractImaging: true,
  extractProcedures: true,
  minConfidence: 0.5,
  flagLowConfidence: true,
  groupByEncounter: true,
  detectTrends: true,
  includeSourceText: false,
  normalizeUnits: true,
};

// ============================================================================
// LAB RESULT
// ============================================================================

export const LabStatusSchema = S.Union(
  S.Literal("NORMAL"),
  S.Literal("HIGH"),
  S.Literal("LOW"),
  S.Literal("CRITICAL_HIGH"),
  S.Literal("CRITICAL_LOW"),
  S.Literal("UNKNOWN")
);
export type LabStatus = S.Schema.Type<typeof LabStatusSchema>;

export const LabResultSchema = S.Struct({
  testName: S.String, // e.g., "WBC", "Hemoglobin"
  testCode: S.optional(S.String), // LOINC code if known
  value: S.Number,
  unit: S.String,
  referenceRange: S.optional(S.String), // e.g., "3.5-11.0"
  referenceLow: S.optional(S.Number),
  referenceHigh: S.optional(S.Number),
  status: LabStatusSchema,
  date: S.optional(S.String), // ISO date
  sourceText: S.optional(S.String),
  confidence: S.Number,
});
export type LabResult = S.Schema.Type<typeof LabResultSchema>;

export const LabPanelSchema = S.Struct({
  panelName: S.String, // e.g., "CBC", "BMP", "LFT"
  date: S.optional(S.String),
  results: S.Array(LabResultSchema),
  sourceDocument: S.optional(S.String),
});
export type LabPanel = S.Schema.Type<typeof LabPanelSchema>;

// ============================================================================
// MEDICATION
// ============================================================================

export const MedicationRouteSchema = S.Union(
  S.Literal("PO"), // oral
  S.Literal("IV"), // intravenous
  S.Literal("IM"), // intramuscular
  S.Literal("SC"), // subcutaneous
  S.Literal("SL"), // sublingual
  S.Literal("PR"), // rectal
  S.Literal("TOP"), // topical
  S.Literal("INH"), // inhaled
  S.Literal("UNKNOWN")
);
export type MedicationRoute = S.Schema.Type<typeof MedicationRouteSchema>;

export const MedicationFrequencySchema = S.Union(
  S.Literal("ONCE"),
  S.Literal("DAILY"),
  S.Literal("BID"), // twice daily
  S.Literal("TID"), // three times daily
  S.Literal("QID"), // four times daily
  S.Literal("Q4H"), // every 4 hours
  S.Literal("Q6H"), // every 6 hours
  S.Literal("Q8H"), // every 8 hours
  S.Literal("Q12H"), // every 12 hours
  S.Literal("QHS"), // at bedtime
  S.Literal("PRN"), // as needed
  S.Literal("WEEKLY"),
  S.Literal("UNKNOWN")
);
export type MedicationFrequency = S.Schema.Type<typeof MedicationFrequencySchema>;

export const MedicationSchema = S.Struct({
  name: S.String, // generic or brand name
  genericName: S.optional(S.String),
  dose: S.optional(S.String), // e.g., "500 mg"
  doseValue: S.optional(S.Number),
  doseUnit: S.optional(S.String),
  route: MedicationRouteSchema,
  frequency: MedicationFrequencySchema,
  indication: S.optional(S.String), // why prescribed
  startDate: S.optional(S.String),
  endDate: S.optional(S.String),
  status: S.Union(S.Literal("ACTIVE"), S.Literal("DISCONTINUED"), S.Literal("PRN"), S.Literal("UNKNOWN")),
  sourceText: S.optional(S.String),
  confidence: S.Number,
});
export type Medication = S.Schema.Type<typeof MedicationSchema>;

// ============================================================================
// DIAGNOSIS
// ============================================================================

export const DiagnosisTypeSchema = S.Union(
  S.Literal("PRIMARY"),
  S.Literal("SECONDARY"),
  S.Literal("ADMITTING"),
  S.Literal("DISCHARGE"),
  S.Literal("WORKING"),
  S.Literal("DIFFERENTIAL"),
  S.Literal("UNKNOWN")
);
export type DiagnosisType = S.Schema.Type<typeof DiagnosisTypeSchema>;

export const DiagnosisSchema = S.Struct({
  description: S.String,
  icdCode: S.optional(S.String), // ICD-10 code if present
  type: DiagnosisTypeSchema,
  date: S.optional(S.String),
  status: S.Union(S.Literal("ACTIVE"), S.Literal("RESOLVED"), S.Literal("CHRONIC"), S.Literal("UNKNOWN")),
  sourceText: S.optional(S.String),
  confidence: S.Number,
});
export type Diagnosis = S.Schema.Type<typeof DiagnosisSchema>;

// ============================================================================
// VITAL SIGNS
// ============================================================================

export const VitalSignSchema = S.Struct({
  type: S.Union(
    S.Literal("BP_SYSTOLIC"),
    S.Literal("BP_DIASTOLIC"),
    S.Literal("HEART_RATE"),
    S.Literal("RESPIRATORY_RATE"),
    S.Literal("TEMPERATURE"),
    S.Literal("SPO2"),
    S.Literal("WEIGHT"),
    S.Literal("HEIGHT"),
    S.Literal("BMI"),
    S.Literal("PAIN_SCALE")
  ),
  value: S.Number,
  unit: S.String,
  date: S.optional(S.String),
  time: S.optional(S.String),
  status: S.optional(S.Union(S.Literal("NORMAL"), S.Literal("ABNORMAL"), S.Literal("CRITICAL"))),
  confidence: S.Number,
});
export type VitalSign = S.Schema.Type<typeof VitalSignSchema>;

export const VitalSetSchema = S.Struct({
  date: S.optional(S.String),
  time: S.optional(S.String),
  vitals: S.Array(VitalSignSchema),
});
export type VitalSet = S.Schema.Type<typeof VitalSetSchema>;

// ============================================================================
// IMAGING FINDING
// ============================================================================

export const ImagingModalitySchema = S.Union(
  S.Literal("XRAY"),
  S.Literal("CT"),
  S.Literal("MRI"),
  S.Literal("ULTRASOUND"),
  S.Literal("PET"),
  S.Literal("MAMMOGRAM"),
  S.Literal("FLUOROSCOPY"),
  S.Literal("UNKNOWN")
);
export type ImagingModality = S.Schema.Type<typeof ImagingModalitySchema>;

export const ImagingFindingSchema = S.Struct({
  modality: ImagingModalitySchema,
  bodyPart: S.String,
  finding: S.String,
  impression: S.optional(S.String),
  date: S.optional(S.String),
  isAbnormal: S.Boolean,
  urgency: S.optional(S.Union(S.Literal("ROUTINE"), S.Literal("URGENT"), S.Literal("STAT"))),
  sourceText: S.optional(S.String),
  confidence: S.Number,
});
export type ImagingFinding = S.Schema.Type<typeof ImagingFindingSchema>;

// ============================================================================
// PROCEDURE
// ============================================================================

export const ProcedureSchema = S.Struct({
  name: S.String,
  cptCode: S.optional(S.String),
  date: S.optional(S.String),
  site: S.optional(S.String),
  result: S.optional(S.String),
  complications: S.optional(S.String),
  sourceText: S.optional(S.String),
  confidence: S.Number,
});
export type Procedure = S.Schema.Type<typeof ProcedureSchema>;

// ============================================================================
// LAB TREND
// ============================================================================

export const LabTrendSchema = S.Struct({
  testName: S.String,
  values: S.Array(
    S.Struct({
      date: S.String,
      value: S.Number,
      status: LabStatusSchema,
    })
  ),
  trend: S.Union(
    S.Literal("INCREASING"),
    S.Literal("DECREASING"),
    S.Literal("STABLE"),
    S.Literal("FLUCTUATING"),
    S.Literal("INSUFFICIENT_DATA")
  ),
  clinicalSignificance: S.optional(S.String),
});
export type LabTrend = S.Schema.Type<typeof LabTrendSchema>;

// ============================================================================
// EXTRACTION RESULT
// ============================================================================

export const ExtractionResultSchema = S.Struct({
  documentId: S.String,

  // Extracted data
  labPanels: S.Array(LabPanelSchema),
  medications: S.Array(MedicationSchema),
  diagnoses: S.Array(DiagnosisSchema),
  vitalSets: S.Array(VitalSetSchema),
  imagingFindings: S.Array(ImagingFindingSchema),
  procedures: S.Array(ProcedureSchema),

  // Trends (if enabled)
  labTrends: S.optional(S.Array(LabTrendSchema)),

  // Metadata
  extractionCount: S.Int,
  lowConfidenceCount: S.Int,
  processingTimeMs: S.Int,
});
export type ExtractionResult = S.Schema.Type<typeof ExtractionResultSchema>;

// ============================================================================
// EXTRACTION PATTERNS (generalized, not institution-specific)
// ============================================================================

/**
 * Lab test patterns - matches common formats:
 * "WBC 12.5 x10E3/uL (3.5-11.0)"
 * "Hemoglobin: 14.2 g/dL H"
 * "Glucose 98 mg/dL [70-100]"
 */
export const LAB_PATTERNS = {
  // Common lab tests
  WBC: /\bWBC[:\s]*(\d+\.?\d*)\s*(x?10[E^]?3\/[uμ]?L)?/i,
  RBC: /\bRBC[:\s]*(\d+\.?\d*)\s*(x?10[E^]?6\/[uμ]?L)?/i,
  HGB: /\b(?:HGB|Hemoglobin|Hgb)[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,
  HCT: /\b(?:HCT|Hematocrit)[:\s]*(\d+\.?\d*)\s*%?/i,
  PLT: /\b(?:PLT|Platelets?)[:\s]*(\d+\.?\d*)\s*(x?10[E^]?3\/[uμ]?L)?/i,
  MCV: /\bMCV[:\s]*(\d+\.?\d*)\s*(fL)?/i,
  MCH: /\bMCH[:\s]*(\d+\.?\d*)\s*(pg)?/i,
  MCHC: /\bMCHC[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,

  // Chemistry
  SODIUM: /\b(?:Na|Sodium)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  POTASSIUM: /\b(?:K|Potassium)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  CHLORIDE: /\b(?:Cl|Chloride)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  CO2: /\b(?:CO2|Bicarb)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  BUN: /\bBUN[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  CREATININE: /\b(?:Cr|Creatinine)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  GLUCOSE: /\b(?:Glu|Glucose)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  CALCIUM: /\b(?:Ca|Calcium)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,

  // Liver function
  AST: /\b(?:AST|SGOT)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  ALT: /\b(?:ALT|SGPT)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  ALP: /\b(?:ALP|Alk\s*Phos)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  BILIRUBIN: /\b(?:Bili|Bilirubin)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  ALBUMIN: /\bAlbumin[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,

  // Coagulation
  PT: /\bPT[:\s]*(\d+\.?\d*)\s*(sec|seconds)?/i,
  INR: /\bINR[:\s]*(\d+\.?\d*)/i,
  PTT: /\b(?:PTT|aPTT)[:\s]*(\d+\.?\d*)\s*(sec|seconds)?/i,

  // Cardiac
  TROPONIN: /\bTroponin[:\s]*(<?\d+\.?\d*)\s*(ng\/mL|ng\/L)?/i,
  BNP: /\bBNP[:\s]*(\d+\.?\d*)\s*(pg\/mL)?/i,

  // Reference range (captures H/L flags and ranges)
  REFERENCE_RANGE: /\[?\(?\s*(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)\s*\)?\]?/,
  STATUS_FLAG: /\b(H|L|HH|LL|HIGH|LOW|CRIT|CRITICAL)\b/i,
};

/**
 * Medication patterns
 */
export const MEDICATION_PATTERNS = {
  // Drug name followed by dose and frequency
  FULL_ORDER: /\b([A-Za-z][\w-]+(?:\s+[A-Za-z][\w-]+)?)\s*,?\s*(\d+\.?\d*)\s*(mg|mcg|g|mL|units?)\s*,?\s*(PO|IV|IM|SC|SL|PR|TOP|INH)?\s*,?\s*(BID|TID|QID|Q\d+H|QHS|PRN|daily|once|weekly)?/i,

  // Dose patterns
  DOSE: /(\d+\.?\d*)\s*(mg|mcg|g|mL|units?|tablets?|caps?)/i,

  // Route patterns
  ROUTE: /\b(PO|IV|IM|SC|SubQ|SL|PR|topical|inhaled|oral|intravenous)\b/i,

  // Frequency patterns
  FREQUENCY: /\b(once|daily|BID|TID|QID|Q(\d+)H|QHS|PRN|every\s*\d+\s*hours?|twice\s*daily|weekly)\b/i,
};

/**
 * Vital sign patterns
 */
export const VITAL_PATTERNS = {
  BP: /\bBP[:\s]*(\d{2,3})\s*\/\s*(\d{2,3})\s*(mmHg)?/i,
  HR: /\b(?:HR|Heart\s*Rate|Pulse)[:\s]*(\d{2,3})\s*(bpm|\/min)?/i,
  RR: /\b(?:RR|Resp(?:iratory)?\s*Rate)[:\s]*(\d{1,2})\s*(\/min)?/i,
  TEMP: /\b(?:Temp|Temperature)[:\s]*(\d{2,3}\.?\d*)\s*(°?[FC]|degrees)?/i,
  SPO2: /\b(?:SpO2|O2\s*Sat|Oxygen\s*Sat)[:\s]*(\d{2,3})\s*%?/i,
  WEIGHT: /\bWeight[:\s]*(\d+\.?\d*)\s*(kg|lbs?|pounds?)?/i,
  HEIGHT: /\bHeight[:\s]*(\d+\.?\d*)\s*(cm|in|inches|feet|ft)?/i,
  PAIN: /\bPain[:\s]*(\d{1,2})\s*(?:\/\s*10)?/i,
};

/**
 * Diagnosis patterns
 */
export const DIAGNOSIS_PATTERNS = {
  // Section headers
  DIAGNOSIS_HEADER: /\b(Diagnos[ie]s?|Assessment|Impression|Problem\s*List|A\/P)[:\s]*/i,
  PRIMARY: /\b(Primary|Principal|Admitting)\s*(?:Dx|Diagnosis)[:\s]*/i,
  DISCHARGE: /\b(Discharge)\s*(?:Dx|Diagnosis)[:\s]*/i,

  // ICD code (ICD-10 format)
  ICD10: /\b([A-Z]\d{2}(?:\.\d{1,4})?)\b/,
};

/**
 * Imaging patterns
 */
export const IMAGING_PATTERNS = {
  MODALITY: /\b(X-?ray|CT|MRI|Ultrasound|US|PET|Mammogram|Fluoro)/i,
  IMPRESSION: /\b(?:IMPRESSION|FINDINGS|CONCLUSION)[:\s]*/i,
  ABNORMAL_KEYWORDS: /\b(abnormal|mass|lesion|fracture|effusion|consolidation|opacity|enlarged|nodule|tumor)\b/i,
};

/**
 * Date patterns
 */
export const DATE_PATTERNS = {
  US_FORMAT: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/, // MM/DD/YYYY
  ISO_FORMAT: /\b(\d{4})-(\d{2})-(\d{2})\b/, // YYYY-MM-DD
  WRITTEN: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
};

// ============================================================================
// REFERENCE RANGES (generalized normal ranges)
// ============================================================================

export const REFERENCE_RANGES: Record<string, { low: number; high: number; unit: string }> = {
  WBC: { low: 3.5, high: 11.0, unit: "x10E3/uL" },
  RBC: { low: 4.0, high: 5.5, unit: "x10E6/uL" },
  HGB: { low: 12.0, high: 17.0, unit: "g/dL" },
  HCT: { low: 36, high: 50, unit: "%" },
  PLT: { low: 150, high: 400, unit: "x10E3/uL" },
  SODIUM: { low: 136, high: 145, unit: "mEq/L" },
  POTASSIUM: { low: 3.5, high: 5.0, unit: "mEq/L" },
  CHLORIDE: { low: 98, high: 106, unit: "mEq/L" },
  CO2: { low: 22, high: 29, unit: "mEq/L" },
  BUN: { low: 7, high: 20, unit: "mg/dL" },
  CREATININE: { low: 0.6, high: 1.2, unit: "mg/dL" },
  GLUCOSE: { low: 70, high: 100, unit: "mg/dL" },
  CALCIUM: { low: 8.5, high: 10.5, unit: "mg/dL" },
  AST: { low: 10, high: 40, unit: "U/L" },
  ALT: { low: 7, high: 56, unit: "U/L" },
  ALP: { low: 44, high: 147, unit: "U/L" },
  BILIRUBIN: { low: 0.1, high: 1.2, unit: "mg/dL" },
  ALBUMIN: { low: 3.5, high: 5.0, unit: "g/dL" },
  PT: { low: 11, high: 13.5, unit: "sec" },
  INR: { low: 0.8, high: 1.1, unit: "" },
};

/**
 * Determine lab status based on value and reference range
 */
export const getLabStatus = (
  value: number,
  testName: string,
  customRange?: { low?: number; high?: number }
): LabStatus => {
  const range = customRange || REFERENCE_RANGES[testName.toUpperCase()];
  if (!range) return "UNKNOWN";

  const { low, high } = range;

  // If custom range was provided but values are undefined, return unknown
  if (low === undefined || high === undefined) return "UNKNOWN";

  // Critical thresholds (roughly 2x normal bounds)
  const criticalLow = low * 0.5;
  const criticalHigh = high * 2;

  if (value < criticalLow) return "CRITICAL_LOW";
  if (value > criticalHigh) return "CRITICAL_HIGH";
  if (value < low) return "LOW";
  if (value > high) return "HIGH";
  return "NORMAL";
};

/**
 * Parse medication frequency string to enum
 */
export const parseFrequency = (text: string): MedicationFrequency => {
  const lower = text.toLowerCase();
  if (/once|x1|single/i.test(lower)) return "ONCE";
  // Check "twice daily" / "BID" BEFORE "daily" to avoid false matches
  if (/bid|twice\s*daily/i.test(lower)) return "BID";
  if (/daily|qd|every\s*day/i.test(lower)) return "DAILY";
  if (/tid|three/i.test(lower)) return "TID";
  if (/qid|four/i.test(lower)) return "QID";
  if (/q4h/i.test(lower)) return "Q4H";
  if (/q6h/i.test(lower)) return "Q6H";
  if (/q8h/i.test(lower)) return "Q8H";
  if (/q12h/i.test(lower)) return "Q12H";
  if (/qhs|bedtime/i.test(lower)) return "QHS";
  if (/prn|as\s*needed/i.test(lower)) return "PRN";
  if (/weekly/i.test(lower)) return "WEEKLY";
  return "UNKNOWN";
};

/**
 * Parse medication route string to enum
 */
export const parseRoute = (text: string): MedicationRoute => {
  const lower = text.toLowerCase();
  if (/\bpo\b|oral/i.test(lower)) return "PO";
  if (/\biv\b|intravenous/i.test(lower)) return "IV";
  if (/\bim\b|intramuscular/i.test(lower)) return "IM";
  if (/\bsc\b|\bsubq?\b|subcutaneous/i.test(lower)) return "SC";
  if (/\bsl\b|sublingual/i.test(lower)) return "SL";
  if (/\bpr\b|rectal/i.test(lower)) return "PR";
  if (/\btop\b|topical/i.test(lower)) return "TOP";
  if (/\binh\b|inhaled/i.test(lower)) return "INH";
  return "UNKNOWN";
};

/**
 * Parse imaging modality from text
 */
export const parseModality = (text: string): ImagingModality => {
  if (/\bx-?ray\b/i.test(text)) return "XRAY";
  if (/\bct\b/i.test(text)) return "CT";
  if (/\bmri\b/i.test(text)) return "MRI";
  if (/\b(ultrasound|us)\b/i.test(text)) return "ULTRASOUND";
  if (/\bpet\b/i.test(text)) return "PET";
  if (/\bmammogram/i.test(text)) return "MAMMOGRAM";
  if (/\bfluoro/i.test(text)) return "FLUOROSCOPY";
  return "UNKNOWN";
};
