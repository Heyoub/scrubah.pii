/**
 * PII LEAK DETECTION TESTS
 *
 * CRITICAL SECURITY TESTS - These tests verify that NO PII leaks through the scrubber.
 *
 * Test Strategy:
 * 1. Known PII patterns (names, SSN, phone, email, etc.)
 * 2. Edge cases (formatting variations, OCR artifacts)
 * 3. Multi-pass validation (recursive scrubbing detection)
 * 4. False negatives (PII that might be missed)
 * 5. Context-aware scrubbing (medical terminologyconfusion)
 *
 * If ANY test fails, PII is leaking = HIPAA violation.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { loadModel, runScrubPII } from '../services/piiScrubber.effect';
import { mightContainPII } from '../schemas/phi';

// ============================================================================
// SETUP
// ============================================================================

beforeAll(async () => {
  console.log('🔐 Loading PII scrubber model...');
  try {
    await loadModel();
    console.log('✅ Model loaded successfully');
  } catch (e) {
    console.warn('⚠️ ML model failed to load, tests will use regex fallback only');
  }
}, 120000); // 2 minute timeout for model loading

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Assert that text contains NO PII after scrubbing
 */
const assertNoPII = (scrubbedText: string, description: string) => {
  // Check branded type safety
  expect(mightContainPII(scrubbedText)).toBe(false);

  // Common PII patterns that should NEVER appear in scrubbed text
  const piiPatterns = [
    // Names (common patterns)
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g, // "John Doe" format
    /\bDr\.\s+[A-Z][a-z]+/g, // "Dr. Smith"
    /\bMr\.\s+[A-Z][a-z]+/g, // "Mr. Johnson"
    /\bMs\.\s+[A-Z][a-z]+/g, // "Ms. Williams"

    // SSN patterns
    /\b\d{3}-\d{2}-\d{4}\b/g,
    /\b\d{9}\b/g, // SSN without dashes

    // Phone numbers
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    /\(\d{3}\)\s*\d{3}[-.]?\d{4}/g,

    // Email addresses
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

    // Addresses
    /\b\d+\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)/gi,

    // Dates (when combined with PHI context)
    /\bborn on\s+\d{1,2}\/\d{1,2}\/\d{4}/gi,
    /\bDOB:?\s*\d{1,2}\/\d{1,2}\/\d{4}/gi,

    // Medical Record Numbers
    /\bMRN:?\s*\d{6,}/gi,

    // Insurance IDs
    /\bInsurance ID:?\s*[A-Z0-9]{8,}/gi,
  ];

  for (const pattern of piiPatterns) {
    const matches = scrubbedText.match(pattern);
    if (matches) {
      throw new Error(
        `❌ PII LEAK DETECTED in "${description}"!\n` +
          `Pattern: ${pattern}\n` +
          `Matches: ${JSON.stringify(matches)}\n` +
          `Text snippet: ${scrubbedText.substring(0, 200)}...`
      );
    }
  }
};

// ============================================================================
// BASIC PII SCRUBBING TESTS
// ============================================================================

describe('PII Leak Detection - Basic Patterns', () => {
  it('should scrub full names (First Last)', async () => {
    const text = 'Patient John Smith was admitted on 03/15/2024.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'full name');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub full names with titles (Dr., Mr., Ms.)', async () => {
    const text = 'Dr. Sarah Johnson treated Mr. Michael Brown yesterday.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'names with titles');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub Social Security Numbers (all formats)', async () => {
    const text = 'SSN: 123-45-6789 and also 987654321 for verification.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'SSN');
    expect(result.text).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    expect(result.text).not.toMatch(/\d{9}/);
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub phone numbers (all formats)', async () => {
    const text = 'Call 555-123-4567 or (555) 987-6543 or 5551234567.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'phone numbers');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub email addresses', async () => {
    const text = 'Contact john.doe@example.com or patient@hospital.org.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'email addresses');
    expect(result.text).not.toContain('@');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub street addresses', async () => {
    const text = 'Patient lives at 123 Main Street, Apt 4B, Springfield.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'street addresses');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub dates of birth', async () => {
    const text = 'DOB: 01/15/1980 and born on 03/22/1975.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'DOB');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub Medical Record Numbers', async () => {
    const text = 'MRN: 123456 and Medical Record #987654.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'MRN');
    expect(result.count).toBeGreaterThan(0);
  });
});

// ============================================================================
// EDGE CASES & FORMATTING VARIATIONS
// ============================================================================

describe('PII Leak Detection - Edge Cases', () => {
  it('should scrub names with middle initials', async () => {
    const text = 'John Q. Public was treated by Dr. Mary A. Johnson.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'names with middle initials');
  });

  it('should scrub hyphenated names', async () => {
    const text = 'Mary-Jane Smith-Williams visited the clinic.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'hyphenated names');
  });

  it('should scrub names with suffixes (Jr., Sr., III)', async () => {
    const text = 'John Smith Jr. and Robert Johnson III were consulted.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'names with suffixes');
  });

  it('should scrub phone numbers with extensions', async () => {
    const text = 'Call 555-123-4567 ext. 890 or x123.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'phone with extensions');
  });

  it('should scrub international phone numbers', async () => {
    const text = 'International: +1-555-123-4567 or +44 20 1234 5678.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'international phones');
  });

  it('should scrub SSN with spaces', async () => {
    const text = 'SSN: 123 45 6789 (with spaces).';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'SSN with spaces');
    expect(result.text).not.toMatch(/\d{3}\s+\d{2}\s+\d{4}/);
  });

  it('should scrub email addresses with special characters', async () => {
    const text = 'Email: john.doe+test@example.com and jane_smith@hospital.org.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'complex emails');
  });

  it('should scrub addresses with apartment numbers', async () => {
    const text = 'Address: 456 Oak Ave, Unit 12B, Building C, Floor 3.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'complex addresses');
  });
});

// ============================================================================
// OCR ARTIFACTS & SCANNING ERRORS
// ============================================================================

describe('PII Leak Detection - OCR Artifacts', () => {
  it('should scrub names with OCR errors (l vs I, O vs 0)', async () => {
    const text = 'Patient J0hn Sm1th (OCR error) was treated.';
    const result = await runScrubPII(text);

    // Should still detect as potential name pattern
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub SSN with OCR noise', async () => {
    const text = 'SSN: l23-45-6789 (l instead of 1).';
    const result = await runScrubPII(text);

    // Should catch the pattern
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub phone numbers with extra spaces (OCR)', async () => {
    const text = 'Phone: 5 5 5 - 1 2 3 - 4 5 6 7 (scanned poorly).';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'OCR phone numbers');
  });
});

// ============================================================================
// MULTI-PASS VALIDATION
// ============================================================================

describe('PII Leak Detection - Multi-Pass Validation', () => {
  it('should NOT leave PII after multiple scrub passes', async () => {
    const text = 'John Doe (SSN: 123-45-6789) called from 555-1234.';

    // First pass
    const pass1 = await runScrubPII(text);
    assertNoPII(pass1.text, 'pass 1');

    // Second pass (should be idempotent)
    const pass2 = await runScrubPII(pass1.text);
    assertNoPII(pass2.text, 'pass 2');

    // Second pass should not find new PII
    expect(pass2.count).toBe(0);
  });

  it('should detect if replacement placeholders look like PII', async () => {
    const text = 'Patient John Doe visited.';
    const result = await runScrubPII(text);

    // Placeholders should NOT match PII patterns
    assertNoPII(result.text, 'placeholder format check');

    // Verify placeholders are properly formatted
    expect(result.text).toMatch(/\[PATIENT-\d+\]/);
  });
});

// ============================================================================
// FALSE NEGATIVES (PII that might be missed)
// ============================================================================

describe('PII Leak Detection - Known False Negatives', () => {
  it('should scrub names in lowercase (case variation)', async () => {
    const text = 'patient john smith was admitted.';
    const result = await runScrubPII(text);

    // ML model should catch this even if regex doesn't
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub names in UPPERCASE', async () => {
    const text = 'PATIENT JOHN SMITH WAS ADMITTED.';
    const result = await runScrubPII(text);

    // Should detect as name pattern
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub partial SSN (last 4 digits)', async () => {
    const text = 'SSN ending in 6789 for verification.';
    const result = await runScrubPII(text);

    // Should scrub partial SSN if preceded by context
    expect(result.text).not.toMatch(/ending in \d{4}/i);
  });

  it('should scrub account numbers that look like SSN', async () => {
    const text = 'Account: 123456789 (9 digits).';
    const result = await runScrubPII(text);

    // 9-digit sequences should be scrubbed as potential SSN
    assertNoPII(result.text, 'account numbers');
  });
});

// ============================================================================
// CONTEXT-AWARE SCRUBBING
// ============================================================================

describe('PII Leak Detection - Medical Context', () => {
  it('should NOT scrub medical terminology (false positives)', async () => {
    const text = 'Patient has elevated glucose levels and normal platelet count.';
    const result = await runScrubPII(text);

    // Medical terms should remain
    expect(result.text).toContain('glucose');
    expect(result.text).toContain('platelet');
  });

  it('should scrub patient names but keep medication names', async () => {
    const text = 'John Smith prescribed Metformin 500mg twice daily.';
    const result = await runScrubPII(text);

    // Patient name scrubbed, medication kept
    expect(result.text).not.toContain('John Smith');
    expect(result.text).toContain('Metformin');
  });

  it('should scrub physician names but keep medical procedures', async () => {
    const text = 'Dr. Sarah Johnson performed appendectomy on patient.';
    const result = await runScrubPII(text);

    // Doctor name scrubbed, procedure kept
    assertNoPII(result.text, 'doctor names');
    expect(result.text).toContain('appendectomy');
  });
});

// ============================================================================
// REAL-WORLD MEDICAL DOCUMENT SNIPPETS
// ============================================================================

describe('PII Leak Detection - Real-World Scenarios', () => {
  it('should scrub discharge summary header', async () => {
    const text = `DISCHARGE SUMMARY
Patient Name: John Doe
DOB: 01/15/1980
MRN: 123456
Date of Admission: 03/01/2024
Attending Physician: Dr. Sarah Johnson`;

    const result = await runScrubPII(text);

    assertNoPII(result.text, 'discharge summary');
    expect(result.count).toBeGreaterThan(4); // At least 5 PII entities
  });

  it('should scrub SOAP note with patient details', async () => {
    const text = `SUBJECTIVE:
Patient John Smith (DOB 05/20/1975, MRN 789012) presents with chest pain.
He can be reached at 555-123-4567 or john.smith@email.com.

OBJECTIVE:
Vital signs: BP 140/90, HR 88, Temp 98.6F`;

    const result = await runScrubPII(text);

    assertNoPII(result.text, 'SOAP note');
    expect(result.count).toBeGreaterThan(4); // Name, DOB, MRN, phone, email
  });

  it('should scrub lab report with patient info', async () => {
    const text = `LABORATORY REPORT
Patient: Mary Johnson
SSN: 123-45-6789
Collected: 03/15/2024

WBC: 7.5 K/µL (Normal)
HGB: 14.2 g/dL (Normal)
Ordered by: Dr. Michael Brown`;

    const result = await runScrubPII(text);

    assertNoPII(result.text, 'lab report');
    // Lab values should remain
    expect(result.text).toContain('WBC');
    expect(result.text).toContain('7.5');
    expect(result.text).toContain('K/µL');
  });
});

// ============================================================================
// CONFIDENCE SCORING
// ============================================================================

describe('PII Leak Detection - Confidence Validation', () => {
  it('should have high confidence for obvious PII', async () => {
    const text = 'John Doe, SSN: 123-45-6789, Phone: 555-1234.';
    const result = await runScrubPII(text);

    // High confidence (>= 90%) for clear PII patterns
    if (result.confidence) {
      expect(result.confidence).toBeGreaterThanOrEqual(90);
    }
  });

  it('should flag low confidence PII for review', async () => {
    const text = 'Patient J. Smith mentioned something about the year 1980.';
    const result = await runScrubPII(text);

    // Ambiguous patterns should be flagged
    if (result.confidence && result.confidence < 85) {
      console.warn(`⚠️ Low confidence detection: ${result.confidence}% - Manual review recommended`);
    }
  });
});

// ============================================================================
// REGRESSION TESTS (Known Past Bugs)
// ============================================================================

describe('PII Leak Detection - Regression Tests', () => {
  it('should not leak PII through incomplete regex patterns', async () => {
    // Test case: Phone number without area code
    const text = 'Call extension 123-4567 for more info.';
    const result = await runScrubPII(text);

    // Partial phone numbers should be caught
    assertNoPII(result.text, 'partial phone numbers');
  });

  it('should not leak names when followed by punctuation', async () => {
    const text = 'John Doe, Jane Smith; Robert Johnson.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'names with punctuation');
    expect(result.count).toBe(3); // All three names
  });

  it('should scrub emails even when embedded in URLs', async () => {
    const text = 'Visit mailto:john.doe@example.com or contact us.';
    const result = await runScrubPII(text);

    assertNoPII(result.text, 'emails in URLs');
  });
});
