import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectContextualMRN, PATTERNS, MRN_CONTEXT_KEYWORDS } from './piiScrubber';

describe('PII Scrubber - Regex Patterns', () => {
  describe('EMAIL Pattern', () => {
    it('should match valid email addresses', () => {
      const text = 'Contact john.doe@example.com or jane_smith@company.co.uk';
      const matches = text.match(PATTERNS.EMAIL);
      expect(matches).toHaveLength(2);
      expect(matches).toContain('john.doe@example.com');
      expect(matches).toContain('jane_smith@company.co.uk');
    });

    it('should handle invalid email patterns gracefully', () => {
      const text = 'Invalid: @example.com, user@, incomplete@domain';
      // Should not crash and may or may not match partial patterns
      expect(() => text.match(PATTERNS.EMAIL)).not.toThrow();
    });
  });

  describe('PHONE Pattern', () => {
    it('should match US phone numbers in various formats', () => {
      const tests = [
        { text: 'Call (555) 123-4567', expected: true },
        { text: 'Phone: 555-123-4567', expected: true },
        { text: 'Mobile: 5551234567', expected: true },
        { text: '+1 555 123 4567', expected: true },
      ];

      tests.forEach(({ text, expected }) => {
        const matches = text.match(PATTERNS.PHONE);
        if (expected) {
          expect(matches, `Should match: ${text}`).not.toBeNull();
          expect(matches!.length, `Should find match in: ${text}`).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('SSN Pattern', () => {
    it('should match SSN in XXX-XX-XXXX format', () => {
      const text = 'SSN: 123-45-6789';
      const matches = text.match(PATTERNS.SSN);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('123-45-6789');
    });

    it('should not match SSN without dashes', () => {
      const text = 'SSN: 123456789';
      const matches = text.match(PATTERNS.SSN);
      expect(matches).toBeNull();
    });
  });

  describe('CREDIT_CARD Pattern', () => {
    it('should match credit card numbers', () => {
      const tests = [
        '4532-1234-5678-9010',
        '4532 1234 5678 9010',
        '4532123456789010',
      ];

      tests.forEach(cardNumber => {
        const matches = cardNumber.match(PATTERNS.CREDIT_CARD);
        expect(matches, `Should match: ${cardNumber}`).not.toBeNull();
      });
    });
  });

  describe('ZIPCODE Pattern', () => {
    it('should match 5-digit zipcodes', () => {
      const text = 'Address in 12345';
      const matches = text.match(PATTERNS.ZIPCODE);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('12345');
    });

    it('should match ZIP+4 format', () => {
      const text = 'Extended ZIP: 12345-6789';
      const matches = text.match(PATTERNS.ZIPCODE);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('12345-6789');
    });
  });
});

describe('PII Scrubber - Context-Aware MRN Detection', () => {
  it('should detect MRN with explicit label', () => {
    const text = 'Patient MRN: ABC123456';
    const matches = detectContextualMRN(text);

    expect(matches).toHaveLength(1);
    expect(matches[0].value).toBe('ABC123456');
  });

  it('should detect multiple MRN formats', () => {
    const text = `
      MRN: 1234567
      Medical Record Number: ABC8901234
      Patient ID: XYZ456789
    `;
    const matches = detectContextualMRN(text);

    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(matches.map(m => m.value)).toContain('1234567');
    expect(matches.map(m => m.value)).toContain('ABC8901234');
    expect(matches.map(m => m.value)).toContain('XYZ456789');
  });

  it('should handle different separators', () => {
    const tests = [
      'MRN: 123456',
      'MRN:123456',
      'MRN 123456',
      'Chart Number: 789012',
    ];

    tests.forEach(text => {
      const matches = detectContextualMRN(text);
      expect(matches.length, `Should find MRN in: ${text}`).toBeGreaterThan(0);
    });
  });

  it('should not match standalone numbers without context', () => {
    const text = 'The year 2024 had 365 days and patient count was 1234567';
    const matches = detectContextualMRN(text);

    // Should not match random numbers
    expect(matches).toHaveLength(0);
  });

  it('should provide correct start and end positions', () => {
    const text = 'MRN: ABC123';
    const matches = detectContextualMRN(text);

    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(text.substring(match.start, match.end)).toBe('ABC123');
  });

  it('should handle case-insensitive keywords', () => {
    const text = 'mrn: 123456 and PATIENT ID: 789012';
    const matches = detectContextualMRN(text);

    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('PII Scrubber - Pattern Coverage', () => {
  it('should have patterns for all critical PII types', () => {
    expect(PATTERNS.EMAIL).toBeDefined();
    expect(PATTERNS.PHONE).toBeDefined();
    expect(PATTERNS.SSN).toBeDefined();
    expect(PATTERNS.CREDIT_CARD).toBeDefined();
    expect(PATTERNS.ZIPCODE).toBeDefined();
  });

  it('should have comprehensive MRN keywords', () => {
    expect(MRN_CONTEXT_KEYWORDS).toContain('MRN');
    expect(MRN_CONTEXT_KEYWORDS).toContain('Patient ID');
    expect(MRN_CONTEXT_KEYWORDS).toContain('Medical Record Number');
    expect(MRN_CONTEXT_KEYWORDS.length).toBeGreaterThanOrEqual(5);
  });
});

describe('PII Scrubber - Real-world Medical Document Test', () => {
  it('should detect all PII in a sample medical note', () => {
    const medicalNote = `
      PATIENT INFORMATION
      Name: Dr. Jane Smith
      MRN: MED123456
      DOB: 01/15/1985
      Phone: (555) 123-4567
      Email: jane.smith@email.com
      SSN: 123-45-6789

      VISIT SUMMARY
      Patient presented to clinic on 12/20/2024.
      Location: General Hospital, Boston
      Attending: Dr. Robert Johnson
    `;

    // Test MRN detection
    const mrnMatches = detectContextualMRN(medicalNote);
    expect(mrnMatches.length).toBeGreaterThan(0);

    // Test email detection
    const emailMatches = medicalNote.match(PATTERNS.EMAIL);
    expect(emailMatches).not.toBeNull();
    expect(emailMatches).toContain('jane.smith@email.com');

    // Test phone detection
    const phoneMatches = medicalNote.match(PATTERNS.PHONE);
    expect(phoneMatches).not.toBeNull();

    // Test SSN detection
    const ssnMatches = medicalNote.match(PATTERNS.SSN);
    expect(ssnMatches).not.toBeNull();
    expect(ssnMatches).toContain('123-45-6789');
  });
});

describe('PII Scrubber - Edge Cases', () => {
  it('should handle empty strings', () => {
    expect(detectContextualMRN('')).toEqual([]);
    expect(''.match(PATTERNS.EMAIL)).toBeNull();
  });

  it('should handle strings with only whitespace', () => {
    const whitespace = '   \n\t  ';
    expect(detectContextualMRN(whitespace)).toEqual([]);
  });

  it('should handle very long documents', () => {
    const longDoc = 'Patient ID: 123456\n'.repeat(1000);
    const matches = detectContextualMRN(longDoc);
    expect(matches.length).toBe(1000); // Should find all instances
  });

  it('should handle special characters in context', () => {
    const text = 'MRN#: 123456, Patient-ID: 789012';
    // May not match due to special chars, but should not crash
    expect(() => detectContextualMRN(text)).not.toThrow();
  });
});
