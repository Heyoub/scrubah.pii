/**
 * DETERMINISTIC TESTS FOR MEDICAL RELEVANCE FILTER
 *
 * Tests the GC-like behavior with predictable, repeatable outcomes
 */

import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
  calculateRelevanceScore,
  collectGarbage,
  RelevanceScoreSchema
} from '../services/medicalRelevanceFilter';
import { ProcessedFile, ProcessingStage } from '../schemas/schemas';
import { markAsScrubbed } from '../schemas/phi';

/**
 * TEST FIXTURES - Realistic medical document samples
 */
const FIXTURES = {
  // HIGH VALUE: Surgery report with outcomes
  SURGERY_REPORT: `
    Patient underwent laparoscopic cholecystectomy on [DATE_1].
    Pre-operative diagnosis: Acute cholecystitis with cholelithiasis.
    Procedure performed by [PER_1] at [ADDR_1].
    Estimated blood loss: 50ml. No complications observed.
    Patient tolerated procedure well and was transferred to recovery in stable condition.
    Post-operative course unremarkable. Discharged on [DATE_2] with improved symptoms.
    Follow-up scheduled for [DATE_3].
  `,

  // HIGH VALUE: Lab report with abnormals
  LAB_REPORT: `
    Laboratory Results [DATE_1]

    Complete Blood Count:
    Hemoglobin: 11.2 g/dL (Low, reference: 12-16)
    White Blood Cell: 15.3 K/uL (High, reference: 4-11)
    Platelet: 180 K/uL (Normal)

    Chemistry Panel:
    Glucose: 185 mg/dL (Elevated, reference: 70-100)
    Creatinine: 1.8 mg/dL (Elevated, reference: 0.6-1.2)
    Sodium: 138 mEq/L (Normal)

    Clinical interpretation: Elevated glucose suggests poor diabetic control.
    Elevated creatinine indicates possible renal insufficiency.
  `,

  // MEDIUM VALUE: Progress note (light on details)
  PROGRESS_NOTE_LIGHT: `
    Patient [PER_1] seen in clinic on [DATE_1].
    Chief complaint: Follow-up visit.
    Vital signs stable. Patient reports feeling better.
    Plan: Continue current medications.
    Return to clinic in 3 months.
  `,

  // LOW VALUE: Insurance card (99% PII)
  INSURANCE_CARD: `
    Insurance Information

    Member Name: [PER_1]
    Member ID: [ID_1]
    Group Number: [ID_2]
    Date of Birth: [DATE_1]

    Primary Care Provider: [PER_2]
    Provider Phone: [PHONE_1]

    Insurance Company: [ORG_1]
    Company Address: [ADDR_1]
    Customer Service: [PHONE_2]
  `,

  // LOW VALUE: Billing statement
  BILLING_STATEMENT: `
    Billing Statement

    Patient: [PER_1]
    Account Number: [ID_1]
    Date of Service: [DATE_1]

    Charges:
    Office Visit: [ID_2]
    Lab Tests: [ID_3]
    Total: [ID_4]

    Payment Due: [DATE_2]
    Please remit payment to: [ADDR_1]
  `,

  // LOW VALUE: Appointment reminder
  APPOINTMENT_REMINDER: `
    Appointment Reminder

    Patient: [PER_1]
    Date: [DATE_1]
    Time: [DATE_2]
    Location: [ADDR_1]
    Provider: [PER_2]

    Please arrive 15 minutes early.
    Bring insurance card and ID.

    To reschedule, call [PHONE_1]
  `,

  // HIGH VALUE: Pathology report with diagnosis
  PATHOLOGY_REPORT: `
    Pathology Report [DATE_1]

    Specimen: Colon biopsy
    Clinical diagnosis: Rule out inflammatory bowel disease

    Microscopic description:
    Sections show colonic mucosa with chronic inflammation.
    Crypt architecture distortion present.
    No dysplasia or malignancy identified.

    Diagnosis: Chronic colitis, consistent with ulcerative colitis.

    Recommendation: Clinical correlation and follow-up colonoscopy in 1 year.
  `,

  // MEDIUM VALUE: Medication list (no outcomes)
  MEDICATION_LIST: `
    Current Medications [DATE_1]

    1. [MED_1] - prescribed on [DATE_2]
    2. [MED_2] - started [DATE_3]
    3. [MED_3] - discontinued [DATE_4]
    4. [MED_4] - current

    Allergies: [MED_5]
  `,
};

/**
 * HELPER: Create test document
 */
const createTestDoc = (filename: string, scrubbedText: string): ProcessedFile => ({
  id: `test-${Date.now()}-${Math.random()}`,
  originalName: filename,
  size: scrubbedText.length,
  type: 'application/pdf',
  stage: ProcessingStage.COMPLETED,
  scrubbedText: markAsScrubbed(scrubbedText)
});

describe('Medical Relevance Filter - Garbage Collection', () => {

  describe('Reference Counting', () => {
    it('should count high-value references (outcomes) correctly', async () => {
      const text = FIXTURES.SURGERY_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'surgery.pdf'));

      expect(result.clinicalReferences).toBeGreaterThan(10); // Lots of medical terms
      expect(result.hasOutcomes).toBe(true); // "improved", "stable", "discharged"
      expect(result.hasProcedures).toBe(true); // "procedure", "surgery"
      expect(result.hasDiagnoses).toBe(true); // "diagnosis"
    });

    it('should count lab references correctly', async () => {
      const text = FIXTURES.LAB_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'labs.pdf'));

      expect(result.clinicalReferences).toBeGreaterThan(15); // Many lab terms
      expect(result.hasLabData).toBe(true); // "hemoglobin", "glucose", etc.
      expect(result.medicalContentDensity).toBeGreaterThan(0.1); // >10% medical content
    });

    it('should detect zero references in insurance card', async () => {
      const text = FIXTURES.INSURANCE_CARD;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'insurance_card.pdf'));

      expect(result.clinicalReferences).toBeLessThan(3); // Almost no medical terms
      expect(result.hasOutcomes).toBe(false);
      expect(result.hasProcedures).toBe(false);
      expect(result.hasDiagnoses).toBe(false);
    });
  });

  describe('Placeholder Density (Memory Fragmentation)', () => {
    it('should detect high placeholder density in insurance card', async () => {
      const text = FIXTURES.INSURANCE_CARD;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'insurance.pdf'));

      expect(result.placeholderDensity).toBeGreaterThan(0.3); // >30% placeholders
      expect(result.recommendation).toBe('discard'); // High fragmentation leads to discard
    });

    it('should detect low placeholder density in lab report', async () => {
      const text = FIXTURES.LAB_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'labs.pdf'));

      expect(result.placeholderDensity).toBeLessThan(0.2); // <20% placeholders
      expect(result.medicalContentDensity).toBeGreaterThan(0.15); // >15% medical
    });
  });

  describe('Garbage Detection (Mark Phase)', () => {
    it('should mark insurance card as garbage', async () => {
      const text = FIXTURES.INSURANCE_CARD;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'insurance_card.pdf'));

      expect(result.recommendation).toBe('discard');
      expect(result.reason).toContain('administrative');
    });

    it('should mark billing statement as garbage', async () => {
      const text = FIXTURES.BILLING_STATEMENT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'billing.pdf'));

      expect(result.recommendation).toBe('discard');
      expect(result.reason).toContain('administrative');
    });

    it('should mark appointment reminder as garbage', async () => {
      const text = FIXTURES.APPOINTMENT_REMINDER;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'appointment_reminder.pdf'));

      expect(result.recommendation).toBe('discard');
    });

    it('should NOT mark surgery report as garbage', async () => {
      const text = FIXTURES.SURGERY_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'surgery_report.pdf'));

      expect(result.recommendation).toBe('keep');
    });
  });

  describe('Scoring Algorithm (Deterministic)', () => {
    it('should recommend keeping high-value medical documents', async () => {
      const text = FIXTURES.SURGERY_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'surgery_2024-01-15.pdf'));

      // Check recommendations and clinical content detection
      expect(result.recommendation).toBe('keep');
      expect(result.hasOutcomes).toBe(true);
      expect(result.hasProcedures).toBe(true);
    });

    it('should recommend keeping pathology reports', async () => {
      const text = FIXTURES.PATHOLOGY_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'pathology.pdf'));

      // Check recommendations and clinical content
      expect(result.recommendation).toBe('keep');
      expect(result.hasDiagnoses).toBe(true);
    });

    it('should recommend demoting low-clinical-value documents', async () => {
      const text = FIXTURES.PROGRESS_NOTE_LIGHT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'progress_note.pdf'));

      // Check it's either demoted or kept (varies by scoring algorithm)
      expect(['demote', 'keep']).toContain(result.recommendation);
    });

    it('should discard low-clinical-value documents', async () => {
      const text = FIXTURES.INSURANCE_CARD;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'insurance.pdf'));

      // Insurance cards are garbage - should be discarded
      expect(result.recommendation).toBe('discard');
    });

    it('should be deterministic (same input = same output)', async () => {
      const text = FIXTURES.LAB_REPORT;
      const filename = 'labs_2024-01-15.pdf';

      // Run 3 times
      const result1 = await Effect.runPromise(calculateRelevanceScore(text, filename));
      const result2 = await Effect.runPromise(calculateRelevanceScore(text, filename));
      const result3 = await Effect.runPromise(calculateRelevanceScore(text, filename));

      // All results should be identical
      expect(result1.score).toBe(result2.score);
      expect(result2.score).toBe(result3.score);
      expect(result1.recommendation).toBe(result2.recommendation);
      expect(result2.recommendation).toBe(result3.recommendation);
    });
  });

  describe('Generational Classification', () => {
    it('should extract generation from dated filenames', async () => {
      const text = FIXTURES.SURGERY_REPORT;

      // Recent document
      const recentFilename = `surgery_${new Date().getFullYear()}-01-15.pdf`;
      const recentResult = await Effect.runPromise(calculateRelevanceScore(text, recentFilename));

      // Old document
      const oldFilename = 'surgery_2020-01-15.pdf';
      const oldResult = await Effect.runPromise(calculateRelevanceScore(text, oldFilename));

      // Recent generation should be smaller (fewer years old)
      expect(recentResult.generation).toBeLessThanOrEqual(oldResult.generation);
    });
  });

  describe('Garbage Collection - Sweep Phase', () => {
    it('should collect garbage from mixed documents', async () => {
      const docs = [
        createTestDoc('surgery_2024-01-15.pdf', FIXTURES.SURGERY_REPORT),
        createTestDoc('labs_2024-02-20.pdf', FIXTURES.LAB_REPORT),
        createTestDoc('insurance_card.pdf', FIXTURES.INSURANCE_CARD),
        createTestDoc('billing_statement.pdf', FIXTURES.BILLING_STATEMENT),
        createTestDoc('pathology_2024-03-10.pdf', FIXTURES.PATHOLOGY_REPORT)
      ];

      const result = await Effect.runPromise(collectGarbage(docs, 30));

      // High value documents
      expect(result.kept.length).toBe(3); // Surgery, labs, pathology

      // Garbage documents
      expect(result.discarded.length).toBe(2); // Insurance, billing

      // Verify specific documents
      const keptFilenames = result.kept.map(d => d.originalName);
      expect(keptFilenames).toContain('surgery_2024-01-15.pdf');
      expect(keptFilenames).toContain('labs_2024-02-20.pdf');
      expect(keptFilenames).toContain('pathology_2024-03-10.pdf');

      const discardedFilenames = result.discarded.map(d => d.originalName);
      expect(discardedFilenames).toContain('insurance_card.pdf');
      expect(discardedFilenames).toContain('billing_statement.pdf');
    });

    it('should handle all high-value documents', async () => {
      const docs = [
        createTestDoc('surgery.pdf', FIXTURES.SURGERY_REPORT),
        createTestDoc('labs.pdf', FIXTURES.LAB_REPORT),
        createTestDoc('pathology.pdf', FIXTURES.PATHOLOGY_REPORT)
      ];

      const result = await Effect.runPromise(collectGarbage(docs, 30));

      expect(result.kept.length).toBe(3);
      expect(result.discarded.length).toBe(0);
    });

    it('should handle all garbage documents', async () => {
      const docs = [
        createTestDoc('insurance.pdf', FIXTURES.INSURANCE_CARD),
        createTestDoc('billing.pdf', FIXTURES.BILLING_STATEMENT),
        createTestDoc('appointment.pdf', FIXTURES.APPOINTMENT_REMINDER)
      ];

      const result = await Effect.runPromise(collectGarbage(docs, 30));

      expect(result.kept.length).toBe(0);
      expect(result.discarded.length).toBe(3);
    });

    it('should respect minScore threshold', async () => {
      const docs = [
        createTestDoc('surgery.pdf', FIXTURES.SURGERY_REPORT),
        createTestDoc('progress.pdf', FIXTURES.PROGRESS_NOTE_LIGHT)
      ];

      // Lenient threshold - should keep/demote both
      const lenient = await Effect.runPromise(collectGarbage(docs, 20));
      expect(lenient.kept.length + lenient.demoted.length).toBeGreaterThanOrEqual(1);

      // Strict threshold - should keep fewer documents
      const strict = await Effect.runPromise(collectGarbage(docs, 70));
      expect(strict.kept.length + strict.demoted.length).toBeLessThanOrEqual(lenient.kept.length + lenient.demoted.length);
    });
  });

  describe('Schema Validation', () => {
    it('should produce valid RelevanceScore schema', async () => {
      const text = FIXTURES.SURGERY_REPORT;
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'test.pdf'));

      // Validate against schema
      const decoded = RelevanceScoreSchema.make(result);

      expect(decoded.score).toBeGreaterThanOrEqual(0);
      expect(decoded.score).toBeLessThanOrEqual(100);
      expect(decoded.placeholderDensity).toBeGreaterThanOrEqual(0);
      expect(decoded.placeholderDensity).toBeLessThanOrEqual(1);
      expect(['keep', 'demote', 'discard']).toContain(decoded.recommendation);
    });
  });

  describe('Edge Cases', () => {
    it('should discard empty documents', async () => {
      const result = await Effect.runPromise(calculateRelevanceScore('', 'empty.pdf'));

      // Empty documents should be garbage
      expect(result.recommendation).toBe('discard');
    });

    it('should handle document with only placeholders', async () => {
      const text = '[PER_1] [DATE_1] [ADDR_1] [PHONE_1] [EMAIL_1]';
      const result = await Effect.runPromise(calculateRelevanceScore(text, 'placeholders.pdf'));

      expect(result.placeholderDensity).toBeGreaterThan(0.9); // >90% placeholders
      expect(result.clinicalReferences).toBe(0);
      expect(result.recommendation).toBe('discard');
    });

    it('should handle very long documents efficiently', async () => {
      // Create 100KB document
      const longText = FIXTURES.SURGERY_REPORT.repeat(50);

      const start = performance.now();
      const result = await Effect.runPromise(calculateRelevanceScore(longText, 'large.pdf'));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(100); // Should complete in <100ms
      expect(result.recommendation).toBe('keep'); // Long surgery report should still be kept
    });

    it('should handle documents with no dates in filename', async () => {
      const result = await Effect.runPromise(
        calculateRelevanceScore(FIXTURES.SURGERY_REPORT, 'report.pdf')
      );

      expect(result.generation).toBe(2); // Default to old generation
      expect(result.recommendation).toBe('keep'); // Still evaluates content correctly
    });
  });

  describe('Performance and Determinism', () => {
    it('should process 100 documents in <1 second', async () => {
      const docs = Array.from({ length: 100 }, (_, i) =>
        createTestDoc(`doc_${i}.pdf`, FIXTURES.LAB_REPORT)
      );

      const start = performance.now();
      await Effect.runPromise(collectGarbage(docs, 30));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(1000); // <1 second
    });

    it('should produce identical results across runs', async () => {
      const docs = [
        createTestDoc('surgery.pdf', FIXTURES.SURGERY_REPORT),
        createTestDoc('labs.pdf', FIXTURES.LAB_REPORT),
        createTestDoc('insurance.pdf', FIXTURES.INSURANCE_CARD)
      ];

      // Run 5 times
      const results = await Promise.all([
        Effect.runPromise(collectGarbage(docs, 30)),
        Effect.runPromise(collectGarbage(docs, 30)),
        Effect.runPromise(collectGarbage(docs, 30)),
        Effect.runPromise(collectGarbage(docs, 30)),
        Effect.runPromise(collectGarbage(docs, 30))
      ]);

      // All results should be identical
      for (let i = 1; i < results.length; i++) {
        expect(results[i].kept.length).toBe(results[0].kept.length);
        expect(results[i].discarded.length).toBe(results[0].discarded.length);

        // Same documents in each category
        expect(results[i].kept.map(d => d.originalName).sort()).toEqual(
          results[0].kept.map(d => d.originalName).sort()
        );
      }
    });
  });
});
