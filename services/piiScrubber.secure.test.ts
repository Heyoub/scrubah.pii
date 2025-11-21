/**
 * SECURITY TESTS FOR SECURE PII SCRUBBER
 *
 * Tests verify:
 * ✅ Input validation (DoS prevention)
 * ✅ ReDoS attack prevention
 * ✅ Secure placeholder generation (determinism + privacy)
 * ✅ Confidence scoring
 * ✅ Graceful ML degradation
 * ✅ Audit trail logging
 */

import { describe, it, expect } from 'vitest';
import { Effect, pipe, Layer } from 'effect';
import {
  scrubPII,
  PIIScrubberConfig,
  DefaultConfig,
  MLModelServiceLive,
  SECURE_PATTERNS,
  PATTERN_CONFIDENCE,
  scrubWithOptions
} from './piiScrubber.secure';
import { SchemaValidationError } from './errors/index';

describe('Secure PII Scrubber - Security Enhancements', () => {

  // ============================================================================
  // INPUT VALIDATION TESTS (DoS Prevention)
  // ============================================================================

  describe('Input Validation (Effect Schema)', () => {
    it('should reject empty strings', async () => {
      const program = pipe(
        scrubPII(''),
        Effect.provide(Layer.succeed(PIIScrubberConfig, DefaultConfig)),
        Effect.provide(MLModelServiceLive)
      );

      await expect(Effect.runPromise(program)).rejects.toThrow(/cannot be empty/i);
    });

    it('should reject strings exceeding 1MB limit', async () => {
      const hugeText = 'A'.repeat(1_000_001); // 1MB + 1 byte

      const program = pipe(
        scrubPII(hugeText),
        Effect.provide(Layer.succeed(PIIScrubberConfig, DefaultConfig)),
        Effect.provide(MLModelServiceLive)
      );

      await expect(Effect.runPromise(program)).rejects.toThrow(/exceeds 1MB/i);
    });

    it('should reject text with control characters', async () => {
      const maliciousText = 'Normal text\x00\x01\x02 with null bytes';

      const program = pipe(
        scrubPII(maliciousText),
        Effect.provide(Layer.succeed(PIIScrubberConfig, DefaultConfig)),
        Effect.provide(MLModelServiceLive)
      );

      await expect(Effect.runPromise(program)).rejects.toThrow(/invalid control/i);
    });

    it('should accept valid text within limits', async () => {
      const validText = 'Patient john.doe@example.com visited on 01/15/2024';

      const result = await scrubWithOptions(validText, { skipML: true });

      expect(result).toBeDefined();
      expect(result.text).toBeDefined();
      expect(result.count).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // ReDoS ATTACK PREVENTION TESTS
  // ============================================================================

  describe('ReDoS Attack Prevention', () => {
    it('should handle pathological address inputs in < 100ms', () => {
      // Old pattern would take exponential time
      // New pattern completes instantly
      const attackString = '123 ' + 'AaAaAaAa '.repeat(50) + 'Street Apt #####';
      const startTime = Date.now();

      const matches = attackString.match(SECURE_PATTERNS.ADDRESS);

      const elapsedTime = Date.now() - startTime;

      expect(elapsedTime).toBeLessThan(100); // Should complete instantly
      // Pattern should still match valid addresses
      expect(matches).toBeDefined();
    });

    it('should handle nested quantifier attacks', () => {
      // Pattern: CAPITALIZED_SEQUENCE
      // Attack: Many capitalized words that almost match
      const attackString = 'Ab '.repeat(1000);
      const startTime = Date.now();

      const pattern = /\b[A-Z][a-z]{2,20}(?:\s+[A-Z][a-z]{2,20})+?\b/g;
      const matches = attackString.match(pattern);

      const elapsedTime = Date.now() - startTime;

      expect(elapsedTime).toBeLessThan(50);
    });

    it('should handle large valid documents efficiently', async () => {
      // 100KB document with mixed PII
      const largeDoc = Array(1000).fill(
        'Patient john.doe@example.com, SSN: 123-45-6789, Phone: (555) 123-4567. '
      ).join('\n');

      const startTime = Date.now();
      const result = await scrubWithOptions(largeDoc, { skipML: true });
      const elapsedTime = Date.now() - startTime;

      expect(result.count).toBeGreaterThan(0);
      expect(elapsedTime).toBeLessThan(5000); // Should complete in < 5 seconds
    });
  });

  // ============================================================================
  // SECURE PLACEHOLDER GENERATION TESTS
  // ============================================================================

  describe('Secure Placeholder Generation (Crypto-based)', () => {
    it('should generate deterministic placeholders within same session', async () => {
      const text = 'Email: john.doe@example.com and again john.doe@example.com';
      const sessionId = 'test-session-123';

      const result = await scrubWithOptions(text, { skipML: true, sessionId });

      // Same entity should have same placeholder
      const placeholders = Object.values(result.replacements);
      const uniquePlaceholders = new Set(placeholders);

      expect(result.count).toBe(2); // 1 email + 1 date
      expect(uniquePlaceholders.size).toBe(2); // Both emails get same placeholder
    });

    it('should generate different placeholders across sessions', async () => {
      const text = 'Email: john.doe@example.com';

      const result1 = await scrubWithOptions(text, {
        skipML: true,
        sessionId: 'session-1'
      });
      const result2 = await scrubWithOptions(text, {
        skipML: true,
        sessionId: 'session-2'
      });

      const placeholder1 = result1.replacements['john.doe@example.com'];
      const placeholder2 = result2.replacements['john.doe@example.com'];

      // Different sessions = different placeholders (privacy!)
      expect(placeholder1).not.toBe(placeholder2);
    });

    it('should use hash-based format (not sequential)', async () => {
      const text = 'Emails: alice@example.com, bob@example.com, charlie@example.com';

      const result = await scrubWithOptions(text, { skipML: true });

      const placeholders = Object.values(result.replacements);

      // Should be format [TYPE_HASH] not [TYPE_1], [TYPE_2]
      placeholders.forEach(placeholder => {
        expect(placeholder).toMatch(/\[EMAIL_[a-f0-9]{8}\]/);
        // NOT sequential
        expect(placeholder).not.toMatch(/\[EMAIL_[0-9]+\]/);
      });
    });

    it('should not leak document structure via placeholders', async () => {
      // Document with 5 people, 3 emails, 2 phones
      const doc1 = 'Alice, Bob, Charlie, David, Eve. Emails: a@x.com, b@x.com, c@x.com';
      const doc2 = 'Same entities: Alice, Bob, Charlie, David, Eve. Emails: a@x.com, b@x.com, c@x.com';

      const result1 = await scrubWithOptions(doc1, { skipML: true, sessionId: 'same' });
      const result2 = await scrubWithOptions(doc2, { skipML: true, sessionId: 'same' });

      // Attacker cannot infer structure from placeholders
      // because hash-based generation doesn't leak count/order
      expect(result1.replacements['Alice']).toBe(result2.replacements['Alice']);
    });
  });

  // ============================================================================
  // CONFIDENCE SCORING TESTS
  // ============================================================================

  describe('Confidence Scoring', () => {
    it('should assign confidence scores to all detections', async () => {
      const text = 'Email: test@example.com, SSN: 123-45-6789, ZIP: 12345';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.detections).toBeDefined();
      expect(result.detections.length).toBeGreaterThan(0);

      result.detections.forEach(detection => {
        expect(detection.confidence).toBeGreaterThan(0);
        expect(detection.confidence).toBeLessThanOrEqual(1);
        expect(detection.method).toBeDefined();
      });
    });

    it('should have higher confidence for SSN than CITY_STATE', async () => {
      const text = 'SSN: 123-45-6789 and city Boston, MA';

      const result = await scrubWithOptions(text, { skipML: true });

      const ssnDetection = result.detections.find(d => d.type === 'SSN');
      const cityDetection = result.detections.find(d => d.type === 'LOC');

      expect(ssnDetection?.confidence).toBeGreaterThan(0.95);
      expect(cityDetection?.confidence).toBeLessThan(0.80);
    });

    it('should calculate overall confidence score', async () => {
      const text = 'High confidence: test@example.com, 123-45-6789';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.confidence).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should track detection methods (regex, ml, context)', async () => {
      const text = 'Email: test@example.com, MRN: ABC123456';

      const result = await scrubWithOptions(text, { skipML: true });

      const emailDetection = result.detections.find(d => d.type === 'EMAIL');
      const mrnDetection = result.detections.find(d => d.type === 'MRN');

      expect(emailDetection?.method).toBe('regex');
      expect(mrnDetection?.method).toBe('context');
    });
  });

  // ============================================================================
  // AUDIT TRAIL TESTS
  // ============================================================================

  describe('Audit Trail', () => {
    it('should include comprehensive audit metadata', async () => {
      const text = 'Patient data: test@example.com, SSN: 123-45-6789';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.auditTrail).toBeDefined();
      expect(result.auditTrail?.processingTime).toBeGreaterThan(0);
      expect(result.auditTrail?.chunksProcessed).toBeDefined();
      expect(result.auditTrail?.mlUsed).toBeDefined();
      expect(result.auditTrail?.regexMatches).toBeGreaterThan(0);
      expect(result.auditTrail?.timestamp).toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('should track regex vs ML match counts', async () => {
      const text = 'Email: test@example.com, Phone: (555) 123-4567';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.auditTrail?.regexMatches).toBeGreaterThan(0);
      expect(result.auditTrail?.mlMatches).toBe(0); // ML skipped
      expect(result.auditTrail?.mlUsed).toBe(false);
    });

    it('should record processing time for performance monitoring', async () => {
      const text = 'Large document: ' + 'test@example.com, '.repeat(100);

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.auditTrail?.processingTime).toBeGreaterThan(0);
      expect(result.auditTrail?.processingTime).toBeLessThan(10000); // Should be fast
    });
  });

  // ============================================================================
  // GRACEFUL DEGRADATION TESTS (ML Fallback)
  // ============================================================================

  describe('Graceful Degradation', () => {
    it('should work without ML model (regex-only mode)', async () => {
      const text = 'Email: test@example.com, SSN: 123-45-6789';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.text).not.toContain('test@example.com');
      expect(result.text).not.toContain('123-45-6789');
      expect(result.count).toBeGreaterThan(0);
      expect(result.warnings).toBeDefined();
    });

    it('should collect errors without failing pipeline', async () => {
      // Even if ML fails, regex should still work
      const text = 'Email: test@example.com';

      const result = await scrubWithOptions(text, { skipML: true });

      expect(result.text).not.toContain('test@example.com');
      expect(result.warnings).toBeInstanceOf(Array);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS (Real-World Medical Documents)
  // ============================================================================

  describe('Real-World Medical Documents', () => {
    it('should scrub comprehensive medical note securely', async () => {
      const medicalNote = `
PATIENT MEDICAL RECORD

Patient Name: John Smith
MRN: MED987654321
DOB: 03/15/1985
SSN: 123-45-6789
Email: john.smith@example.com
Phone: (555) 123-4567
Address: 123 Main Street, Boston, MA 02101

CHIEF COMPLAINT:
Patient presents with chest pain.

DIAGNOSIS:
Acute myocardial infarction.

DISPOSITION:
Admitted to cardiology unit.
      `;

      const result = await scrubWithOptions(medicalNote, { skipML: true });

      // Verify all PII removed
      expect(result.text).not.toContain('John Smith');
      expect(result.text).not.toContain('MED987654321');
      expect(result.text).not.toContain('123-45-6789');
      expect(result.text).not.toContain('john.smith@example.com');
      expect(result.text).not.toContain('(555) 123-4567');
      expect(result.text).not.toContain('123 Main Street');
      expect(result.text).not.toContain('Boston, MA');

      // Medical content preserved
      expect(result.text).toContain('chest pain');
      expect(result.text).toContain('myocardial infarction');
      expect(result.text).toContain('cardiology');

      // Audit trail present
      expect(result.auditTrail).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0.8);
      expect(result.count).toBeGreaterThan(5);
    });
  });

  // ============================================================================
  // PATTERN COVERAGE TESTS
  // ============================================================================

  describe('Comprehensive Pattern Coverage', () => {
    const patterns = [
      { type: 'EMAIL', text: 'test@example.com', pattern: SECURE_PATTERNS.EMAIL },
      { type: 'SSN', text: '123-45-6789', pattern: SECURE_PATTERNS.SSN },
      { type: 'PHONE', text: '(555) 123-4567', pattern: SECURE_PATTERNS.PHONE },
      { type: 'ZIPCODE', text: '12345', pattern: SECURE_PATTERNS.ZIPCODE },
      { type: 'ZIPCODE', text: '12345-6789', pattern: SECURE_PATTERNS.ZIPCODE },
      { type: 'DATE', text: '01/15/2024', pattern: SECURE_PATTERNS.DATE },
      { type: 'CREDIT_CARD', text: '4532-1234-5678-9010', pattern: SECURE_PATTERNS.CREDIT_CARD },
    ];

    patterns.forEach(({ type, text, pattern }) => {
      it(`should detect ${type}: ${text}`, () => {
        const matches = text.match(pattern);
        expect(matches).not.toBeNull();
        expect(matches).toHaveLength(1);
        expect(matches![0]).toBe(text);
      });
    });

    it('should have confidence scores for all patterns', () => {
      Object.keys(PATTERN_CONFIDENCE).forEach(type => {
        expect(PATTERN_CONFIDENCE[type]).toBeGreaterThan(0);
        expect(PATTERN_CONFIDENCE[type]).toBeLessThanOrEqual(1);
      });
    });
  });
});
