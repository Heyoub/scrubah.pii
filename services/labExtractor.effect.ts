/**
 * LAB EXTRACTOR - EFFECT-TS VERSION
 *
 * Structured lab data extraction with algebraic effects.
 *
 * Architecture:
 * - Effect<Result, AppError, never> (pure computation)
 * - Railway-oriented programming (graceful degradation)
 * - Runtime validation via Effect Schema
 * - Immutable lab results
 *
 * OCaml equivalent:
 * module LabExtractor : sig
 *   val extract_lab_results : string -> string -> (lab_panel option, error) result
 *   val format_lab_table : lab_panel -> string
 *   val generate_trend_analysis : lab_panel -> lab_panel -> string
 * end
 */

import { Effect, pipe } from "effect";
import {
  LabResult,
  LabPanel,
  LabStatus,
  decodeLabPanel,
} from "../schemas";
import { LabExtractionError, ValidationError } from "./errors";

// ============================================================================
// LAB TEST PATTERNS
// ============================================================================

/**
 * Common lab test patterns with their variations
 */
const LAB_TEST_PATTERNS = {
  // Complete Blood Count (CBC)
  WBC: /(?:WBC|White Blood Cell|Leukocyte)[:\s]*(\d+(?:\.\d+)?)\s*(?:K\/µL|K\/uL|thou\/µL|x10\^3\/µL)/i,
  RBC: /(?:RBC|Red Blood Cell|Erythrocyte)[:\s]*(\d+(?:\.\d+)?)\s*(?:M\/µL|M\/uL|mill\/µL|x10\^6\/µL)/i,
  HGB: /(?:HGB|Hemoglobin|Hgb)[:\s]*(\d+(?:\.\d+)?)\s*(?:g\/dL|gm\/dL)/i,
  HCT: /(?:HCT|Hematocrit)[:\s]*(\d+(?:\.\d+)?)\s*(?:%|percent)/i,
  PLT: /(?:PLT|Platelet|Thrombocyte)[:\s]*(\d+(?:\.\d+)?)\s*(?:K\/µL|K\/uL|thou\/µL)/i,

  // Comprehensive Metabolic Panel (CMP)
  GLUCOSE: /(?:GLU|Glucose|Blood Sugar)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  SODIUM: /(?:NA|Sodium|Na\+)[:\s]*(\d+(?:\.\d+)?)\s*(?:mEq\/L|mmol\/L)/i,
  POTASSIUM: /(?:K|Potassium|K\+)[:\s]*(\d+(?:\.\d+)?)\s*(?:mEq\/L|mmol\/L)/i,
  CHLORIDE: /(?:CL|Chloride|Cl-)[:\s]*(\d+(?:\.\d+)?)\s*(?:mEq\/L|mmol\/L)/i,
  BUN: /(?:BUN|Blood Urea Nitrogen)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  CREATININE: /(?:CRT|Creatinine|Cr)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  CALCIUM: /(?:CA|Calcium)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL|mmol\/L)/i,

  // Liver Function Tests
  ALT: /(?:ALT|SGPT|Alanine Aminotransferase)[:\s]*(\d+(?:\.\d+)?)\s*(?:U\/L|IU\/L)/i,
  AST: /(?:AST|SGOT|Aspartate Aminotransferase)[:\s]*(\d+(?:\.\d+)?)\s*(?:U\/L|IU\/L)/i,
  ALP: /(?:ALP|Alkaline Phosphatase)[:\s]*(\d+(?:\.\d+)?)\s*(?:U\/L|IU\/L)/i,
  BILIRUBIN: /(?:BILT|Bilirubin|Total Bili)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,

  // Cardiac Markers
  TROPONIN: /(?:Troponin|Trop|HS-Troponin)[:\s]*(\d+(?:\.\d+)?)\s*(?:ng\/mL)/i,
  BNP: /(?:BNP|Brain Natriuretic Peptide)[:\s]*(\d+(?:\.\d+)?)\s*(?:pg\/mL)/i,

  // Lipid Panel
  CHOLESTEROL: /(?:Total Cholesterol|CHOL)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  HDL: /(?:HDL|High Density Lipoprotein)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  LDL: /(?:LDL|Low Density Lipoprotein)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
  TRIGLYCERIDES: /(?:Triglycerides|TRIG)[:\s]*(\d+(?:\.\d+)?)\s*(?:mg\/dL)/i,
} as const;

/**
 * Reference ranges for common labs (for status determination)
 */
interface ReferenceRange {
  readonly min: number;
  readonly max: number;
  readonly unit: string;
}

const REFERENCE_RANGES: Record<string, ReferenceRange> = {
  WBC: { min: 4.0, max: 11.0, unit: 'K/µL' },
  RBC_M: { min: 4.5, max: 5.9, unit: 'M/µL' },
  RBC_F: { min: 4.0, max: 5.2, unit: 'M/µL' },
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

// ============================================================================
// LAB EXTRACTION (Effect-based)
// ============================================================================

/**
 * Extract lab results from unstructured text
 *
 * Pure computation with Effect wrapper for error handling
 *
 * OCaml equivalent:
 * let extract_lab_results text date =
 *   let results = List.filter_map extract_single_test (get_patterns ()) in
 *   match results with
 *   | [] -> Ok None
 *   | rs -> Ok (Some { panel_name = detect_panel rs; date; results = rs })
 */
export const extractLabResults = (
  text: string,
  date: string
): Effect.Effect<LabPanel | null, LabExtractionError, never> => {
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
      let status: LabStatus = 'Normal';

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

  // No lab results found
  if (results.length === 0) {
    return Effect.succeed(null);
  }

  // Determine panel name based on tests found
  const testNames = results.map(r => r.testName);
  let panelName = 'Lab Results';

  if (testNames.some(t => ['WBC', 'RBC', 'HGB', 'HCT', 'PLT'].includes(t))) {
    panelName = 'Complete Blood Count (CBC)';
  } else if (testNames.some(t => ['GLUCOSE', 'SODIUM', 'BUN', 'CREATININE'].includes(t))) {
    panelName = 'Comprehensive Metabolic Panel (CMP)';
  } else if (testNames.some(t => ['ALT', 'AST', 'ALP', 'BILIRUBIN'].includes(t))) {
    panelName = 'Liver Function Tests (LFT)';
  } else if (testNames.some(t => ['TROPONIN', 'BNP'].includes(t))) {
    panelName = 'Cardiac Markers';
  }

  const panel: LabPanel = {
    panelName,
    date,
    results
  };

  return Effect.succeed(panel);
};

// ============================================================================
// LAB FORMATTING
// ============================================================================

/**
 * Format lab results as a markdown table (token-efficient)
 *
 * Pure computation
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
 *
 * Pure computation with Effect wrapper
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

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

/**
 * Legacy sync wrappers for existing non-Effect code
 *
 * These will be removed once all services are migrated to Effect
 */
export const extractLabResultsSync = (
  text: string,
  date: string
): LabPanel | null => {
  const result = Effect.runSync(extractLabResults(text, date));
  return result;
};
