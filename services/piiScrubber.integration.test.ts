import { describe, it, expect, beforeAll } from 'vitest';
import { piiScrubber } from './piiScrubber';
import { PATTERNS } from './piiScrubber';

/**
 * COMPREHENSIVE INTEGRATION TESTS FOR PII SCRUBBING
 *
 * These are deterministic, non-mock-based tests that verify:
 * 1. All structural PII types (regex-based) are detected and scrubbed
 * 2. The actual scrub() function works end-to-end
 * 3. PIIMap tracks replacements accurately
 * 4. Placeholder consistency is maintained
 * 5. Real-world medical documents are properly sanitized
 *
 * NOTE: ML-based tests (BERT NER for names/locations/orgs) are browser-only
 * due to Hugging Face Transformers requiring browser cache. To test ML features:
 * - Run the app in dev mode: `npm run dev`
 * - Use browser DevTools console to test scrub() function manually
 * - Or run tests in a browser-based test runner (e.g., Playwright/Cypress)
 */

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
      const text = 'Contact patient at john.doe@example.com for follow-up.';
      const result = await piiScrubber.scrub(text);

      // Email should not appear in scrubbed text
      expect(result.text).not.toContain('john.doe@example.com');

      // Email should be in replacements map
      expect(result.replacements['john.doe@example.com']).toBeDefined();
      expect(result.replacements['john.doe@example.com']).toMatch(/\[EMAIL_\d+\]/);

      // Count should be at least 1
      expect(result.count).toBeGreaterThanOrEqual(1);

      console.log('Email scrubbing:', { original: text, scrubbed: result.text });
    }, 30000);

    it('should scrub multiple different emails', async () => {
      const text = 'Primary: alice@test.com, Secondary: bob@example.org';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('alice@test.com');
      expect(result.text).not.toContain('bob@example.org');
      expect(result.count).toBeGreaterThanOrEqual(2);
    }, 30000);

    it('should maintain placeholder consistency for repeated emails', async () => {
      const text = 'Email john@test.com twice: john@test.com and john@test.com again.';
      const result = await piiScrubber.scrub(text);

      // Should use same placeholder for same email
      const placeholder = result.replacements['john@test.com'];
      expect(placeholder).toBeDefined();

      // Count occurrences of placeholder in result text
      const placeholderRegex = new RegExp(placeholder.replace(/[[\]]/g, '\\$&'), 'g');
      const placeholderCount = (result.text.match(placeholderRegex) || []).length;
      expect(placeholderCount).toBe(3); // Should appear 3 times

      console.log('Consistency check:', { placeholder, count: placeholderCount });
    }, 30000);
  });

  describe('Phone Number Scrubbing - All Formats', () => {
    it('should scrub various phone formats', async () => {
      const text = 'Call (555) 123-4567 or 555-987-6543 for appointments.';
      const result = await piiScrubber.scrub(text);

      // Phone numbers should not appear in scrubbed text
      expect(result.text).not.toContain('123-4567');
      expect(result.text).not.toContain('987-6543');

      // Should have replacements for phone numbers
      expect(result.count).toBeGreaterThanOrEqual(2);

      // Should contain PHONE placeholders
      expect(result.text).toMatch(/\[PHONE_\d+\]/);

      console.log('Phone scrubbing:', result.text);
    }, 30000);

    it('should handle phone with +1 country code', async () => {
      const text = 'International: +1 617 555 1234';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('617 555 1234');
      expect(result.text).toMatch(/\[PHONE_\d+\]/);
    }, 30000);
  });

  describe('SSN Scrubbing', () => {
    it('should scrub SSN and track in PIIMap', async () => {
      const text = 'Patient SSN: 123-45-6789 for insurance verification.';
      const result = await piiScrubber.scrub(text);

      // SSN should not appear in scrubbed text
      expect(result.text).not.toContain('123-45-6789');

      // SSN should be in replacements map
      expect(result.replacements['123-45-6789']).toBeDefined();
      expect(result.replacements['123-45-6789']).toMatch(/\[SSN_\d+\]/);

      console.log('SSN scrubbing:', result);
    }, 30000);

    it('should scrub multiple SSNs', async () => {
      const text = 'Primary: 111-22-3333, Spouse: 444-55-6666';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('111-22-3333');
      expect(result.text).not.toContain('444-55-6666');
      expect(result.count).toBeGreaterThanOrEqual(2);
    }, 30000);
  });

  describe('Credit Card Scrubbing', () => {
    it('should scrub credit card with dashes', async () => {
      const text = 'Payment card: 4532-1234-5678-9010 on file.';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('4532-1234-5678-9010');
      expect(result.text).toMatch(/\[CARD_\d+\]/);
    }, 30000);

    it('should scrub credit card with spaces', async () => {
      const text = 'Card number: 4532 1234 5678 9010';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('4532 1234 5678 9010');
      expect(result.text).toMatch(/\[CARD_\d+\]/);
    }, 30000);

    it('should scrub credit card without separators', async () => {
      const text = 'Card: 4532123456789010';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('4532123456789010');
      expect(result.text).toMatch(/\[CARD_\d+\]/);
    }, 30000);
  });

  describe('ZIP Code Scrubbing', () => {
    it('should scrub 5-digit ZIP code', async () => {
      const text = 'Located in ZIP 12345';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('12345');
      expect(result.text).toMatch(/\[ZIP_\d+\]/);
    }, 30000);

    it('should scrub ZIP+4 format', async () => {
      const text = 'Mailing address: Boston, MA 02101-1234';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('02101-1234');
      expect(result.text).toMatch(/\[ZIP_\d+\]/);
    }, 30000);
  });

  describe('Medical Record Number (MRN) Scrubbing', () => {
    it('should scrub MRN with MRN keyword', async () => {
      const text = 'Patient MRN: ABC123456 admitted today.';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('ABC123456');
      expect(result.replacements['ABC123456']).toBeDefined();
      expect(result.replacements['ABC123456']).toMatch(/\[MRN_\d+\]/);
    }, 30000);

    it('should scrub MRN with various keywords', async () => {
      const text = `
        MRN: 1234567
        Medical Record Number: XYZ890123
        Patient ID: ABC456789
        Chart Number: DEF111222
      `;
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('1234567');
      expect(result.text).not.toContain('XYZ890123');
      expect(result.text).not.toContain('ABC456789');
      expect(result.text).not.toContain('DEF111222');

      expect(result.count).toBeGreaterThanOrEqual(4);
    }, 30000);

    it('should handle MRN with different separators', async () => {
      const tests = [
        'MRN: 123456',
        'MRN:123456',
        'MRN 123456',
      ];

      for (const text of tests) {
        const result = await piiScrubber.scrub(text);
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
Date of Birth: 03/15/1982
MRN: MED987654
SSN: 456-78-9012
Phone: (617) 555-1234
Email: patient.email@hospital.com
Address: 123 Main Street, Boston, MA 02138

VISIT SUMMARY
=============
Visit Date: 12/20/2024
Admission Date: 12/19/2024
Discharge Date: 12/25/2024

INSURANCE
=========
Policy Number: 1234-5678-9012-3456
Member ID: XYZ789012

EMERGENCY CONTACT
=================
Phone: 617-555-9876
Email: emergency.contact@email.com

BILLING
=======
ZIP Code: 02138-1001
Payment Card: 4532-1234-5678-9010
      `;

      const result = await piiScrubber.scrub(medicalNote);

      console.log('\n=== ORIGINAL DOCUMENT LENGTH ===');
      console.log(`${medicalNote.length} characters`);

      console.log('\n=== SCRUBBED OUTPUT ===');
      console.log(result.text);

      console.log('\n=== REPLACEMENT MAP ===');
      console.log(JSON.stringify(result.replacements, null, 2));

      console.log(`\n=== STATISTICS ===`);
      console.log(`Total entities scrubbed: ${result.count}`);
      console.log(`Unique entities: ${Object.keys(result.replacements).length}`);

      // === VERIFY ALL STRUCTURAL PII TYPES ARE SCRUBBED ===

      // 1. Dates
      expect(result.text).not.toContain('03/15/1982');
      expect(result.text).not.toContain('12/20/2024');
      expect(result.text).not.toContain('12/19/2024');
      expect(result.text).not.toContain('12/25/2024');

      // 2. MRNs
      expect(result.text).not.toContain('MED987654');
      expect(result.text).not.toContain('XYZ789012');

      // 3. SSN
      expect(result.text).not.toContain('456-78-9012');

      // 4. Phone Numbers
      expect(result.text).not.toContain('617-555-1234');
      expect(result.text).not.toContain('617-555-9876');

      // 5. Emails
      expect(result.text).not.toContain('patient.email@hospital.com');
      expect(result.text).not.toContain('emergency.contact@email.com');

      // 6. ZIP Codes
      expect(result.text).not.toContain('02138');
      expect(result.text).not.toContain('02138-1001');

      // 7. Credit Card / Policy Number
      expect(result.text).not.toContain('1234-5678-9012-3456');
      expect(result.text).not.toContain('4532-1234-5678-9010');

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
      expect(result.replacements['456-78-9012']).toBeDefined();
      expect(result.replacements['patient.email@hospital.com']).toBeDefined();
      expect(result.replacements['MED987654']).toBeDefined();

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
      const text = 'Patient john@test.com, SSN: 111-22-3333, Phone: 555-1234567';
      const result = await piiScrubber.scrub(text);

      // Verify replacements map structure
      expect(result.replacements).toBeDefined();
      expect(typeof result.replacements).toBe('object');

      // Verify specific mappings
      expect(result.replacements['john@test.com']).toMatch(/\[EMAIL_\d+\]/);
      expect(result.replacements['111-22-3333']).toMatch(/\[SSN_\d+\]/);

      // Verify count matches number of unique entities
      expect(result.count).toBe(Object.keys(result.replacements).length);

      console.log('PIIMap:', result.replacements);
    }, 30000);

    it('should track all unique entities correctly', async () => {
      const text = 'Email1: a@b.com, Email2: c@d.com, Same: a@b.com';
      const result = await piiScrubber.scrub(text);

      // Should have 2 unique emails
      expect(Object.keys(result.replacements).length).toBe(2);

      // There are 3 occurrences, but only 2 unique emails
      expect(result.count).toBe(2); // count is unique entities, not occurrences

      // Same email should have same placeholder
      const placeholderForA = result.replacements['a@b.com'];
      const occurrences = (result.text.match(new RegExp(placeholderForA.replace(/[[\]]/g, '\\$&'), 'g')) || []).length;
      expect(occurrences).toBe(2);
    }, 30000);
  });

  describe('Edge Cases', () => {
    it('should handle empty string gracefully', async () => {
      const result = await piiScrubber.scrub('');

      expect(result.text).toBe('');
      expect(result.count).toBe(0);
      expect(Object.keys(result.replacements).length).toBe(0);
    }, 30000);

    it('should handle whitespace-only string', async () => {
      const result = await piiScrubber.scrub('   \n\t  ');

      expect(result.count).toBe(0);
      expect(Object.keys(result.replacements).length).toBe(0);
    }, 30000);

    it('should handle text with no PII', async () => {
      const text = 'The patient was treated successfully and discharged.';
      const result = await piiScrubber.scrub(text);

      // Text should remain intact (no structural PII)
      expect(result.text).toContain('treated');
      expect(result.text).toContain('discharged');
      // May have 0 or minimal replacements
      expect(result.count).toBeGreaterThanOrEqual(0);
    }, 30000);

    it('should handle documents with only structural PII', async () => {
      const text = 'Email: test@example.com, Phone: 555-1234567, ZIP: 12345';
      const result = await piiScrubber.scrub(text);

      expect(result.text).not.toContain('test@example.com');
      expect(result.text).not.toContain('555-1234567');
      expect(result.text).not.toContain('12345');

      expect(result.count).toBeGreaterThanOrEqual(3);
    }, 30000);

    it('should not double-scrub placeholders', async () => {
      const text = 'Patient email: john@test.com and backup: jane@test.com';
      const result = await piiScrubber.scrub(text);

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
      const paragraph = 'Contact: john.smith@hospital.com or (555) 123-4567. MRN: ABC123456. SSN: 123-45-6789. ZIP: 12345. ';
      const largeDoc = paragraph.repeat(100); // ~14KB of text

      const startTime = performance.now();
      const result = await piiScrubber.scrub(largeDoc);
      const processingTime = performance.now() - startTime;

      // Should complete in reasonable time (< 30 seconds)
      expect(processingTime).toBeLessThan(30000);

      // Should scrub all instances (5 unique PII types × 1 = 5 unique entities)
      expect(result.count).toBeGreaterThanOrEqual(5);

      console.log(`\nPerformance Test:`);
      console.log(`- Document size: ${largeDoc.length} characters`);
      console.log(`- Processing time: ${(processingTime / 1000).toFixed(2)}s`);
      console.log(`- Entities scrubbed: ${result.count}`);
      console.log(`- Speed: ${(largeDoc.length / processingTime * 1000).toFixed(0)} chars/sec`);
    }, 60000);

    it('should maintain consistency in large documents', async () => {
      const sections = [
        'Patient: alice.j@test.com, DOB: 05/12/1990',
        'Phone: 650-555-1234, Email: alice.j@test.com', // Repeated email
        'Insurance Policy: 9876-5432-1098-7654',
        'MRN: XYZ789012, SSN: 987-65-4321, ZIP: 94305',
        'Emergency contact: alice.j@test.com', // Repeated email again
      ];

      const fullDoc = sections.join('\n\n');
      const result = await piiScrubber.scrub(fullDoc);

      // Repeated email should use same placeholder
      const emailPlaceholder = result.replacements['alice.j@test.com'];
      expect(emailPlaceholder).toBeDefined();

      const emailCount = (result.text.match(new RegExp(emailPlaceholder.replace(/[[\]]/g, '\\$&'), 'g')) || []).length;
      expect(emailCount).toBe(3); // Should appear 3 times with same placeholder

      console.log('Consistency test:', { emailPlaceholder, occurrences: emailCount });
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
