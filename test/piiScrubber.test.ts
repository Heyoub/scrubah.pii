import { describe, it, expect } from 'vitest';
import { detectContextualMRN, MRN_CONTEXT_KEYWORDS } from '../services/piiScrubber.effect';
import { detectLabeledName, NAME_LABELS, PATTERNS } from '../.archive/piiScrubber';

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

  describe('DATE Pattern', () => {
    it('should match dates in MM/DD/YYYY format', () => {
      const text = 'Appointment on 12/25/2024';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('12/25/2024');
    });

    it('should match dates in MM-DD-YYYY format', () => {
      const text = 'DOB: 03-15-1985';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('03-15-1985');
    });

    it('should match dates in M/D/YY format', () => {
      const text = 'Visit: 5/3/24';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).toHaveLength(1);
      expect(matches![0]).toBe('5/3/24');
    });

    it('should match multiple dates in text', () => {
      const text = 'Initial visit 01/10/2024, follow-up 02/15/2024, and discharge 03/20/2024';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).toHaveLength(3);
      expect(matches).toContain('01/10/2024');
      expect(matches).toContain('02/15/2024');
      expect(matches).toContain('03/20/2024');
    });

    it('should handle dates with both slash and dash separators', () => {
      const text = 'DOB: 12/31/1990 and visit date: 06-15-2024';
      const matches = text.match(PATTERNS.DATE);
      expect(matches).toHaveLength(2);
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

describe('PII Scrubber - Address Patterns', () => {
  describe('ADDRESS Pattern', () => {
    it('should match street addresses with full street type', () => {
      const tests = [
        '123 Main Street',
        '456 Elm Avenue',
        '789 Oak Road',
        '1234 Pine Boulevard',
        '567 Maple Drive',
        '890 Cherry Lane',
        '321 Sunset Court',
        '654 River Parkway'
      ];

      tests.forEach(address => {
        const matches = address.match(PATTERNS.ADDRESS);
        expect(matches, `Should match: ${address}`).not.toBeNull();
        expect(matches!.length).toBeGreaterThan(0);
      });
    });

    it('should match street addresses with abbreviations', () => {
      const tests = [
        '123 Main St',
        '456 Elm Ave',
        '789 Oak Rd',
        '1234 Pine Blvd',
        '567 Maple Dr',
        '890 Cherry Ln',
        '321 Sunset Ct',
        '654 River Pkwy'
      ];

      tests.forEach(address => {
        const matches = address.match(PATTERNS.ADDRESS);
        expect(matches, `Should match: ${address}`).not.toBeNull();
      });
    });

    it('should match addresses with apartment/suite numbers', () => {
      const tests = [
        '123 Main St Apt 4B',
        '456 Elm Avenue Suite 200',
        '789 Oak Road Unit 5',
        '1234 Pine Blvd #302'
      ];

      tests.forEach(address => {
        const matches = address.match(PATTERNS.ADDRESS);
        expect(matches, `Should match: ${address}`).not.toBeNull();
      });
    });

    it('should match multi-word street names', () => {
      const tests = [
        '123 Park Place Avenue',
        '456 Martin Luther King Boulevard',
        '789 West Oak Street'
      ];

      tests.forEach(address => {
        const matches = address.match(PATTERNS.ADDRESS);
        expect(matches, `Should match: ${address}`).not.toBeNull();
      });
    });
  });

  describe('CITY_STATE Pattern', () => {
    it('should match city and state combinations', () => {
      const tests = [
        'Boston, MA',
        'New York, NY',
        'Los Angeles, CA',
        'Chicago, IL',
        'Houston, TX',
        'San Francisco, CA'
      ];

      tests.forEach(cityState => {
        const matches = cityState.match(PATTERNS.CITY_STATE);
        expect(matches, `Should match: ${cityState}`).not.toBeNull();
        expect(matches![0]).toBe(cityState);
      });
    });

    it('should match multi-word city names', () => {
      const tests = [
        'San Francisco, CA',
        'Los Angeles, CA',
        'New York, NY',
        'Salt Lake City, UT'
      ];

      tests.forEach(cityState => {
        const matches = cityState.match(PATTERNS.CITY_STATE);
        expect(matches, `Should match: ${cityState}`).not.toBeNull();
      });
    });

    it('should not match without state abbreviation', () => {
      const text = 'Boston, Massachusetts';
      const matches = text.match(PATTERNS.CITY_STATE);
      // This will not match since state is not abbreviated
      expect(matches).toBeNull();
    });
  });

  describe('PO_BOX Pattern', () => {
    it('should match P.O. Box variations', () => {
      const tests = [
        'P.O. Box 1234',
        'PO Box 5678',
        'P O Box 9012',
        'P.O.Box 3456'
      ];

      tests.forEach(poBox => {
        const matches = poBox.match(PATTERNS.PO_BOX);
        expect(matches, `Should match: ${poBox}`).not.toBeNull();
        expect(matches!.length).toBeGreaterThan(0);
      });
    });

    it('should match in full address context', () => {
      const text = 'Mailing Address: P.O. Box 1234, Phoenix, AZ 85001';
      const matches = text.match(PATTERNS.PO_BOX);
      expect(matches).not.toBeNull();
      expect(matches!.length).toBe(1);
    });
  });
});

describe('PII Scrubber - Label-Based Name Detection', () => {
  it('should detect names with common labels', () => {
    const tests = [
      { text: 'Patient Name: John Smith', expected: 'John Smith' },
      { text: 'Name: Mary Johnson', expected: 'Mary Johnson' },
      { text: 'Full Name: Robert Williams', expected: 'Robert Williams' },
      { text: 'Legal Name: Sarah Davis', expected: 'Sarah Davis' }
    ];

    tests.forEach(({ text, expected }) => {
      const matches = detectLabeledName(text);
      expect(matches.length, `Should find name in: ${text}`).toBeGreaterThan(0);
      expect(matches[0].value).toBe(expected);
    });
  });

  it('should detect names with titles', () => {
    const tests = [
      { text: 'Patient Name: Dr. Jane Smith', expected: 'Dr. Jane Smith' },
      { text: 'Name: Mr. John Doe', expected: 'Mr. John Doe' },
      { text: 'Full Name: Mrs. Mary Johnson', expected: 'Mrs. Mary Johnson' },
      { text: 'Patient: Ms. Sarah Williams', expected: 'Ms. Sarah Williams' }
    ];

    tests.forEach(({ text, expected }) => {
      const matches = detectLabeledName(text);
      expect(matches.length, `Should find name in: ${text}`).toBeGreaterThan(0);
      expect(matches[0].value).toBe(expected);
    });
  });

  it('should detect names with middle names', () => {
    const tests = [
      { text: 'Patient Name: John Michael Smith', expected: 'John Michael Smith' },
      { text: 'Name: Mary Ann Johnson', expected: 'Mary Ann Johnson' }
    ];

    tests.forEach(({ text, expected }) => {
      const matches = detectLabeledName(text);
      expect(matches.length, `Should find name in: ${text}`).toBeGreaterThan(0);
      expect(matches[0].value).toBe(expected);
    });
  });

  it('should detect names with JSON-style labels', () => {
    const tests = [
      'patientName: Alice Brown',
      'patient_name: Michael Green',
      'fullName: Jennifer White',
      'full_name: David Lee'
    ];

    tests.forEach(text => {
      const matches = detectLabeledName(text);
      expect(matches.length, `Should find name in: ${text}`).toBeGreaterThan(0);
    });
  });

  it('should handle multiple labeled names in text', () => {
    const text = `
      Patient Name: John Smith
      Name: Mary Johnson
      Full Name: Robert Williams
    `;
    const matches = detectLabeledName(text);
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('should provide correct start and end positions', () => {
    const text = 'Patient Name: John Smith';
    const matches = detectLabeledName(text);
    expect(matches).toHaveLength(1);
    expect(text.substring(matches[0].start, matches[0].end)).toBe('John Smith');
  });

  it('should not match standalone names without labels', () => {
    const text = 'The patient was examined and treated successfully.';
    const matches = detectLabeledName(text);
    expect(matches).toHaveLength(0);
  });

  it('should handle case-insensitive labels', () => {
    const tests = [
      'patient name: John Smith',
      'PATIENT NAME: Mary Johnson',
      'Patient Name: Robert Williams'
    ];

    tests.forEach(text => {
      const matches = detectLabeledName(text);
      expect(matches.length, `Should find name in: ${text}`).toBeGreaterThan(0);
    });
  });
});

describe('PII Scrubber - Pattern Coverage for New Patterns', () => {
  it('should have patterns for all address types', () => {
    expect(PATTERNS.ADDRESS).toBeDefined();
    expect(PATTERNS.CITY_STATE).toBeDefined();
    expect(PATTERNS.PO_BOX).toBeDefined();
  });

  it('should have comprehensive name labels', () => {
    expect(NAME_LABELS).toContain('Patient Name');
    expect(NAME_LABELS).toContain('Name');
    expect(NAME_LABELS).toContain('Full Name');
    expect(NAME_LABELS).toContain('patientName');
    expect(NAME_LABELS.length).toBeGreaterThanOrEqual(8);
  });
});
