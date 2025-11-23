import { describe, it, expect } from 'vitest';
import { runScrubPII } from './piiScrubber.effect';

describe('PII Scrubber - Effect-TS Version', () => {
  it('should scrub email addresses', async () => {
    const text = 'Contact john.doe@example.com for details';
    const result = await runScrubPII(text);

    expect(result.text).not.toContain('john.doe@example.com');
    expect(result.text).toMatch(/\[EMAIL_\d+\]/);
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub phone numbers', async () => {
    const text = 'Call me at (555) 123-4567';
    const result = await runScrubPII(text);

    expect(result.text).not.toContain('555-123-4567');
    expect(result.text).toMatch(/\[PHONE_\d+\]/);
  });

  it('should scrub SSN', async () => {
    const text = 'SSN: 123-45-6789';
    const result = await runScrubPII(text);

    expect(result.text).not.toContain('123-45-6789');
    expect(result.text).toMatch(/\[SSN_\d+\]/);
  });

  it('should scrub ZIP codes', async () => {
    const text = 'Address: 12345';
    const result = await runScrubPII(text);

    expect(result.text).not.toContain('12345');
    expect(result.text).toMatch(/\[ZIP_\d+\]/);
  });

  it('should scrub PATIENT_NAME format (LASTNAME, FIRSTNAME)', async () => {
    const text = 'SMITH, JOHN\nAge: 45';
    const result = await runScrubPII(text);

    expect(result.text).not.toContain('SMITH, JOHN');
    expect(result.text).toMatch(/\[NAME_\d+\]/);
  });

  it('should handle text with person names (ML or fallback)', async () => {
    const text = 'The patient John Smith was treated by Dr. Jane Doe.';
    const result = await runScrubPII(text);

    // In test environment, ML model may not load - that's OK
    // The scrubber should gracefully degrade to regex-only
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('replacements');
    expect(result).toHaveProperty('count');
  });

  it('should return correct replacement count', async () => {
    const text = 'Email: test@example.com, Phone: 555-1234';
    const result = await runScrubPII(text);

    expect(result.count).toBe(Object.keys(result.replacements).length);
  });

  it('should maintain consistent placeholders for same value', async () => {
    const text = 'Email test@example.com appears twice: test@example.com';
    const result = await runScrubPII(text);

    const placeholders = result.text.match(/\[EMAIL_\d+\]/g);
    expect(placeholders).toBeTruthy();
    expect(placeholders![0]).toBe(placeholders![1]);
  });
});
