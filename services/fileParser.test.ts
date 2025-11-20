import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseFile } from './fileParser';

// Mock external dependencies
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}));

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn(),
  },
}));

describe('File Parser - Text Files', () => {
  it('should parse plain text files', async () => {
    const content = 'Hello, this is a test document.';
    const file = new File([content], 'test.txt', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should parse CSV files', async () => {
    const content = 'Name,Age,Email\nJohn,30,john@example.com';
    const file = new File([content], 'test.csv', { type: 'text/csv' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should parse markdown files', async () => {
    const content = '# Title\n\nThis is **bold** text.';
    const file = new File([content], 'test.md', { type: 'text/markdown' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should parse JSON files', async () => {
    const content = '{"key": "value", "number": 42}';
    const file = new File([content], 'test.json', { type: 'application/json' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should handle files with .md extension regardless of mime type', async () => {
    const content = '# Markdown Content';
    const file = new File([content], 'test.md', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should handle files with .csv extension regardless of mime type', async () => {
    const content = 'a,b,c\n1,2,3';
    const file = new File([content], 'data.csv', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });
});

describe('File Parser - DOCX Files', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse DOCX files and convert to markdown', async () => {
    const mammoth = await import('mammoth');
    const mockHtml = '<h1>Title</h1><p>Content here</p>';

    vi.mocked(mammoth.default.convertToHtml).mockResolvedValue({
      value: mockHtml,
      messages: [],
    });

    const buffer = new ArrayBuffer(8);
    const file = new File([buffer], 'test.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const result = await parseFile(file);

    // Should have called mammoth
    expect(mammoth.default.convertToHtml).toHaveBeenCalled();

    // Result should contain converted content
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });

  it('should handle DOCX parsing errors gracefully', async () => {
    const mammoth = await import('mammoth');

    vi.mocked(mammoth.default.convertToHtml).mockRejectedValue(
      new Error('Failed to parse DOCX')
    );

    const buffer = new ArrayBuffer(8);
    const file = new File([buffer], 'corrupt.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await expect(parseFile(file)).rejects.toThrow();
  });
});

describe('File Parser - Image Files (OCR)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should perform OCR on image files', async () => {
    const Tesseract = await import('tesseract.js');

    const mockOcrResult = {
      data: {
        text: 'Extracted text from image',
      },
    };

    vi.mocked(Tesseract.default.recognize).mockResolvedValue(mockOcrResult as any);

    const buffer = new ArrayBuffer(100);
    const file = new File([buffer], 'scan.png', { type: 'image/png' });

    const result = await parseFile(file);

    expect(Tesseract.default.recognize).toHaveBeenCalledWith(
      file,
      'eng',
      expect.any(Object)
    );

    expect(result).toBe('Extracted text from image');
  });

  it('should handle different image formats', async () => {
    const Tesseract = await import('tesseract.js');

    const mockOcrResult = {
      data: { text: 'Text from JPEG' },
    };

    vi.mocked(Tesseract.default.recognize).mockResolvedValue(mockOcrResult as any);

    const imageFormats = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

    for (const format of imageFormats) {
      const buffer = new ArrayBuffer(100);
      const file = new File([buffer], `test.${format.split('/')[1]}`, { type: format });

      const result = await parseFile(file);
      expect(result).toBe('Text from JPEG');
    }
  });

  it('should handle OCR errors gracefully', async () => {
    const Tesseract = await import('tesseract.js');

    vi.mocked(Tesseract.default.recognize).mockRejectedValue(
      new Error('OCR failed')
    );

    const buffer = new ArrayBuffer(100);
    const file = new File([buffer], 'bad-image.png', { type: 'image/png' });

    await expect(parseFile(file)).rejects.toThrow();
  });
});

describe('File Parser - Error Handling', () => {
  it('should throw error for unsupported file types', async () => {
    const buffer = new ArrayBuffer(8);
    const file = new File([buffer], 'test.exe', { type: 'application/x-msdownload' });

    await expect(parseFile(file)).rejects.toThrow(/Unsupported file type/);
  });

  it('should provide meaningful error messages', async () => {
    const buffer = new ArrayBuffer(8);
    const file = new File([buffer], 'unknown.xyz', { type: 'application/unknown' });

    try {
      await parseFile(file);
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toContain('Failed to parse file');
    }
  });
});

describe('File Parser - Edge Cases', () => {
  it('should handle empty text files', async () => {
    const file = new File([''], 'empty.txt', { type: 'text/plain' });
    const result = await parseFile(file);
    expect(result).toBe('');
  });

  it('should handle very large text files', async () => {
    const largeContent = 'A'.repeat(1_000_000); // 1MB of text
    const file = new File([largeContent], 'large.txt', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(largeContent);
    expect(result.length).toBe(1_000_000);
  });

  it('should handle files with special characters', async () => {
    const content = 'Special chars: 你好, émojis: 🎉🎊, symbols: @#$%^&*()';
    const file = new File([content], 'special.txt', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });

  it('should handle multiline text files', async () => {
    const content = 'Line 1\nLine 2\nLine 3\n\nLine 5';
    const file = new File([content], 'multiline.txt', { type: 'text/plain' });

    const result = await parseFile(file);
    expect(result).toBe(content);
  });
});

describe('File Parser - Real-world Scenarios', () => {
  it('should parse a medical report in text format', async () => {
    const medicalReport = `
MEDICAL REPORT
Patient: John Doe
MRN: 123456
Date: 01/15/2024

DIAGNOSIS:
The patient presented with symptoms of...

TREATMENT PLAN:
1. Prescribe medication
2. Follow-up in 2 weeks
    `.trim();

    const file = new File([medicalReport], 'report.txt', { type: 'text/plain' });
    const result = await parseFile(file);

    expect(result).toBe(medicalReport);
    expect(result).toContain('MEDICAL REPORT');
    expect(result).toContain('MRN: 123456');
  });

  it('should parse CSV patient data', async () => {
    const csvData = `PatientID,Name,DOB,Diagnosis
P001,John Doe,01/15/1980,Hypertension
P002,Jane Smith,03/22/1975,Diabetes`;

    const file = new File([csvData], 'patients.csv', { type: 'text/csv' });
    const result = await parseFile(file);

    expect(result).toBe(csvData);
    expect(result).toContain('PatientID');
    expect(result).toContain('John Doe');
  });
});
