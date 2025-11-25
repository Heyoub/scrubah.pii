/**
 * MEDICAL EXTRACTOR TESTS
 *
 * Demonstrates whitelist extraction approach vs blacklist scrubbing.
 * Run with: pnpm test whiteListExtractor.test.ts
 */

import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { extractMedicalData } from "../services/whitelist/services/medicalExtractor.effect";
import { formatMedicalTimeline } from "../services/whitelist/services/timelineFormatter.effect";
import { runExtractionPipeline } from "../services/whitelist/services/extractionPipeline.effect";

// ============================================================================
// TEST DATA - Simulates the leaked content from your timeline
// ============================================================================

const SAMPLE_LAB_REPORT = `
Patient Name: John Smith
DOB: 05/15/1985
MRN: 123456789
Date: 11/20/2025

COMPLETE BLOOD COUNT

WBC: 8.5 K/uL (Reference: 4.0-11.0)
RBC: 4.8 M/uL
Hemoglobin: 13.2 g/dL (Reference: 13.5-17.5)
Hematocrit: 39%
Platelets: 245 K/uL

COMPREHENSIVE METABOLIC PANEL

Glucose: 95 mg/dL
BUN: 15 mg/dL
Creatinine: 0.9 mg/dL
Sodium: 140 mEq/L
Potassium: 4.2 mEq/L

Reviewed by: Dr. Sarah Johnson, M.D.
Phone: 555-0100
Lab License: LAB123456
`;

const SAMPLE_IMAGING_REPORT = `
MRI Lumbar Spine without Contrast
Date: 04/15/2025

Patient: DOE, JANEB05/15/1985FIN9876543MRN987654

HISTORY: Low back pain. Fall one week ago.

TECHNIQUE: Multiplanar MRI images acquired on 1.5T unit.

FINDINGS:
- Mild decrease in lumbar lordosis
- Vertebral bodies normal in height and alignment
- No focal bone marrow lesion or edema
- At L3-L4: mild posterior disc bulge with bilateral facet degeneration
- At L4-L5: mild posterior bulge causing mild to moderate canal narrowing
- At L5-S1: asymmetric right-sided disc protrusion

IMPRESSION:
Multilevel degenerative changes. Moderate canal narrowing at L4-L5.
No acute fracture or significant neural foraminal stenosis.

Interpreted by: Robert Smith, M.D.
Signed by: Johnson RN, Sarah
Location: Example Medical Center Radiology
`;

const SAMPLE_PATHOLOGY_REPORT = `
PATHOLOGY REPORT

Specimen: Gastric biopsy
Collection Date: 10/31/2025

DIAGNOSIS:
Poorly differentiated signet ring cell adenocarcinoma

GRADE: High grade (Grade 3)
STAGE: Stage IV metastatic disease

MARGINS: Not applicable (biopsy specimen)

MARKERS:
- HER2: Negative
- PD-L1: Positive (CPS 15)
- MSI: Microsatellite stable

Clinical Correlation:
Family member present during consultation.
Plan for palliative radiation and outpatient chemotherapy.

Pathologist: Jennifer Williams M.D.
Contact: pathology@example.invalid
`;

// ============================================================================
// EXTRACTION TESTS
// ============================================================================

describe("Medical Extractor - Whitelist Approach", () => {
  
  describe("Lab Report Extraction", () => {
    it("should extract lab values without capturing PII", async () => {
      const result = await Effect.runPromise(
        extractMedicalData({
          text: SAMPLE_LAB_REPORT,
          filename: "lab_report_2025-11-20.pdf",
          documentHash: "abc123",
        })
      );
      
      // Should extract lab results
      expect(result.labPanels.length).toBeGreaterThan(0);
      const labResults = result.labPanels[0].results;
      
      // Should have specific lab values
      const wbc = labResults.find(r => r.testName === "WBC");
      expect(wbc).toBeDefined();
      expect(wbc?.value).toBe("8.5");
      expect(wbc?.status).toBe("normal");
      
      const hgb = labResults.find(r => r.testName === "HGB");
      expect(hgb).toBeDefined();
      expect(hgb?.value).toBe("13.2");
      expect(hgb?.status).toBe("low"); // Below 13.5 reference
      
      // Should classify as lab report
      expect(result.documentType).toBe("lab_report");
      
      // The output should NOT contain any of these PII items
      const outputStr = JSON.stringify(result);
      expect(outputStr).not.toContain("John Smith");
      expect(outputStr).not.toContain("05/15/1985");
      expect(outputStr).not.toContain("123456789");
      expect(outputStr).not.toContain("Sarah Johnson");
      expect(outputStr).not.toContain("555-0100");
      expect(outputStr).not.toContain("LAB123456");
    });
    
    it("should determine correct lab status", async () => {
      const result = await Effect.runPromise(
        extractMedicalData({
          text: SAMPLE_LAB_REPORT,
          filename: "test.pdf",
          documentHash: "test123",
        })
      );
      
      const labResults = result.labPanels[0]?.results || [];
      
      // WBC 8.5 should be normal (4.0-11.0)
      const wbc = labResults.find(r => r.testName === "WBC");
      expect(wbc?.status).toBe("normal");
      
      // HGB 13.2 should be low (ref 13.5-17.5)
      const hgb = labResults.find(r => r.testName === "HGB");
      expect(hgb?.status).toBe("low");
      
      // Glucose 95 should be normal (70-100)
      const glucose = labResults.find(r => r.testName === "Glucose");
      expect(glucose?.status).toBe("normal");
    });
  });
  
  describe("Imaging Report Extraction", () => {
    it("should extract imaging findings without capturing concatenated PII", async () => {
      const result = await Effect.runPromise(
        extractMedicalData({
          text: SAMPLE_IMAGING_REPORT,
          filename: "mri_lumbar_2025-04-15.pdf",
          documentHash: "def456",
        })
      );
      
      // Should classify as imaging
      expect(result.documentType).toBe("imaging");
      
      // Should extract imaging findings
      expect(result.imagingFindings.length).toBeGreaterThan(0);
      const finding = result.imagingFindings[0];
      expect(finding.modality).toBe("mri");
      expect(finding.bodyPart.toLowerCase()).toContain("lumbar");
      
      // Should have findings
      expect(finding.findings.length).toBeGreaterThan(0);
      
      // The output should NOT contain these PII items
      const outputStr = JSON.stringify(result);
      expect(outputStr).not.toContain("DOE");
      expect(outputStr).not.toContain("JANE");
      expect(outputStr).not.toContain("Robert Smith");
      expect(outputStr).not.toContain("Johnson");
      expect(outputStr).not.toContain("Sarah");
      expect(outputStr).not.toContain("Example Medical Center");
    });
  });
  
  describe("Pathology Report Extraction", () => {
    it("should extract pathology findings without capturing names", async () => {
      const result = await Effect.runPromise(
        extractMedicalData({
          text: SAMPLE_PATHOLOGY_REPORT,
          filename: "pathology_2025-10-31.pdf",
          documentHash: "ghi789",
        })
      );
      
      // Should classify as pathology
      expect(result.documentType).toBe("pathology");
      
      // Should extract pathology results
      expect(result.pathology.length).toBeGreaterThan(0);
      const pathResult = result.pathology[0];
      
      expect(pathResult.diagnosis).toContain("adenocarcinoma");
      expect(pathResult.specimenType.toLowerCase()).toContain("gastric");
      
      // Should extract diagnoses
      expect(result.diagnoses.length).toBeGreaterThan(0);
      
      // The output should NOT contain these PII items
      const outputStr = JSON.stringify(result);
      expect(outputStr).not.toContain("Family member");
      expect(outputStr).not.toContain("Jennifer");
      expect(outputStr).not.toContain("Williams");
      expect(outputStr).not.toContain("pathology@example.invalid");
    });
  });
  
  describe("Full Pipeline", () => {
    it("should generate clean timeline from multiple documents", async () => {
      const result = await Effect.runPromise(
        runExtractionPipeline({
          documents: [
            { id: "1", filename: "lab.pdf", rawText: SAMPLE_LAB_REPORT },
            { id: "2", filename: "mri.pdf", rawText: SAMPLE_IMAGING_REPORT },
            { id: "3", filename: "path.pdf", rawText: SAMPLE_PATHOLOGY_REPORT },
          ],
          timelineTitle: "Test Patient Timeline",
        })
      );
      
      // Should have markdown output
      expect(result.markdown).toBeDefined();
      expect(result.markdown.length).toBeGreaterThan(100);
      
      // Should have stats
      expect(result.extraction.stats.totalDocuments).toBe(3);
      expect(result.extraction.stats.successfulExtractions).toBe(3);
      
      // The markdown should NOT contain any PII
      expect(result.markdown).not.toContain("John Smith");
      expect(result.markdown).not.toContain("DOE");
      expect(result.markdown).not.toContain("Family member");
      expect(result.markdown).not.toContain("Sarah Johnson");
      expect(result.markdown).not.toContain("Jennifer Williams");
      expect(result.markdown).not.toContain("Johnson");
      expect(result.markdown).not.toContain("Example Medical Center");
      expect(result.markdown).not.toContain("555-0");
      expect(result.markdown).not.toContain("LAB123456");
      expect(result.markdown).not.toContain("pathology@example.invalid");
      
      // But SHOULD contain clinical data
      expect(result.markdown).toContain("WBC");
      expect(result.markdown).toContain("8.5");
      expect(result.markdown).toContain("adenocarcinoma");
      expect(result.markdown).toContain("lumbar");
    });
  });
});

// ============================================================================
// COMPARISON: Old Scrubbing vs New Extraction
// ============================================================================

describe("Scrubbing vs Extraction Comparison", () => {
  
  it("demonstrates why whitelist is safer than blacklist", () => {
    // This is the problematic text that leaked through the scrubber
    const problematicText = "DOE,JANEB05/15/1985FIN9876543MRN987654";
    
    // OLD APPROACH (blacklist): Try to find and remove PII
    // Problem: The text is concatenated, so patterns don't match
    const ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    const phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    const dobPattern = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/;
    
    // These patterns DON'T match the concatenated text!
    expect(ssnPattern.test(problematicText)).toBe(false);
    expect(phonePattern.test(problematicText)).toBe(false);
    expect(dobPattern.test(problematicText)).toBe(false);
    
    // NEW APPROACH (whitelist): Only extract what we want
    // We never even try to process this text - we only extract structured data
    // The name "DOE, JANE" never makes it into our output because
    // we only extract lab values, diagnoses, medications, etc.
    
    // The whitelist approach is fundamentally safer because PII
    // is excluded by design, not by detection
  });
  
  it("shows the extractor ignores PII by design", async () => {
    // Text with lots of PII mixed in
    const mixedText = `
      Patient: John Smith, DOB 01/15/1980, SSN 123-45-6789
      Phone: (555) 123-4567, Email: john@example.com
      Address: 123 Main Street, Anytown, PA 19001
      
      Lab Results:
      WBC: 7.5 K/uL
      Hemoglobin: 14.0 g/dL
      Glucose: 110 mg/dL
      
      Diagnosis: Type 2 Diabetes Mellitus
      
      Signed by: Dr. Jane Doe, M.D.
    `;
    
    const result = await Effect.runPromise(
      extractMedicalData({
        text: mixedText,
        filename: "test.pdf",
        documentHash: "test",
      })
    );
    
    // Should extract clinical data
    expect(result.labPanels.length).toBeGreaterThan(0);
    expect(result.diagnoses.length).toBeGreaterThan(0);
    
    // The output should be clean
    const output = JSON.stringify(result);
    
    // None of this should be in the output:
    expect(output).not.toContain("John Smith");
    expect(output).not.toContain("01/15/1980");
    expect(output).not.toContain("123-45-6789");
    expect(output).not.toContain("555");
    expect(output).not.toContain("john@example.com");
    expect(output).not.toContain("123 Main Street");
    expect(output).not.toContain("Jane Doe");
    
    // But clinical data should be present:
    expect(output).toContain("7.5");
    expect(output).toContain("14.0");
    expect(output).toContain("Diabetes");
  });
});
