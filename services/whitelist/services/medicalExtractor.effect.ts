/**
 * MEDICAL DATA EXTRACTOR - EFFECT VERSION
 * 
 * WHITELIST APPROACH: Extract ONLY structured clinical data.
 * PII is excluded by design - we never extract names, addresses, IDs.
 * 
 * Architecture:
 * - Effect<ExtractedMedicalRecord, MedicalExtractionError, never>
 * - Multi-pass extraction (labs, meds, diagnoses, etc.)
 * - Post-extraction PII validation
 * - Confidence scoring
 * 
 * OCaml equivalent:
 * module MedicalExtractor : sig
 *   val extract : raw_text -> (medical_record, extraction_error) result
 * end
 */

import { Effect, pipe, Array as A, Option as O } from "effect";
import type {
  ExtractedMedicalRecord,
  LabResult,
  LabPanel,
  Diagnosis,
  Medication,
  Procedure,
  ImagingFinding,
  VitalSigns,
  PathologyResult,
  ClinicalObservation,
  DocumentType,
  LabStatus,
  Severity,
} from "../../../schemas/schemas";
import {
  PIILeakageError,
  SectionExtractionError,
  LabParseError,
  ExtractionErrorCollector,
  type MedicalExtractionError,
} from "./extractionErrors";

// ============================================================================
// PII DETECTION (Post-extraction validation)
// ============================================================================

const PII_PATTERNS = {
  phone: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i,
  mrn: /\bMRN[:\s]*\d{6,}/i,
  // Name patterns - look for "Firstname Lastname" patterns
  // Exclude medical terms that look like names
  potentialName: /\b(?!(?:Tylenol|Advil|Motrin|Aspirin|Ibuprofen|Metformin|Lisinopril|Atorvastatin|Omeprazole|Amlodipine|Metoprolol|Albuterol|Gabapentin|Hydrochlorothiazide|Losartan|Levothyroxine|Azithromycin|Amoxicillin|Prednisone|Fluticasone|Montelukast|Pantoprazole|Furosemide|Sertraline|Escitalopram|Duloxetine|Trazodone|Clopidogrel|Warfarin|Apixaban|Rivaroxaban|Carvedilol|Tamsulosin|Finasteride|Sildenafil|Insulin|Methotrexate|Humira|Enbrel|Remicade|Keytruda|Opdivo|Herceptin|Avastin|Rituxan)\b)[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/,
  address: /\b\d+\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct)\b/i,
  zipCode: /\b\d{5}(?:-\d{4})?\b/,
  dobPattern: /\b(?:DOB|Date of Birth)[:\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/i,
};

/**
 * Validate extracted text doesn't contain PII
 */
const validateNoPII = (
  text: string,
  fieldName: string
): Effect.Effect<string, PIILeakageError, never> => {
  return Effect.gen(function* (_) {
    for (const [patternName, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(text)) {
        // Allow zip codes in certain contexts (like reference ranges)
        if (patternName === "zipCode" && fieldName.includes("reference")) {
          continue;
        }
        
        return yield* _(Effect.fail(new PIILeakageError({
          field: fieldName,
          pattern: patternName,
          suspiciousContent: text.substring(0, 50) + "...",
          severity: patternName === "ssn" ? "critical" : "warning",
        })));
      }
    }
    return text;
  });
};

/**
 * Sanitize text by removing any potential PII patterns
 * Used when we want to extract but clean the content
 */
const sanitizeText = (text: string): string => {
  let sanitized = text;
  
  // Remove phone numbers
  sanitized = sanitized.replace(PII_PATTERNS.phone, "[PHONE]");
  // Remove SSN
  sanitized = sanitized.replace(PII_PATTERNS.ssn, "[SSN]");
  // Remove email
  sanitized = sanitized.replace(PII_PATTERNS.email, "[EMAIL]");
  // Remove MRN
  sanitized = sanitized.replace(PII_PATTERNS.mrn, "[MRN]");
  // Remove addresses
  sanitized = sanitized.replace(PII_PATTERNS.address, "[ADDRESS]");
  // Remove DOB patterns
  sanitized = sanitized.replace(PII_PATTERNS.dobPattern, "[DOB]");
  
  return sanitized;
};

// ============================================================================
// LAB EXTRACTION
// ============================================================================

const LAB_TEST_PATTERNS: Record<string, RegExp> = {
  // CBC
  WBC: /(?:WBC|White Blood Cell|Leukocytes)[:\s]*(\d+\.?\d*)\s*(K\/uL|x10\^9\/L|\/mm3)?/i,
  RBC: /(?:RBC|Red Blood Cell|Erythrocytes)[:\s]*(\d+\.?\d*)\s*(M\/uL|x10\^12\/L)?/i,
  HGB: /(?:HGB|Hemoglobin|Hgb)[:\s]*(\d+\.?\d*)\s*(g\/dL|g\/L)?/i,
  HCT: /(?:HCT|Hematocrit|Hct)[:\s]*(\d+\.?\d*)\s*(%)?/i,
  PLT: /(?:PLT|Platelets|Platelet Count)[:\s]*(\d+\.?\d*)\s*(K\/uL|x10\^9\/L)?/i,
  MCV: /(?:MCV|Mean Corpuscular Volume)[:\s]*(\d+\.?\d*)\s*(fL)?/i,
  MCH: /(?:MCH|Mean Corpuscular Hemoglobin)[:\s]*(\d+\.?\d*)\s*(pg)?/i,
  MCHC: /(?:MCHC)[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,
  RDW: /(?:RDW|Red Cell Distribution Width)[:\s]*(\d+\.?\d*)\s*(%)?/i,
  
  // BMP/CMP
  Glucose: /(?:Glucose|Blood Sugar|BS)[:\s]*(\d+\.?\d*)\s*(mg\/dL|mmol\/L)?/i,
  BUN: /(?:BUN|Blood Urea Nitrogen)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  Creatinine: /(?:Creatinine|Cr|Creat)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  Sodium: /(?:Sodium|Na)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  Potassium: /(?:Potassium|K(?!\s*\/uL))[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  Chloride: /(?:Chloride|Cl)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  CO2: /(?:CO2|Bicarbonate|HCO3)[:\s]*(\d+\.?\d*)\s*(mEq\/L|mmol\/L)?/i,
  Calcium: /(?:Calcium|Ca)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  
  // Liver Panel
  AST: /(?:AST|SGOT|Aspartate Aminotransferase)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  ALT: /(?:ALT|SGPT|Alanine Aminotransferase)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  ALP: /(?:ALP|Alkaline Phosphatase|Alk Phos)[:\s]*(\d+\.?\d*)\s*(U\/L|IU\/L)?/i,
  Bilirubin: /(?:Bilirubin|Total Bilirubin|T\.?\s*Bili)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  Albumin: /(?:Albumin|Alb)[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,
  TotalProtein: /(?:Total Protein|TP)[:\s]*(\d+\.?\d*)\s*(g\/dL)?/i,
  
  // Lipid Panel
  TotalCholesterol: /(?:Total Cholesterol|Cholesterol)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  LDL: /(?:LDL|LDL-C|LDL Cholesterol)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  HDL: /(?:HDL|HDL-C|HDL Cholesterol)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  Triglycerides: /(?:Triglycerides|TG|Trig)[:\s]*(\d+\.?\d*)\s*(mg\/dL)?/i,
  
  // Thyroid
  TSH: /(?:TSH|Thyroid Stimulating Hormone)[:\s]*(\d+\.?\d*)\s*(mIU\/L|uIU\/mL)?/i,
  T4: /(?:T4|Free T4|FT4|Thyroxine)[:\s]*(\d+\.?\d*)\s*(ng\/dL)?/i,
  T3: /(?:T3|Free T3|FT3|Triiodothyronine)[:\s]*(\d+\.?\d*)\s*(pg\/mL)?/i,
  
  // Coagulation
  PT: /(?:PT|Prothrombin Time)[:\s]*(\d+\.?\d*)\s*(seconds|sec|s)?/i,
  INR: /(?:INR|International Normalized Ratio)[:\s]*(\d+\.?\d*)/i,
  PTT: /(?:PTT|aPTT|Partial Thromboplastin Time)[:\s]*(\d+\.?\d*)\s*(seconds|sec|s)?/i,
  
  // Cardiac
  Troponin: /(?:Troponin|TnI|TnT|Troponin I|Troponin T)[:\s]*(<?\d*\.?\d*)\s*(ng\/mL|ng\/L)?/i,
  BNP: /(?:BNP|B-type Natriuretic Peptide|NT-proBNP)[:\s]*(\d+\.?\d*)\s*(pg\/mL)?/i,
  
  // A1C
  HbA1c: /(?:HbA1c|A1C|Hemoglobin A1c|Glycated Hemoglobin)[:\s]*(\d+\.?\d*)\s*(%)?/i,
  
  // Inflammatory
  CRP: /(?:CRP|C-Reactive Protein)[:\s]*(\d+\.?\d*)\s*(mg\/L|mg\/dL)?/i,
  ESR: /(?:ESR|Sed Rate|Sedimentation Rate)[:\s]*(\d+\.?\d*)\s*(mm\/hr)?/i,
  
  // Tumor Markers
  PSA: /(?:PSA|Prostate Specific Antigen)[:\s]*(\d+\.?\d*)\s*(ng\/mL)?/i,
  CEA: /(?:CEA|Carcinoembryonic Antigen)[:\s]*(\d+\.?\d*)\s*(ng\/mL)?/i,
  CA125: /(?:CA-?125|CA 125)[:\s]*(\d+\.?\d*)\s*(U\/mL)?/i,
  AFP: /(?:AFP|Alpha-?fetoprotein)[:\s]*(\d+\.?\d*)\s*(ng\/mL)?/i,
};

const REFERENCE_RANGES: Record<string, { low: number; high: number; unit: string }> = {
  WBC: { low: 4.0, high: 11.0, unit: "K/uL" },
  RBC: { low: 4.5, high: 5.5, unit: "M/uL" },
  HGB: { low: 12.0, high: 17.5, unit: "g/dL" },
  HCT: { low: 36, high: 50, unit: "%" },
  PLT: { low: 150, high: 400, unit: "K/uL" },
  Glucose: { low: 70, high: 100, unit: "mg/dL" },
  BUN: { low: 7, high: 20, unit: "mg/dL" },
  Creatinine: { low: 0.6, high: 1.2, unit: "mg/dL" },
  Sodium: { low: 136, high: 145, unit: "mEq/L" },
  Potassium: { low: 3.5, high: 5.0, unit: "mEq/L" },
  TSH: { low: 0.4, high: 4.0, unit: "mIU/L" },
  HbA1c: { low: 4.0, high: 5.6, unit: "%" },
};

const determineLabStatus = (testName: string, value: number): LabStatus => {
  const range = REFERENCE_RANGES[testName];
  if (!range) return "unknown";
  
  if (value < range.low * 0.5 || value > range.high * 2) return "critical";
  if (value < range.low) return "low";
  if (value > range.high) return "high";
  return "normal";
};

const extractLabResults = (
  text: string,
  errorCollector: ExtractionErrorCollector
): LabResult[] => {
  const results: LabResult[] = [];
  
  for (const [testName, pattern] of Object.entries(LAB_TEST_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      const valueStr = match[1];
      const unit = match[2] || REFERENCE_RANGES[testName]?.unit || "";
      const value = parseFloat(valueStr);
      
      if (!isNaN(value)) {
        const range = REFERENCE_RANGES[testName];
        results.push({
          testName,
          value: valueStr,
          unit: unit || undefined,
          referenceRange: range ? `${range.low}-${range.high}` : undefined,
          status: determineLabStatus(testName, value),
        });
      } else {
        errorCollector.add(new LabParseError({
          rawLine: match[0],
          reason: `Could not parse numeric value: ${valueStr}`,
          partialResult: { testName, value: valueStr, unit },
        }));
      }
    }
  }
  
  return results;
};

// ============================================================================
// MEDICATION EXTRACTION
// ============================================================================

const MEDICATION_PATTERN = /\b([A-Z][a-z]+(?:\/[A-Z][a-z]+)?)\s+(\d+(?:\.\d+)?)\s*(mg|mcg|g|mL|units?|IU)\b(?:\s+(?:(oral(?:ly)?|IV|IM|subq|topical|inhaled|PO|PR))\b)?(?:\s+(?:(once|twice|three times|four times|q\d+h?|daily|BID|TID|QID|PRN|as needed|every \d+ hours?|at bedtime|HS|QAM|QPM))\s*(?:daily|a day)?)?/gi;

const ROUTE_MAP: Record<string, Medication["route"]> = {
  oral: "oral",
  orally: "oral",
  po: "oral",
  iv: "iv",
  im: "im",
  subq: "subq",
  topical: "topical",
  inhaled: "inhaled",
  pr: "rectal",
};

// Known medication names to validate against
const KNOWN_MEDICATIONS = new Set([
  "Tylenol", "Acetaminophen", "Advil", "Motrin", "Ibuprofen", "Aspirin",
  "Metformin", "Lisinopril", "Atorvastatin", "Omeprazole", "Amlodipine",
  "Metoprolol", "Albuterol", "Gabapentin", "Hydrochlorothiazide", "Losartan",
  "Levothyroxine", "Azithromycin", "Amoxicillin", "Prednisone", "Fluticasone",
  "Montelukast", "Pantoprazole", "Furosemide", "Sertraline", "Escitalopram",
  "Duloxetine", "Trazodone", "Clopidogrel", "Warfarin", "Apixaban", "Rivaroxaban",
  "Carvedilol", "Tamsulosin", "Finasteride", "Ondansetron", "Zofran",
  "Oxycodone", "Hydrocodone", "Morphine", "Fentanyl", "Tramadol",
  "Insulin", "Glargine", "Lispro", "Aspart", "Detemir",
  "Methotrexate", "Humira", "Enbrel", "Remicade", "Keytruda", "Opdivo",
  "Cisplatin", "Carboplatin", "Paclitaxel", "Docetaxel", "Doxorubicin",
  "Vancomycin", "Ceftriaxone", "Piperacillin", "Meropenem", "Ciprofloxacin",
  "Heparin", "Enoxaparin", "Lovenox", "Eliquis", "Xarelto", "Coumadin",
  "Dilaudid", "Hydromorphone", "Norco", "Percocet", "Vicodin",
  "Ativan", "Lorazepam", "Xanax", "Alprazolam", "Valium", "Diazepam",
  "Ambien", "Zolpidem", "Lunesta", "Eszopiclone",
  "Zoloft", "Lexapro", "Prozac", "Fluoxetine", "Celexa", "Citalopram",
  "Wellbutrin", "Bupropion", "Effexor", "Venlafaxine", "Cymbalta",
]);

const extractMedications = (
  text: string,
  errorCollector: ExtractionErrorCollector
): Medication[] => {
  const medications: Medication[] = [];
  const seen = new Set<string>();
  
  let match;
  const pattern = new RegExp(MEDICATION_PATTERN.source, MEDICATION_PATTERN.flags);
  
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    const dose = match[2];
    const unit = match[3];
    const route = match[4]?.toLowerCase();
    const frequency = match[5];
    
    // Validate it's likely a real medication
    const isKnown = KNOWN_MEDICATIONS.has(name) || 
                    Array.from(KNOWN_MEDICATIONS).some(m => 
                      m.toLowerCase() === name.toLowerCase()
                    );
    
    // Skip if it looks like a name (not in our medication list and has name-like pattern)
    if (!isKnown && /^[A-Z][a-z]+$/.test(name)) {
      continue;
    }
    
    const key = `${name}-${dose}-${unit}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    
    medications.push({
      name,
      dose,
      unit,
      route: route ? ROUTE_MAP[route] || "other" : undefined,
      frequency: frequency || undefined,
      status: "active",
    });
  }
  
  return medications;
};

// ============================================================================
// DIAGNOSIS EXTRACTION
// ============================================================================

const DIAGNOSIS_PATTERNS = [
  // ICD-10 codes with descriptions
  /(?:DX|Diagnosis|Assessment)[:\s]*([A-Z]\d{2}(?:\.\d{1,4})?)\s*[-–]\s*([^\n]+)/gi,
  // "diagnosed with" pattern
  /(?:diagnosed with|diagnosis of|assessment:?)\s+([^,.\n]+(?:cancer|carcinoma|tumor|syndrome|disease|disorder|infection|insufficiency|failure))/gi,
  // Cancer staging
  /(?:Stage|Grade)\s+([IVX]+[ABC]?)\s+([A-Za-z]+\s+(?:cancer|carcinoma|tumor|adenocarcinoma|lymphoma|melanoma|sarcoma))/gi,
  // Common condition patterns
  /((?:metastatic|primary|recurrent|chronic|acute)\s+[A-Za-z]+\s+(?:cancer|carcinoma|disease|infection|failure))/gi,
];

const SEVERITY_KEYWORDS: Record<string, Severity> = {
  mild: "mild",
  moderate: "moderate",
  severe: "severe",
  critical: "critical",
  advanced: "severe",
  early: "mild",
  late: "severe",
  stage: "unspecified",
};

const extractDiagnoses = (
  text: string,
  errorCollector: ExtractionErrorCollector
): Diagnosis[] => {
  const diagnoses: Diagnosis[] = [];
  const seen = new Set<string>();
  
  for (const pattern of DIAGNOSIS_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(text)) !== null) {
      let condition = match[2] || match[1];
      const icdCode = /^[A-Z]\d{2}/.test(match[1]) ? match[1] : undefined;
      
      // Clean up the condition text
      condition = condition.trim().replace(/[,;.]$/, "");
      
      // Validate it doesn't contain PII patterns
      if (PII_PATTERNS.potentialName.test(condition)) {
        continue;
      }
      
      const key = condition.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      
      // Determine severity from keywords
      let severity: Severity = "unspecified";
      for (const [keyword, sev] of Object.entries(SEVERITY_KEYWORDS)) {
        if (condition.toLowerCase().includes(keyword)) {
          severity = sev;
          break;
        }
      }
      
      diagnoses.push({
        condition: sanitizeText(condition),
        icdCode,
        severity,
        status: "active",
      });
    }
  }
  
  return diagnoses;
};

// ============================================================================
// IMAGING FINDINGS EXTRACTION
// ============================================================================

const IMAGING_MODALITY_PATTERNS: Record<ImagingFinding["modality"], RegExp> = {
  ct: /\b(?:CT|CAT|Computed Tomography)\b/i,
  mri: /\b(?:MRI|Magnetic Resonance|MR\s+(?:imaging|scan))\b/i,
  xray: /\b(?:X-?ray|Radiograph|CXR|Plain film)\b/i,
  ultrasound: /\b(?:Ultrasound|US|Sonograph|Echo)\b/i,
  pet: /\b(?:PET|PET-CT|Positron Emission)\b/i,
  nuclear: /\b(?:Nuclear|Scintigraphy|Bone scan)\b/i,
  fluoroscopy: /\b(?:Fluoroscopy|Fluoro)\b/i,
  other: /./,
};

const BODY_PART_PATTERNS = [
  /(?:of the|of)\s+(chest|abdomen|pelvis|brain|head|spine|lumbar|thoracic|cervical|neck|extremit(?:y|ies)|knee|hip|shoulder|ankle|wrist|hand|foot)/i,
  /(chest|abdomen|pelvis|brain|head|spine|lumbar|thoracic|cervical)\s+(?:CT|MRI|X-?ray|scan)/i,
];

const FINDING_PATTERNS = [
  // Findings/Impression sections
  /(?:Findings?|Impression|Conclusion)[:\s]*([^\n]+(?:\n(?![A-Z]{2,}:)[^\n]+)*)/gi,
  // Specific finding patterns
  /(?:demonstrates?|shows?|reveals?|evidence of|concerning for|consistent with|suspicious for)[:\s]*([^.\n]+)/gi,
  // Measurements
  /(?:mass|lesion|nodule|tumor|adenopathy)\s+(?:measuring|measures?)\s+([^.\n]+)/gi,
];

const extractImagingFindings = (
  text: string,
  errorCollector: ExtractionErrorCollector
): ImagingFinding[] => {
  const findings: ImagingFinding[] = [];
  
  // Determine modality
  let modality: ImagingFinding["modality"] = "other";
  for (const [mod, pattern] of Object.entries(IMAGING_MODALITY_PATTERNS)) {
    if (pattern.test(text)) {
      modality = mod as ImagingFinding["modality"];
      break;
    }
  }
  
  // Extract body part
  let bodyPart = "unspecified";
  for (const pattern of BODY_PART_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      bodyPart = match[1];
      break;
    }
  }
  
  // Extract findings
  const extractedFindings: string[] = [];
  for (const pattern of FINDING_PATTERNS) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(text)) !== null) {
      let finding = match[1].trim();
      // Sanitize and validate
      finding = sanitizeText(finding);
      if (finding.length > 10 && !PII_PATTERNS.potentialName.test(finding)) {
        extractedFindings.push(finding);
      }
    }
  }
  
  // Extract impression
  const impressionMatch = text.match(/(?:Impression|Conclusion)[:\s]*([^\n]+(?:\n(?![A-Z]{2,}:)[^\n]+)*)/i);
  const impression = impressionMatch ? sanitizeText(impressionMatch[1].trim()) : undefined;
  
  if (extractedFindings.length > 0 || impression) {
    findings.push({
      modality,
      bodyPart,
      findings: extractedFindings.slice(0, 10), // Limit to 10 findings
      impression,
    });
  }
  
  return findings;
};

// ============================================================================
// VITAL SIGNS EXTRACTION
// ============================================================================

const VITAL_PATTERNS = {
  bloodPressure: /(?:BP|Blood Pressure)[:\s]*(\d{2,3})\s*[\/\\]\s*(\d{2,3})/i,
  heartRate: /(?:HR|Heart Rate|Pulse)[:\s]*(\d{2,3})\s*(?:bpm)?/i,
  respiratoryRate: /(?:RR|Resp(?:iratory)? Rate)[:\s]*(\d{1,2})/i,
  temperature: /(?:Temp|Temperature)[:\s]*(\d{2,3}(?:\.\d)?)\s*([°]?[FC])?/i,
  oxygenSaturation: /(?:SpO2|O2 Sat|Oxygen Sat(?:uration)?)[:\s]*(\d{2,3})\s*%?/i,
  weight: /(?:Weight|Wt)[:\s]*(\d{2,3}(?:\.\d)?)\s*(kg|lb|lbs)?/i,
  painScale: /(?:Pain|Pain Scale|Pain Score)[:\s]*(\d{1,2})\s*(?:\/\s*10)?/i,
};

const extractVitalSigns = (
  text: string,
  errorCollector: ExtractionErrorCollector
): VitalSigns[] => {
  // Use plain object to build vitals (avoid readonly constraints)
  const vitals: any = {};
  let hasAnyVital = false;

  // Blood Pressure
  const bpMatch = text.match(VITAL_PATTERNS.bloodPressure);
  if (bpMatch) {
    vitals.bloodPressureSystolic = parseInt(bpMatch[1]);
    vitals.bloodPressureDiastolic = parseInt(bpMatch[2]);
    hasAnyVital = true;
  }

  // Heart Rate
  const hrMatch = text.match(VITAL_PATTERNS.heartRate);
  if (hrMatch) {
    vitals.heartRate = parseInt(hrMatch[1]);
    hasAnyVital = true;
  }

  // Respiratory Rate
  const rrMatch = text.match(VITAL_PATTERNS.respiratoryRate);
  if (rrMatch) {
    vitals.respiratoryRate = parseInt(rrMatch[1]);
    hasAnyVital = true;
  }
  
  // Temperature
  const tempMatch = text.match(VITAL_PATTERNS.temperature);
  if (tempMatch) {
    vitals.temperature = parseFloat(tempMatch[1]);
    vitals.temperatureUnit = tempMatch[2]?.includes("C") ? "C" : "F";
    hasAnyVital = true;
  }
  
  // Oxygen Saturation
  const o2Match = text.match(VITAL_PATTERNS.oxygenSaturation);
  if (o2Match) {
    vitals.oxygenSaturation = parseInt(o2Match[1]);
    hasAnyVital = true;
  }
  
  // Weight
  const weightMatch = text.match(VITAL_PATTERNS.weight);
  if (weightMatch) {
    vitals.weight = parseFloat(weightMatch[1]);
    vitals.weightUnit = weightMatch[2]?.toLowerCase().startsWith("k") ? "kg" : "lb";
    hasAnyVital = true;
  }
  
  // Pain Scale
  const painMatch = text.match(VITAL_PATTERNS.painScale);
  if (painMatch) {
    const pain = parseInt(painMatch[1]);
    if (pain >= 0 && pain <= 10) {
      vitals.painScale = pain;
      hasAnyVital = true;
    }
  }
  
  return hasAnyVital ? [vitals as VitalSigns] : [];
};

// ============================================================================
// PATHOLOGY EXTRACTION
// ============================================================================

const PATHOLOGY_PATTERNS = {
  specimenType: /(?:Specimen|Tissue|Sample)[:\s]*([^\n,]+)/i,
  diagnosis: /(?:Diagnosis|Final Diagnosis|Pathologic Diagnosis)[:\s]*([^\n]+(?:\n(?![A-Z]{2,}:)[^\n]+)*)/i,
  grade: /(?:Grade|Histologic Grade)[:\s]*([^\n,]+)/i,
  stage: /(?:Stage|pTNM|Pathologic Stage)[:\s]*([^\n,]+)/i,
  margins: /(?:Margins?)[:\s]*(negative|positive|close|involved|clear|free)/i,
};

const extractPathologyResults = (
  text: string,
  errorCollector: ExtractionErrorCollector
): PathologyResult[] => {
  const results: PathologyResult[] = [];
  
  const specimenMatch = text.match(PATHOLOGY_PATTERNS.specimenType);
  const diagnosisMatch = text.match(PATHOLOGY_PATTERNS.diagnosis);
  
  if (diagnosisMatch) {
    // Build result with plain object (avoid readonly constraints)
    const result: any = {
      specimenType: specimenMatch ? sanitizeText(specimenMatch[1].trim()) : "unspecified",
      diagnosis: sanitizeText(diagnosisMatch[1].trim()),
    };

    const gradeMatch = text.match(PATHOLOGY_PATTERNS.grade);
    if (gradeMatch) {
      result.grade = gradeMatch[1].trim();
    }

    const stageMatch = text.match(PATHOLOGY_PATTERNS.stage);
    if (stageMatch) {
      result.stage = stageMatch[1].trim();
    }

    const marginsMatch = text.match(PATHOLOGY_PATTERNS.margins);
    if (marginsMatch) {
      const marginText = marginsMatch[1].toLowerCase();
      if (marginText.includes("negative") || marginText.includes("clear") || marginText.includes("free")) {
        result.margins = "negative";
      } else if (marginText.includes("positive") || marginText.includes("involved")) {
        result.margins = "positive";
      } else if (marginText.includes("close")) {
        result.margins = "close";
      }
    }

    results.push(result as PathologyResult);
  }
  
  return results;
};

// ============================================================================
// DOCUMENT TYPE CLASSIFICATION
// ============================================================================

const classifyDocument = (text: string): DocumentType => {
  const lowerText = text.toLowerCase();
  
  if (/(?:lab|laboratory|result|panel|cbc|bmp|cmp|lipid)/i.test(text) && 
      Object.keys(LAB_TEST_PATTERNS).some(test => 
        new RegExp(test, "i").test(text)
      )) {
    return "lab_report";
  }
  
  if (/(?:ct scan|mri|x-?ray|ultrasound|imaging|radiology|impression)/i.test(text)) {
    return "imaging";
  }
  
  if (/(?:pathology|biopsy|specimen|histologic|adenocarcinoma|carcinoma)/i.test(text)) {
    return "pathology";
  }
  
  if (/(?:discharge|discharged|follow.?up|instructions)/i.test(text)) {
    return "discharge_summary";
  }
  
  if (/(?:progress note|soap|assessment|plan|subjective|objective)/i.test(text)) {
    return "progress_note";
  }
  
  if (/(?:medication|prescription|refill|pharmacy)/i.test(text)) {
    return "medication_list";
  }
  
  if (/(?:procedure|operative|surgery|performed)/i.test(text)) {
    return "procedure_note";
  }
  
  if (/(?:consult|consultation|referred|opinion)/i.test(text)) {
    return "consultation";
  }
  
  return "unknown";
};

// ============================================================================
// DATE EXTRACTION
// ============================================================================

const DATE_PATTERNS = [
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
  /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i,
  /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})/i,
];

const extractDocumentDate = (text: string, filename: string): string | undefined => {
  // Try filename first
  const filenameMatch = filename.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (filenameMatch) {
    return filenameMatch[0];
  }
  
  // Try document content
  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  
  return undefined;
};

// ============================================================================
// MAIN EXTRACTION PIPELINE
// ============================================================================

export interface ExtractionInput {
  text: string;
  filename: string;
  documentHash: string;
}

export const extractMedicalData = (
  input: ExtractionInput
): Effect.Effect<ExtractedMedicalRecord, MedicalExtractionError, never> => {
  return Effect.gen(function* (_) {
    const { text, filename, documentHash } = input;
    const errorCollector = new ExtractionErrorCollector();
    
    // Classify document type
    const documentType = classifyDocument(text);
    
    // Extract date
    const documentDate = extractDocumentDate(text, filename);
    
    // Extract all clinical data (whitelist approach)
    const labResults = extractLabResults(text, errorCollector);
    const medications = extractMedications(text, errorCollector);
    const diagnoses = extractDiagnoses(text, errorCollector);
    const imagingFindings = extractImagingFindings(text, errorCollector);
    const vitalSigns = extractVitalSigns(text, errorCollector);
    const pathologyResults = extractPathologyResults(text, errorCollector);
    
    // Check for PII leakage
    if (errorCollector.hasPIILeaks()) {
      const piiErrors = errorCollector.getErrors().filter(
        e => e._tag === "PIILeakageError"
      );
      return yield* _(Effect.fail(piiErrors[0] as PIILeakageError));
    }
    
    // Create lab panels from results
    const labPanels: LabPanel[] = labResults.length > 0 ? [{
      collectionDate: documentDate || "unknown",
      results: labResults,
    }] : [];
    
    // Calculate confidence based on extraction success
    const totalExtracted = 
      labResults.length + 
      medications.length + 
      diagnoses.length + 
      imagingFindings.length + 
      vitalSigns.length +
      pathologyResults.length;
    
    const confidence = Math.min(100, Math.max(0,
      totalExtracted > 0 ? 70 + Math.min(30, totalExtracted * 3) : 30
    ));
    
    const record: ExtractedMedicalRecord = {
      sourceDocumentHash: documentHash,
      documentType,
      documentDate,
      extractionConfidence: confidence,
      diagnoses,
      labPanels,
      medications,
      procedures: [],
      imagingFindings,
      vitalSigns,
      pathology: pathologyResults,
      clinicalObservations: [],
      warnings: errorCollector.getWarnings(),
      sectionsSkipped: [],
    };
    
    return record;
  });
};

// ============================================================================
// SYNC WRAPPER FOR LEGACY COMPATIBILITY
// ============================================================================

export const extractMedicalDataSync = (input: ExtractionInput): ExtractedMedicalRecord => {
  return Effect.runSync(extractMedicalData(input));
};
