import { describe, it, expect, beforeEach } from 'vitest';
import { formatToMarkdown } from './markdownFormatter';
import { ProcessedFile, ProcessingStage, ScrubResult } from '../types';

describe('Markdown Formatter', () => {
  let mockFile: ProcessedFile;
  let mockScrubResult: ScrubResult;

  beforeEach(() => {
    mockFile = {
      id: 'test-id-123',
      originalName: 'medical-report.pdf',
      size: 50000,
      type: 'application/pdf',
      stage: ProcessingStage.COMPLETED,
    };

    mockScrubResult = {
      text: 'Patient [PER_1] visited on [DATE_1]. Email: [EMAIL_1].',
      replacements: {
        'John Doe': '[PER_1]',
        '01/15/2024': '[DATE_1]',
        'john@email.com': '[EMAIL_1]',
      },
      count: 3,
    };
  });

  describe('Frontmatter Generation', () => {
    it('should generate valid YAML frontmatter', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('---');
      expect(result).toMatch(/^---\n/);
      expect(result).toContain('source_file:');
      expect(result).toContain('processed_date:');
      expect(result).toContain('pii_scrubbed_count:');
    });

    it('should include source file name in metadata', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('source_file: "medical-report.pdf"');
    });

    it('should include file size in metadata', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('file_size_bytes: 50000');
    });

    it('should include file type in metadata', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('file_type: "application/pdf"');
    });

    it('should include PII count in metadata', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('pii_scrubbed_count: 3');
    });

    it('should include processing time in seconds', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 2500);

      expect(result).toContain('processing_seconds: "2.50"');
    });

    it('should include processing engine version', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('processing_engine: "Scrubah.PII-Local-v1"');
    });

    it('should include ISO 8601 timestamp', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      // Should contain a valid ISO timestamp
      const isoRegex = /processed_date: "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z"/;
      expect(result).toMatch(isoRegex);
    });
  });

  describe('Document Body Formatting', () => {
    it('should include the scrubbed text in the body', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('Patient [PER_1] visited on [DATE_1]');
      expect(result).toContain('Email: [EMAIL_1]');
    });

    it('should include document extraction header', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('# Document Extraction');
    });

    it('should remove excessive whitespace', () => {
      const scrubResult = {
        ...mockScrubResult,
        text: 'Line 1\n\n\n\n\nLine 2',
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      // Should collapse to max 2 newlines
      expect(result).not.toContain('\n\n\n');
    });

    it('should remove duplicate consecutive lines', () => {
      const scrubResult = {
        ...mockScrubResult,
        text: 'Short line\nShort line\nDifferent line',
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      // Duplicate "Short line" should be removed
      const shortLineCount = (result.match(/Short line/g) || []).length;
      expect(shortLineCount).toBe(1);
    });

    it('should NOT remove duplicate long lines (intentional repetition)', () => {
      const longLine =
        'This is a very long line with more than 50 characters in total for testing purposes';
      const scrubResult = {
        ...mockScrubResult,
        text: `${longLine}\n${longLine}`,
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      // Long duplicate lines should be preserved
      const count = (result.match(/This is a very long line/g) || []).length;
      expect(count).toBe(2);
    });

    it('should trim trailing whitespace from lines', () => {
      const scrubResult = {
        ...mockScrubResult,
        text: 'Line with trailing spaces   \nAnother line\t\t',
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      expect(result).not.toContain('   \n');
      expect(result).not.toMatch(/\t+$/m);
    });
  });

  describe('Footer Notice', () => {
    it('should include confidentiality notice', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('CONFIDENTIALITY NOTICE');
      expect(result).toContain('automatically scrubbed of PII');
    });

    it('should include replacement count in notice', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toContain('Original entities replaced: 3');
    });

    it('should use italics for the notice', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      expect(result).toMatch(/\*CONFIDENTIALITY NOTICE.*\*/);
    });
  });

  describe('Complete Document Structure', () => {
    it('should have proper markdown structure', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      // Check structure: frontmatter, header, body, footer
      const sections = result.split('---');

      expect(sections.length).toBeGreaterThanOrEqual(3);
      expect(result).toContain('# Document Extraction');
    });

    it('should be valid markdown', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      // Basic validation
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should have consistent line endings', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 1500);

      // Should use \n for line endings
      expect(result).not.toContain('\r\n');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty scrubbed text', () => {
      const scrubResult: ScrubResult = {
        text: '',
        replacements: {},
        count: 0,
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      expect(result).toContain('---');
      expect(result).toContain('pii_scrubbed_count: 0');
    });

    it('should handle very large documents', () => {
      const scrubResult: ScrubResult = {
        text: 'A'.repeat(1_000_000),
        replacements: {},
        count: 0,
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      expect(result.length).toBeGreaterThan(1_000_000);
      expect(result).toContain('---');
    });

    it('should handle special characters in file names', () => {
      const fileWithSpecialChars = {
        ...mockFile,
        originalName: 'report [2024] (final).pdf',
      };

      const result = formatToMarkdown(fileWithSpecialChars, mockScrubResult, 1500);

      expect(result).toContain('report [2024] (final).pdf');
    });

    it('should handle zero processing time', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 0);

      expect(result).toContain('processing_seconds: "0.00"');
    });

    it('should handle very long processing time', () => {
      const result = formatToMarkdown(mockFile, mockScrubResult, 123456);

      expect(result).toContain('processing_seconds: "123.46"');
    });

    it('should handle text with markdown special characters', () => {
      const scrubResult: ScrubResult = {
        text: '**Bold** text and _italic_ text with # headers',
        replacements: {},
        count: 0,
      };

      const result = formatToMarkdown(mockFile, scrubResult, 1500);

      // Should preserve the markdown syntax in body
      expect(result).toContain('**Bold**');
      expect(result).toContain('_italic_');
    });
  });

  describe('Real-world Medical Document Test', () => {
    it('should format a complete medical report correctly', () => {
      const medicalFile: ProcessedFile = {
        id: 'med-001',
        originalName: 'patient-chart-2024.pdf',
        size: 125000,
        type: 'application/pdf',
        stage: ProcessingStage.COMPLETED,
      };

      const medicalScrubResult: ScrubResult = {
        text: `
PATIENT CHART

Name: [PER_1]
MRN: [MRN_1]
DOB: [DATE_1]
Phone: [PHONE_1]
Email: [EMAIL_1]

VISIT SUMMARY
Patient presented on [DATE_2] with complaints of headache.
Location: [LOC_1]
Attending Physician: [PER_2]

DIAGNOSIS
Primary: Migraine
Secondary: Hypertension

TREATMENT PLAN
1. Prescribe [MEDICATION_1]
2. Follow-up in 2 weeks
        `.trim(),
        replacements: {
          'Jane Doe': '[PER_1]',
          'Dr. Smith': '[PER_2]',
          'MED123456': '[MRN_1]',
          '01/15/1985': '[DATE_1]',
          '12/20/2024': '[DATE_2]',
          '(555) 123-4567': '[PHONE_1]',
          'jane@email.com': '[EMAIL_1]',
          'General Hospital': '[LOC_1]',
        },
        count: 8,
      };

      const result = formatToMarkdown(medicalFile, medicalScrubResult, 3200);

      // Check metadata
      expect(result).toContain('source_file: "patient-chart-2024.pdf"');
      expect(result).toContain('pii_scrubbed_count: 8');
      expect(result).toContain('processing_seconds: "3.20"');

      // Check content
      expect(result).toContain('PATIENT CHART');
      expect(result).toContain('[PER_1]');
      expect(result).toContain('[MRN_1]');
      expect(result).toContain('TREATMENT PLAN');

      // Check footer
      expect(result).toContain('Original entities replaced: 8');
    });
  });
});
