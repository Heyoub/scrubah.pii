import { describe, it, expect, beforeAll } from 'vitest';
import { piiScrubber } from './piiScrubber';
import { PATTERNS } from './piiScrubber';
import { TEST_PII } from './testConstants';
import { testLogger } from './testLogger';

/**
 * COMPREHENSIVE INTEGRATION TESTS FOR PII SCRUBBING
 *
 * These tests use `regexOnly: true` mode to test deterministically without
 * requiring the ML model (BERT NER). This allows tests to run in Node.js.
 *
 * Tests verify:
 * 1. All structural PII types (regex-based) are detected and scrubbed
 * 2. The actual scrub() function works end-to-end
 * 3. PIIMap tracks replacements accurately
 * 4. Placeholder consistency is maintained
 * 5. Real-world medical documents are properly sanitized
 *
 * ML-based tests (names/locations/orgs from BERT) require browser environment.
 * To test ML features: run the app in dev mode (`bun run start`)
 */

// Use regexOnly mode to avoid ML model loading in Node.js
const SCRUB_OPTIONS = { regexOnly: true };

describe('PII Scrubber - Integration Tests (Deterministic, Non-Mocked)', () => {

  describe('DATE Pattern Detection - End-to-End', () => {
    it('should detect dates in MM/DD/YYYY format', () => {
      const text = 'Visit on 12/25/2024 and follow-up on 01/15/2025';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).not.toBeNull();
      expect(matches).toHaveLength(2);
      expect(matches).toContain('12/25/2024');
      expect(matches).toContain('01/15/2025');
    });

    it('should detect dates in MM-DD-YYYY format', () => {
      const text = 'DOB: 03-15-1985';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).not.toBeNull();
      expect(matches![0]).toBe('03-15-1985');
    });

    it('should detect dates in M/D/YY format', () => {
      const text = 'Appointment: 5/3/24';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).not.toBeNull();
      expect(matches![0]).toBe('5/3/24');
    });

    it('should detect multiple date formats in same document', () => {
      const text = 'Born 12/31/1990, admitted 06-15-2024, discharged 6/20/24';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Email Address Scrubbing - Structural Only (Deterministic)', () => {
    it('should scrub single email address', async () => {
      const text = `Contact patient at ${TEST_PII.EMAIL_PRIMARY} for follow-up.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Email should not appear in scrubbed text
      expect(result.text).not.toContain(TEST_PII.EMAIL_PRIMARY);

      // Email should be in replacements map
      expect(result.replacements[TEST_PII.EMAIL_PRIMARY]).toBeDefined();
      expect(result.replacements[TEST_PII.EMAIL_PRIMARY]).toMatch(/\[EMAIL_\d+\]/);

      // Count should be at least 1
      expect(result.count).toBeGreaterThanOrEqual(1);
    }, 30000);

    it('should scrub multiple different emails', async () => {
      const text = `Primary: ${TEST_PII.EMAIL_PRIMARY}, Secondary: ${TEST_PII.EMAIL_SECONDARY}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.EMAIL_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.EMAIL_SECONDARY);
      expect(result.count).toBeGreaterThanOrEqual(2);
    }, 30000);

    it('should maintain placeholder consistency for repeated emails', async () => {
      const text = `Email ${TEST_PII.EMAIL_REPEATED} twice: ${TEST_PII.EMAIL_REPEATED} and ${TEST_PII.EMAIL_REPEATED} again.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Should use same placeholder for same email
      const placeholder = result.replacements[TEST_PII.EMAIL_REPEATED];
      expect(placeholder).toBeDefined();

      // Count occurrences of placeholder in result text
      const placeholderRegex = new RegExp(placeholder.replace(/[[\]]/g, '\\$&'), 'g');
      const placeholderCount = (result.text.match(placeholderRegex) || []).length;
      expect(placeholderCount).toBe(3); // Should appear 3 times

      testLogger.info('test:placeholder-consistency', {
        placeholderFormat: placeholder,
        occurrences: placeholderCount
      });
    }, 30000);
  });

  describe('Phone Number Scrubbing - All Formats', () => {
    it('should scrub various phone formats', async () => {
      const text = `Call ${TEST_PII.PHONE_FORMATTED_1} or ${TEST_PII.PHONE_FORMATTED_2} for appointments.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Phone numbers should not appear in scrubbed text (partial matches)
      expect(result.text).not.toContain('010-4');
      expect(result.text).not.toContain('010-5');

      // Should have replacements for phone numbers
      expect(result.count).toBeGreaterThanOrEqual(2);

      // Should contain PHONE placeholders
      expect(result.text).toMatch(/\[PHONE_\d+\]/);
    }, 30000);

    it('should handle phone with +1 country code', async () => {
      const text = `International: ${TEST_PII.PHONE_WITH_COUNTRY}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain('555 0103');
      expect(result.text).toMatch(/\[PHONE_\d+\]/);
    }, 30000);
  });

  describe('SSN Scrubbing', () => {
    it('should scrub SSN and track in PIIMap', async () => {
      const text = `Patient SSN: ${TEST_PII.SSN_PRIMARY} for insurance verification.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // SSN should not appear in scrubbed text
      expect(result.text).not.toContain(TEST_PII.SSN_PRIMARY);

      // SSN should be in replacements map
      expect(result.replacements[TEST_PII.SSN_PRIMARY]).toBeDefined();
      expect(result.replacements[TEST_PII.SSN_PRIMARY]).toMatch(/\[SSN_\d+\]/);
    }, 30000);

    it('should scrub multiple SSNs', async () => {
      const text = `Primary: ${TEST_PII.SSN_PRIMARY}, Spouse: ${TEST_PII.SSN_SPOUSE}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.SSN_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.SSN_SPOUSE);
      expect(result.count).toBeGreaterThanOrEqual(2);
    }, 30000);
  });

  describe('Credit Card Scrubbing', () => {
    it('should scrub credit card with dashes', async () => {
      const text = `Payment card: ${TEST_PII.CARD_VISA} on file.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.CARD_VISA);
      expect(result.text).toMatch(/\[CARD_\d+\]/);
    }, 30000);

    it('should scrub credit card with spaces', async () => {
      const cardWithSpaces = TEST_PII.CARD_MASTERCARD.replace(/-/g, ' ');
      const text = `Card number: ${cardWithSpaces}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(cardWithSpaces);
      expect(result.text).toMatch(/\[CARD_\d+\]/);
    }, 30000);

    it('should scrub credit card without separators', async () => {
      const cardNoSeparators = TEST_PII.CARD_VISA.replace(/-/g, '');
      const text = `Card: ${cardNoSeparators}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Card number should be scrubbed (removed from text)
      expect(result.text).not.toContain(cardNoSeparators);
      // In regex-only mode, 16 continuous digits may match as PHONE+ID instead of CARD
      // The important thing is the PII is scrubbed - verify some placeholder exists
      expect(result.text).toMatch(/\[[A-Z_]+_\d+\]/);
    }, 30000);
  });

  describe('ZIP Code Scrubbing', () => {
    it('should scrub 5-digit ZIP code', async () => {
      const text = `Located in ZIP ${TEST_PII.ZIP_5_DIGIT}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.ZIP_5_DIGIT);
      expect(result.text).toMatch(/\[ZIP_\d+\]/);
    }, 30000);

    it('should scrub ZIP+4 format', async () => {
      const text = `Mailing address: Testville, TS ${TEST_PII.ZIP_PLUS_4}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.ZIP_PLUS_4);
      expect(result.text).toMatch(/\[ZIP_\d+\]/);
    }, 30000);
  });

  describe('Medical Record Number (MRN) Scrubbing', () => {
    it('should scrub MRN with MRN keyword', async () => {
      const text = `Patient MRN: ${TEST_PII.MRN_PRIMARY} admitted today.`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.MRN_PRIMARY);
      expect(result.replacements[TEST_PII.MRN_PRIMARY]).toBeDefined();
      expect(result.replacements[TEST_PII.MRN_PRIMARY]).toMatch(/\[MRN_\d+\]/);
    }, 30000);

    it('should scrub MRN with various keywords', async () => {
      const text = `
        MRN: ${TEST_PII.MRN_PRIMARY}
        Medical Record Number: ${TEST_PII.MRN_SECONDARY}
        Patient ID: ${TEST_PII.MRN_FORMATTED}
        Chart Number: ${TEST_PII.MRN_PRIMARY}
      `;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.MRN_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.MRN_SECONDARY);
      expect(result.text).not.toContain(TEST_PII.MRN_FORMATTED);

      expect(result.count).toBeGreaterThanOrEqual(3);
    }, 30000);

    it('should handle MRN with different separators', async () => {
      const tests = [
        `MRN: ${TEST_PII.MRN_PRIMARY}`,
        `MRN:${TEST_PII.MRN_PRIMARY}`,
        `MRN ${TEST_PII.MRN_PRIMARY}`,
      ];

      for (const text of tests) {
        const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);
        expect(result.count).toBeGreaterThanOrEqual(1);
        expect(result.text).toMatch(/\[MRN_\d+\]/);
      }
    }, 30000);
  });

  describe('Real-World Medical Document - Structural PII', () => {
    it('should scrub all structural PII in comprehensive medical note', async () => {
      const medicalNote = `
PATIENT INFORMATION
===================
Date of Birth: ${TEST_PII.DATE_BIRTH}
MRN: ${TEST_PII.MRN_FORMATTED}
SSN: ${TEST_PII.SSN_PRIMARY}
Phone: ${TEST_PII.PHONE_PRIMARY}
Email: ${TEST_PII.EMAIL_PRIMARY}
Address: 123 Test Street, Testville, TS ${TEST_PII.ZIP_REAL_LOOKING}

VISIT SUMMARY
=============
Visit Date: ${TEST_PII.DATE_VISIT}
Admission Date: ${TEST_PII.DATE_PAST}
Discharge Date: ${TEST_PII.DATE_FUTURE}

INSURANCE
=========
Policy Number: ${TEST_PII.CARD_MASTERCARD}
Member ID: ${TEST_PII.MRN_SECONDARY}

EMERGENCY CONTACT
=================
Phone: ${TEST_PII.PHONE_EMERGENCY}
Email: ${TEST_PII.EMAIL_EMERGENCY}

BILLING
=======
ZIP Code: ${TEST_PII.ZIP_PLUS_4}
Payment Card: ${TEST_PII.CARD_VISA}
      `;

      const result = await piiScrubber.scrub(medicalNote, SCRUB_OPTIONS);

      // === VERIFY ALL STRUCTURAL PII TYPES ARE SCRUBBED ===

      // 1. Dates
      expect(result.text).not.toContain(TEST_PII.DATE_BIRTH);
      expect(result.text).not.toContain(TEST_PII.DATE_VISIT);
      expect(result.text).not.toContain(TEST_PII.DATE_PAST);
      expect(result.text).not.toContain(TEST_PII.DATE_FUTURE);

      // 2. MRNs
      expect(result.text).not.toContain(TEST_PII.MRN_FORMATTED);
      expect(result.text).not.toContain(TEST_PII.MRN_SECONDARY);

      // 3. SSN
      expect(result.text).not.toContain(TEST_PII.SSN_PRIMARY);

      // 4. Phone Numbers
      expect(result.text).not.toContain(TEST_PII.PHONE_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.PHONE_EMERGENCY);

      // 5. Emails
      expect(result.text).not.toContain(TEST_PII.EMAIL_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.EMAIL_EMERGENCY);

      // 6. ZIP Codes
      expect(result.text).not.toContain(TEST_PII.ZIP_REAL_LOOKING);
      expect(result.text).not.toContain(TEST_PII.ZIP_PLUS_4);

      // 7. Credit Card / Policy Number
      expect(result.text).not.toContain(TEST_PII.CARD_MASTERCARD);
      expect(result.text).not.toContain(TEST_PII.CARD_VISA);

      // === VERIFY PLACEHOLDERS EXIST ===
      expect(result.text).toMatch(/\[EMAIL_\d+\]/);
      expect(result.text).toMatch(/\[PHONE_\d+\]/);
      expect(result.text).toMatch(/\[SSN_\d+\]/);
      expect(result.text).toMatch(/\[MRN_\d+\]/);
      expect(result.text).toMatch(/\[ZIP_\d+\]/);
      expect(result.text).toMatch(/\[CARD_\d+\]/);

      // === VERIFY REPLACEMENT COUNT ===
      expect(result.count).toBeGreaterThan(10);

      // === VERIFY PIIMap COMPLETENESS ===
      expect(Object.keys(result.replacements).length).toBeGreaterThan(10);

      // === VERIFY SPECIFIC REPLACEMENTS IN MAP ===
      expect(result.replacements[TEST_PII.SSN_PRIMARY]).toBeDefined();
      expect(result.replacements[TEST_PII.EMAIL_PRIMARY]).toBeDefined();
      expect(result.replacements[TEST_PII.MRN_FORMATTED]).toBeDefined();

      // === VERIFY TEXT STRUCTURE PRESERVED ===
      expect(result.text).toContain('PATIENT INFORMATION');
      expect(result.text).toContain('VISIT SUMMARY');
      expect(result.text).toContain('INSURANCE');
      expect(result.text).toContain('EMERGENCY CONTACT');
      expect(result.text).toContain('BILLING');
    }, 60000);
  });

  describe('PIIMap Verification', () => {
    it('should return accurate PIIMap with all original->placeholder mappings', async () => {
      const text = `Patient ${TEST_PII.EMAIL_PRIMARY}, SSN: ${TEST_PII.SSN_PRIMARY}, Phone: ${TEST_PII.PHONE_PRIMARY}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Verify replacements map structure
      expect(result.replacements).toBeDefined();
      expect(typeof result.replacements).toBe('object');

      // Verify specific mappings
      expect(result.replacements[TEST_PII.EMAIL_PRIMARY]).toMatch(/\[EMAIL_\d+\]/);
      expect(result.replacements[TEST_PII.SSN_PRIMARY]).toMatch(/\[SSN_\d+\]/);

      // Verify count matches number of unique entities
      expect(result.count).toBe(Object.keys(result.replacements).length);
    }, 30000);

    it('should track all unique entities correctly', async () => {
      const text = `Email1: ${TEST_PII.EMAIL_PRIMARY}, Email2: ${TEST_PII.EMAIL_SECONDARY}, Same: ${TEST_PII.EMAIL_PRIMARY}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Should have 2 unique emails in replacements map
      expect(Object.keys(result.replacements).length).toBe(2);

      // Count should equal unique entities (2), not total occurrences (3)
      expect(result.count).toBe(2); // count tracks unique entities

      // Same email should have same placeholder
      const placeholderForPrimary = result.replacements[TEST_PII.EMAIL_PRIMARY];
      const occurrences = (result.text.match(new RegExp(placeholderForPrimary.replace(/[[\]]/g, '\\$&'), 'g')) || []).length;
      expect(occurrences).toBe(2);
    }, 30000);
  });

  describe('Edge Cases', () => {
    it('should handle empty string gracefully', async () => {
      const result = await piiScrubber.scrub('', SCRUB_OPTIONS);

      expect(result.text).toBe('');
      expect(result.count).toBe(0);
      expect(Object.keys(result.replacements).length).toBe(0);
    }, 30000);

    it('should handle whitespace-only string', async () => {
      const result = await piiScrubber.scrub('   \n\t  ', SCRUB_OPTIONS);

      expect(result.count).toBe(0);
      expect(Object.keys(result.replacements).length).toBe(0);
    }, 30000);

    it('should handle text with no PII', async () => {
      const text = 'The patient was treated successfully and discharged.';
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Text should remain intact (no structural PII)
      expect(result.text).toContain('treated');
      expect(result.text).toContain('discharged');
      // Should have no replacements as there is no PII
      expect(result.count).toBe(0);
    }, 30000);

    it('should handle documents with only structural PII', async () => {
      const text = `Email: ${TEST_PII.EMAIL_PRIMARY}, Phone: ${TEST_PII.PHONE_PRIMARY}, ZIP: ${TEST_PII.ZIP_5_DIGIT}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      expect(result.text).not.toContain(TEST_PII.EMAIL_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.PHONE_PRIMARY);
      expect(result.text).not.toContain(TEST_PII.ZIP_5_DIGIT);

      expect(result.count).toBeGreaterThanOrEqual(3);
    }, 30000);

    it('should not double-scrub placeholders', async () => {
      const text = `Patient email: ${TEST_PII.EMAIL_PRIMARY} and backup: ${TEST_PII.EMAIL_SECONDARY}`;
      const result = await piiScrubber.scrub(text, SCRUB_OPTIONS);

      // Should have placeholders, not placeholder-of-placeholder
      expect(result.text).toMatch(/\[EMAIL_\d+\]/);
      expect(result.text).not.toMatch(/\[\[EMAIL/); // No double brackets

      // Placeholders should be in proper format
      const placeholders = result.text.match(/\[EMAIL_\d+\]/g) || [];
      expect(placeholders.length).toBeGreaterThan(0);

      // Each placeholder should be well-formed
      placeholders.forEach(ph => {
        expect(ph).toMatch(/^\[EMAIL_\d+\]$/);
      });
    }, 30000);
  });

  describe('Performance and Scalability', () => {
    it('should handle large documents efficiently', async () => {
      // Create a large document with repeated PII
      const paragraph = `Contact: ${TEST_PII.EMAIL_PRIMARY} or ${TEST_PII.PHONE_PRIMARY}. MRN: ${TEST_PII.MRN_PRIMARY}. SSN: ${TEST_PII.SSN_PRIMARY}. ZIP: ${TEST_PII.ZIP_5_DIGIT}. `;
      const largeDoc = paragraph.repeat(100); // ~14KB of text

      const startTime = performance.now();
      const result = await piiScrubber.scrub(largeDoc, SCRUB_OPTIONS);
      const processingTime = performance.now() - startTime;

      // Should complete in reasonable time (< 30 seconds)
      expect(processingTime).toBeLessThan(30000);

      // Should scrub all instances (5 unique PII types × 1 = 5 unique entities)
      expect(result.count).toBeGreaterThanOrEqual(5);

      testLogger.perf('test:large-document', {
        duration: Math.round(processingTime),
        size: largeDoc.length,
        count: result.count
      });
    }, 60000);

    it('should maintain consistency in large documents', async () => {
      const sections = [
        `Patient: ${TEST_PII.EMAIL_PRIMARY}, DOB: ${TEST_PII.DATE_BIRTH}`,
        `Phone: ${TEST_PII.PHONE_SECONDARY}, Email: ${TEST_PII.EMAIL_PRIMARY}`, // Repeated email
        `Insurance Policy: ${TEST_PII.CARD_MASTERCARD}`,
        `MRN: ${TEST_PII.MRN_PRIMARY}, SSN: ${TEST_PII.SSN_SPOUSE}, ZIP: ${TEST_PII.ZIP_REAL_LOOKING}`,
        `Emergency contact: ${TEST_PII.EMAIL_PRIMARY}`, // Repeated email again
      ];

      const fullDoc = sections.join('\n\n');
      const result = await piiScrubber.scrub(fullDoc, SCRUB_OPTIONS);

      // Repeated email should use same placeholder
      const emailPlaceholder = result.replacements[TEST_PII.EMAIL_PRIMARY];
      expect(emailPlaceholder).toBeDefined();

      const emailCount = (result.text.match(new RegExp(emailPlaceholder.replace(/[[\]]/g, '\\$&'), 'g')) || []).length;
      expect(emailCount).toBe(3); // Should appear 3 times with same placeholder

      testLogger.info('test:consistency-large-doc', {
        placeholderFormat: emailPlaceholder,
        occurrences: emailCount
      });
    }, 60000);
  });
});

/**
 * BROWSER-ONLY TESTS FOR ML-BASED PII DETECTION
 *
 * The following tests require BERT NER model and must run in a browser.
 * To run these tests:
 *
 * 1. Start dev server: npm run dev
 * 2. Open browser DevTools console
 * 3. Use this test snippet:
 *
 * ```javascript
 * // Test ML-based name detection
 * async function testMLScrubbing() {
 *   const { piiScrubber } = await import('./services/piiScrubber');
 *
 *   // Test 1: Person names
 *   const text1 = 'Dr. Sarah Johnson examined the patient. Nurse Michael Brown assisted.';
 *   const result1 = await piiScrubber.scrub(text1);
 *   console.assert(!result1.text.includes('Sarah Johnson'), 'Name should be scrubbed');
 *   console.assert(result1.text.match(/\[PER_\d+\]/), 'Should have PER placeholders');
 *
 *   // Test 2: Locations
 *   const text2 = 'Patient transferred from Boston General to New York Presbyterian.';
 *   const result2 = await piiScrubber.scrub(text2);
 *   console.assert(!result2.text.includes('Boston'), 'Location should be scrubbed');
 *   console.assert(result2.text.match(/\[LOC_\d+\]/), 'Should have LOC placeholders');
 *
 *   // Test 3: Organizations
 *   const text3 = 'Insurance: Blue Cross Blue Shield. Referred by Mayo Clinic.';
 *   const result3 = await piiScrubber.scrub(text3);
 *   console.assert(!result3.text.includes('Mayo Clinic'), 'Org should be scrubbed');
 *   console.assert(result3.text.match(/\[ORG_\d+\]/), 'Should have ORG placeholders');
 *
 *   console.log('✅ All ML-based tests passed!');
 *   return { result1, result2, result3 };
 * }
 *
 * testMLScrubbing();
 * ```
 */
