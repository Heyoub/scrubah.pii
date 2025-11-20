/**
 * Structured Lab Data Extraction
 * Converts prose lab reports into token-efficient table format
 */

export interface LabResult {
  testName: string;
  value: string;
  unit: string;
  referenceRange?: string;
  status?: 'Normal' | 'High' | 'Low' | 'Critical';
  date: string;
}

export interface LabPanel {
  panelName: string;
  date: string;
  results: LabResult[];
}

/**
 * Common lab test patterns with their variations
 */
const LAB_TEST_PATTERNS = {
  // Complete Blood Count (CBC)
  WBC: /(?:WBC|White Blood Cell|Leukocyte).*?(\d+\.?\d*)\s*(?:K\/µL|K\/uL|thou\/µL|x10\^3\/µL)/i,
  RBC: /(?:RBC|Red Blood Cell|Erythrocyte).*?(\d+\.?\d*)\s*(?:M\/µL|M\/uL|mill\/µL|x10\^6\/µL)/i,
  HGB: /(?:HGB|Hemoglobin|Hgb).*?(\d+\.?\d*)\s*(?:g\/dL|gm\/dL)/i,
  HCT: /(?:HCT|Hematocrit).*?(\d+\.?\d*)\s*(?:%|percent)/i,
  PLT: /(?:PLT|Platelet|Thrombocyte).*?(\d+\.?\d*)\s*(?:K\/µL|K\/uL|thou\/µL)/i,

  // Comprehensive Metabolic Panel (CMP)
  GLUCOSE: /(?:GLU|Glucose|Blood Sugar).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  SODIUM: /(?:NA|Sodium|Na\+).*?(\d+\.?\d*)\s*(?:mEq\/L|mmol\/L)/i,
  POTASSIUM: /(?:K|Potassium|K\+).*?(\d+\.?\d*)\s*(?:mEq\/L|mmol\/L)/i,
  CHLORIDE: /(?:CL|Chloride|Cl-).*?(\d+\.?\d*)\s*(?:mEq\/L|mmol\/L)/i,
  BUN: /(?:BUN|Blood Urea Nitrogen).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  CREATININE: /(?:CRT|Creatinine|Cr).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  CALCIUM: /(?:CA|Calcium).*?(\d+\.?\d*)\s*(?:mg\/dL|mmol\/L)/i,

  // Liver Function Tests
  ALT: /(?:ALT|SGPT|Alanine Aminotransferase).*?(\d+\.?\d*)\s*(?:U\/L|IU\/L)/i,
  AST: /(?:AST|SGOT|Aspartate Aminotransferase).*?(\d+\.?\d*)\s*(?:U\/L|IU\/L)/i,
  ALP: /(?:ALP|Alkaline Phosphatase).*?(\d+\.?\d*)\s*(?:U\/L|IU\/L)/i,
  BILIRUBIN: /(?:BILT|Bilirubin|Total Bili).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,

  // Cardiac Markers
  TROPONIN: /(?:Troponin|Trop|HS-Troponin).*?(\d+\.?\d*)\s*(?:ng\/mL)/i,
  BNP: /(?:BNP|Brain Natriuretic Peptide).*?(\d+\.?\d*)\s*(?:pg\/mL)/i,

  // Lipid Panel
  CHOLESTEROL: /(?:Total Cholesterol|CHOL).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  HDL: /(?:HDL|High Density Lipoprotein).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  LDL: /(?:LDL|Low Density Lipoprotein).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
  TRIGLYCERIDES: /(?:Triglycerides|TRIG).*?(\d+\.?\d*)\s*(?:mg\/dL)/i,
};

/**
 * Reference ranges for common labs (for status determination)
 */
const REFERENCE_RANGES: Record<string, { min: number; max: number; unit: string }> = {
  WBC: { min: 4.0, max: 11.0, unit: 'K/µL' },
  RBC_M: { min: 4.5, max: 5.9, unit: 'M/µL' }, // Male
  RBC_F: { min: 4.0, max: 5.2, unit: 'M/µL' }, // Female
  HGB_M: { min: 13.5, max: 17.5, unit: 'g/dL' },
  HGB_F: { min: 12.0, max: 15.5, unit: 'g/dL' },
  HCT_M: { min: 38.0, max: 50.0, unit: '%' },
  HCT_F: { min: 36.0, max: 44.0, unit: '%' },
  PLT: { min: 150, max: 400, unit: 'K/µL' },
  GLUCOSE: { min: 70, max: 100, unit: 'mg/dL' },
  SODIUM: { min: 136, max: 145, unit: 'mEq/L' },
  POTASSIUM: { min: 3.5, max: 5.0, unit: 'mEq/L' },
  BUN: { min: 7, max: 20, unit: 'mg/dL' },
  CREATININE: { min: 0.6, max: 1.2, unit: 'mg/dL' },
  ALT: { min: 7, max: 56, unit: 'U/L' },
  AST: { min: 10, max: 40, unit: 'U/L' },
  TROPONIN: { min: 0, max: 0.04, unit: 'ng/mL' },
};

/**
 * Extract lab results from unstructured text
 */
export const extractLabResults = (text: string, date: string): LabPanel | null => {
  const results: LabResult[] = [];

  for (const [testName, pattern] of Object.entries(LAB_TEST_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1];
      const fullMatch = match[0];

      // Extract unit (found after the value)
      const unitMatch = fullMatch.match(/(\d+\.?\d*)\s*([\w\/µ\^]+)/);
      const unit = unitMatch ? unitMatch[2] : '';

      // Determine status
      const numericValue = parseFloat(value);
      let status: LabResult['status'] = 'Normal';

      const range = REFERENCE_RANGES[testName];
      if (range && !isNaN(numericValue)) {
        if (numericValue < range.min) {
          status = 'Low';
        } else if (numericValue > range.max) {
          status = 'High';
        }

        // Critical values
        if (testName === 'TROPONIN' && numericValue > 0.10) status = 'Critical';
        if (testName === 'POTASSIUM' && (numericValue < 3.0 || numericValue > 5.5)) status = 'Critical';
        if (testName === 'SODIUM' && (numericValue < 130 || numericValue > 150)) status = 'Critical';
      }

      results.push({
        testName,
        value,
        unit,
        referenceRange: range ? `${range.min}-${range.max}` : undefined,
        status,
        date
      });
    }
  }

  if (results.length === 0) return null;

  // Determine panel name based on tests found
  let panelName = 'Lab Results';
  const testNames = results.map(r => r.testName);

  if (testNames.some(t => ['WBC', 'RBC', 'HGB', 'HCT', 'PLT'].includes(t))) {
    panelName = 'Complete Blood Count (CBC)';
  } else if (testNames.some(t => ['GLUCOSE', 'SODIUM', 'BUN', 'CREATININE'].includes(t))) {
    panelName = 'Comprehensive Metabolic Panel (CMP)';
  } else if (testNames.some(t => ['ALT', 'AST', 'ALP', 'BILIRUBIN'].includes(t))) {
    panelName = 'Liver Function Tests (LFT)';
  } else if (testNames.some(t => ['TROPONIN', 'BNP'].includes(t))) {
    panelName = 'Cardiac Markers';
  }

  return {
    panelName,
    date,
    results
  };
};

/**
 * Format lab results as a markdown table (token-efficient)
 */
export const formatLabTable = (panel: LabPanel): string => {
  const rows = panel.results.map(r => {
    const statusEmoji =
      r.status === 'Critical' ? '🔴' :
      r.status === 'High' ? '⬆️' :
      r.status === 'Low' ? '⬇️' : '✅';

    return `| ${r.testName} | ${r.value} ${r.unit} | ${r.referenceRange || 'N/A'} | ${statusEmoji} ${r.status} |`;
  });

  return [
    `### 🧪 ${panel.panelName}`,
    `**Date**: ${panel.date}`,
    '',
    '| Test | Value | Reference Range | Status |',
    '|------|-------|----------------|--------|',
    ...rows,
    ''
  ].join('\n');
};

/**
 * Generate trend analysis comparing two lab panels
 */
export const generateTrendAnalysis = (
  current: LabPanel,
  previous: LabPanel
): string => {
  const trends: string[] = [];

  for (const currResult of current.results) {
    const prevResult = previous.results.find(r => r.testName === currResult.testName);
    if (!prevResult) continue;

    const currVal = parseFloat(currResult.value);
    const prevVal = parseFloat(prevResult.value);

    if (isNaN(currVal) || isNaN(prevVal)) continue;

    const change = currVal - prevVal;
    const percentChange = ((change / prevVal) * 100).toFixed(1);

    const direction = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    const significance = Math.abs(change / prevVal) > 0.10 ? '**' : '';

    trends.push(
      `- ${significance}${currResult.testName}${significance}: ${prevVal} → ${currVal} ` +
      `(${direction} ${percentChange}%)`
    );
  }

  if (trends.length === 0) return '';

  return [
    '#### Trends vs Previous',
    ...trends
  ].join('\n');
};
