import { describe, it, expect } from 'vitest';
import { runScrubPII } from '../services/piiScrubber.effect';

describe('Integration Tests - Real PII Scrubbing', () => {

  it('should scrub PII with real scrubbing engine - emails detected', async () => {
    const testText = 'Contact Dr. Smith at john.doe@hospital.com for appointment';
    const result = await runScrubPII(testText);

    expect(result.text).toContain('[EMAIL_');
    expect(result.count).toBeGreaterThan(0);
    expect(Object.keys(result.replacements).length).toBeGreaterThan(0);
  });

  it('should scrub PII with real scrubbing engine - phone numbers detected', async () => {
    const testText = 'Call the clinic at (555) 123-4567 during business hours';
    const result = await runScrubPII(testText);

    expect(result.text).toContain('[PHONE_');
    expect(result.count).toBeGreaterThan(0);
  });

  it('should scrub context-aware MRN patterns', async () => {
    const testText = 'Patient MRN: ABC123XYZ is admitted to the ward';
    const result = await runScrubPII(testText);

    expect(result.text).toContain('[MRN_');
    expect(result.count).toBeGreaterThan(0);
  });


  it('should process medical text with real scrubbing', async () => {
    // Real world example of medical text with PII
    const medicalText = `
      Patient: John Michael Smith
      DOB: 03/15/1965
      MRN: HX7823LK
      Contact: (555) 234-5678
      Email: john.smith@gmail.com
      Address: 123 Main St, Springfield, IL 62701

      Clinical Note: Patient presents with hypertension.
      SSN for verification: 123-45-6789
    `;

    const result = await runScrubPII(medicalText);

    // Should have detected and scrubbed multiple PII types
    expect(result.count).toBeGreaterThan(2);
    expect(result.text).not.toContain('John Michael Smith');
    expect(result.text).not.toContain('123-45-6789');
    expect(result.text).toContain('[');
    expect(result.replacements).toBeTruthy();
  });


  it('should scrub medical text with mixed content', async () => {
    const textWithMixedContent = 'Doctor Jane Smith examined the patient. Diagnosis: hypertension.';
    const result = await runScrubPII(textWithMixedContent);

    // Should detect and scrub PII
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.text).not.toContain('Jane Smith');
    expect(result.text).toContain('[');
  });


  it('should handle heavy medical text with multiple PII instances', async () => {
    const heavyText = `
      PATIENT RECORD #AB123CD
      Name: Dr. Robert Johnson | Secondary: Margaret Wilson
      DOB: 12/25/1955
      SSN: 987-65-4321
      Contact: (512) 555-1234 or (512) 555-5678
      Email: r.johnson@doctors.org or margaret@health.com
      MRN: XYZ999PQR | Previous MRN: ABC888DEF
      Insurance ID: INSU-2024-001
      Zip Code: 78704-1234

      Clinical Assessment:
      Patient reports symptoms. Recommend follow up at 456 Oak Street.
      Secondary address: 789 Pine Avenue, Austin TX 73301
    `;

    const result = await runScrubPII(heavyText);

    // Should detect multiple entities
    expect(result.count).toBeGreaterThanOrEqual(3);
    expect(Object.keys(result.replacements).length).toBeGreaterThanOrEqual(3);
    // Original PII should be gone
    expect(result.text).not.toContain('987-65-4321');
    expect(result.text).not.toContain('Dr. Robert Johnson');
  });
});
