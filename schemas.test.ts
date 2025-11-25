/**
 * SCHEMA VALIDATION TESTS
 *
 * Comprehensive tests for all Effect schemas in schemas.ts
 * Tests both compile-time types and runtime validation
 *
 * Coverage:
 * - Valid data passes validation
 * - Invalid data fails with correct error messages
 * - S.filter() invariants enforce business rules
 * - Decoders/encoders work correctly
 * - Edge cases and boundary conditions
 */

import { describe, it, expect } from 'vitest';
import { Schema as S, Effect, ParseResult } from 'effect';
import {
  // Enums
  ProcessingStage,
  ProcessingStageSchema,

  // Core types
  PIIMapSchema,
  ScrubResultSchema,
  ProcessedFileSchema,

  // Document fingerprinting
  DocumentType,
  DocumentTypeSchema,
  DocumentFingerprintSchema,
  DifferenceType,
  DifferenceTypeSchema,
  DuplicateAnalysisSchema,

  // Lab results
  LabStatus,
  LabStatusSchema,
  LabResultSchema,
  LabPanelSchema,

  // Timeline
  TimelineDocumentSchema,
  TimelineSummarySchema,
  MasterTimelineSchema,

  // Audit
  AuditEntrySchema,
  AuditSummarySchema,
  AuditReportSchema,

  // Decoders
  decodeProcessedFile,
  decodeLabPanel,
  decodeMasterTimeline,
  decodeAuditReport,
} from './schemas';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Helper to test schema validation
 * Uses type assertion to work with Effect Schema v3 Context parameter
 */
const expectValid = async <A, I>(
  schema: S.Schema<A, I, any>,
  input: I
): Promise<A> => {
  const result = S.decodeUnknownEither(schema as S.Schema<A, I, never>)(input);
  if (result._tag === 'Left') {
    throw new Error(`Expected valid, but got error: ${JSON.stringify(result.left)}`);
  }
  return result.right;
};

/**
 * Helper to test schema rejection
 * Uses type assertion to work with Effect Schema v3 Context parameter
 */
const expectInvalid = async <A, I>(
  schema: S.Schema<A, I, any>,
  input: unknown
): Promise<ParseResult.ParseError> => {
  const result = S.decodeUnknownEither(schema as S.Schema<A, I, never>)(input);
  if (result._tag === 'Right') {
    throw new Error(`Expected invalid, but got valid: ${JSON.stringify(result.right)}`);
  }
  return result.left;
};

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

describe('ProcessingStageSchema', () => {
  it('should validate valid processing stages', async () => {
    await expectValid(ProcessingStageSchema, 'QUEUED');
    await expectValid(ProcessingStageSchema, 'PARSING');
    await expectValid(ProcessingStageSchema, 'SCRUBBING');
    await expectValid(ProcessingStageSchema, 'FORMATTING');
    await expectValid(ProcessingStageSchema, 'COMPLETED');
    await expectValid(ProcessingStageSchema, 'ERROR');
  });

  it('should reject invalid stages', async () => {
    await expectInvalid(ProcessingStageSchema, 'INVALID');
    await expectInvalid(ProcessingStageSchema, 'queued'); // lowercase
    await expectInvalid(ProcessingStageSchema, 123);
  });
});

describe('DocumentTypeSchema', () => {
  it('should validate all document types', async () => {
    await expectValid(DocumentTypeSchema, DocumentType.LAB_REPORT);
    await expectValid(DocumentTypeSchema, DocumentType.IMAGING);
    await expectValid(DocumentTypeSchema, DocumentType.PATHOLOGY);
    await expectValid(DocumentTypeSchema, DocumentType.PROGRESS_NOTE);
    await expectValid(DocumentTypeSchema, DocumentType.MEDICATION);
    await expectValid(DocumentTypeSchema, DocumentType.DISCHARGE);
    await expectValid(DocumentTypeSchema, DocumentType.CORRESPONDENCE);
    await expectValid(DocumentTypeSchema, DocumentType.UNKNOWN);
  });

  it('should reject invalid document types', async () => {
    await expectInvalid(DocumentTypeSchema, 'invalid_type');
    await expectInvalid(DocumentTypeSchema, 'LAB REPORT'); // space instead of underscore
  });
});

describe('LabStatusSchema', () => {
  it('should validate lab statuses', async () => {
    await expectValid(LabStatusSchema, 'Normal');
    await expectValid(LabStatusSchema, 'High');
    await expectValid(LabStatusSchema, 'Low');
    await expectValid(LabStatusSchema, 'Critical');
  });

  it('should reject invalid statuses', async () => {
    await expectInvalid(LabStatusSchema, 'normal'); // lowercase
    await expectInvalid(LabStatusSchema, 'CRITICAL'); // uppercase
    await expectInvalid(LabStatusSchema, 'Abnormal');
  });
});

// ============================================================================
// CORE SCHEMAS
// ============================================================================

describe('PIIMapSchema', () => {
  it('should validate empty PII map', async () => {
    const result = await expectValid(PIIMapSchema, {});
    expect(result).toEqual({});
  });

  it('should validate PII replacements', async () => {
    const map = {
      'John Doe': '[PATIENT-001]',
      '555-1234': '[PHONE-001]',
      '123 Main St': '[ADDRESS-001]',
    };
    const result = await expectValid(PIIMapSchema, map);
    expect(result).toEqual(map);
  });

  it('should reject non-string values', async () => {
    await expectInvalid(PIIMapSchema, { name: 123 });
    await expectInvalid(PIIMapSchema, { name: null });
  });
});

describe('ScrubResultSchema', () => {
  it('should validate valid scrub result', async () => {
    const scrubResult = {
      text: 'Scrubbed text content',
      replacements: { 'John': '[PATIENT-001]' },
      count: 1,
    };
    const result = await expectValid(ScrubResultSchema, scrubResult);
    expect(result.count).toBe(1);
    expect(Object.keys(result.replacements)).toHaveLength(1);
  });

  it('should validate empty scrub result', async () => {
    const scrubResult = {
      text: 'Scrubbed text',
      replacements: {},
      count: 0,
    };
    await expectValid(ScrubResultSchema, scrubResult);
  });

  it('should reject when count does not match replacements (S.filter invariant)', async () => {
    const scrubResult = {
      text: 'Text',
      replacements: { 'John': '[PATIENT-001]', 'Jane': '[PATIENT-002]' },
      count: 1, // Says 1 but has 2 replacements
    };
    await expectInvalid(ScrubResultSchema, scrubResult);
  });

  it('should validate multiple replacements', async () => {
    const scrubResult = {
      text: 'Text',
      replacements: {
        'John Doe': '[PATIENT-001]',
        'Jane Smith': '[PATIENT-002]',
        '555-1234': '[PHONE-001]',
      },
      count: 3,
    };
    const result = await expectValid(ScrubResultSchema, scrubResult);
    expect(result.count).toBe(3);
  });
});

describe('ProcessedFileSchema', () => {
  it('should validate minimal processed file', async () => {
    const file = {
      id: 'file-123',
      originalName: 'document.pdf',
      size: 1024,
      type: 'application/pdf',
      stage: 'QUEUED' as const,
    };
    const result = await expectValid(ProcessedFileSchema, file);
    expect(result.id).toBe('file-123');
  });

  it('should validate full processed file with all fields', async () => {
    const file = {
      id: 'file-123',
      originalName: 'document.pdf',
      size: 1024,
      type: 'application/pdf',
      stage: 'COMPLETED' as const,
      rawText: 'Raw text content',
      scrubbedText: 'Scrubbed text content',
      markdown: '# Document\n\nContent',
      error: undefined,
      stats: {
        piiRemovedCount: 5,
        processingTimeMs: 1500,
      },
    };
    const result = await expectValid(ProcessedFileSchema, file);
    expect(result.stats?.piiRemovedCount).toBe(5);
  });

  it('should reject empty ID', async () => {
    const file = {
      id: '',
      originalName: 'document.pdf',
      size: 1024,
      type: 'application/pdf',
      stage: 'QUEUED' as const,
    };
    await expectInvalid(ProcessedFileSchema, file);
  });

  it('should reject empty originalName', async () => {
    const file = {
      id: 'file-123',
      originalName: '',
      size: 1024,
      type: 'application/pdf',
      stage: 'QUEUED' as const,
    };
    await expectInvalid(ProcessedFileSchema, file);
  });
});

// ============================================================================
// DOCUMENT FINGERPRINTING
// ============================================================================

describe('DocumentFingerprintSchema', () => {
  it('should validate document fingerprint', async () => {
    const fingerprint = {
      contentHash: 'abc123def456',
      simHash: '1010101010101010',
      wordCount: 150,
      dateReferences: ['2024-01-15', '2024-02-20'],
      documentType: DocumentType.LAB_REPORT,
    };
    const result = await expectValid(DocumentFingerprintSchema, fingerprint);
    expect(result.wordCount).toBe(150);
  });

  it('should reject empty contentHash', async () => {
    const fingerprint = {
      contentHash: '',
      simHash: '1010101010101010',
      wordCount: 150,
      dateReferences: [],
      documentType: DocumentType.UNKNOWN,
    };
    await expectInvalid(DocumentFingerprintSchema, fingerprint);
  });

  it('should reject negative wordCount', async () => {
    const fingerprint = {
      contentHash: 'abc123',
      simHash: '1010101010101010',
      wordCount: -1,
      dateReferences: [],
      documentType: DocumentType.UNKNOWN,
    };
    await expectInvalid(DocumentFingerprintSchema, fingerprint);
  });
});

describe('DuplicateAnalysisSchema', () => {
  it('should validate exact duplicate', async () => {
    const analysis = {
      isDuplicate: true,
      duplicateOf: 'hash123',
      similarity: 1.0,
      differenceType: 'exact' as const,
    };
    await expectValid(DuplicateAnalysisSchema, analysis);
  });

  it('should validate near duplicate', async () => {
    const analysis = {
      isDuplicate: true,
      duplicateOf: 'hash456',
      similarity: 0.95,
      differenceType: 'near-duplicate' as const,
    };
    await expectValid(DuplicateAnalysisSchema, analysis);
  });

  it('should validate same event', async () => {
    const analysis = {
      isDuplicate: false,
      duplicateOf: 'hash789',
      similarity: 0.75,
      differenceType: 'same-event' as const,
    };
    await expectValid(DuplicateAnalysisSchema, analysis);
  });

  it('should reject similarity > 1.0 (S.filter invariant)', async () => {
    const analysis = {
      isDuplicate: true,
      duplicateOf: 'hash123',
      similarity: 1.5,
      differenceType: 'exact' as const,
    };
    await expectInvalid(DuplicateAnalysisSchema, analysis);
  });

  it('should reject similarity < 0 (S.filter invariant)', async () => {
    const analysis = {
      isDuplicate: false,
      duplicateOf: 'hash123',
      similarity: -0.5,
      differenceType: 'unique' as const,
    };
    await expectInvalid(DuplicateAnalysisSchema, analysis);
  });
});

// ============================================================================
// LAB RESULTS
// ============================================================================

describe('LabResultSchema', () => {
  it('should validate complete lab result', async () => {
    const labResult = {
      testName: 'WBC',
      value: '7.5',
      unit: 'K/µL',
      referenceRange: '4.0-11.0',
      status: 'Normal' as const,
      date: '2024-01-15',
    };
    await expectValid(LabResultSchema, labResult);
  });

  it('should validate minimal lab result', async () => {
    const labResult = {
      testName: 'Glucose',
      value: '95',
      unit: 'mg/dL',
      date: '2024-01-15',
    };
    await expectValid(LabResultSchema, labResult);
  });

  it('should reject empty test name', async () => {
    const labResult = {
      testName: '',
      value: '95',
      unit: 'mg/dL',
      date: '2024-01-15',
    };
    await expectInvalid(LabResultSchema, labResult);
  });
});

describe('LabPanelSchema', () => {
  it('should validate lab panel with results', async () => {
    const panel = {
      panelName: 'Complete Blood Count (CBC)',
      date: '2024-01-15',
      results: [
        {
          testName: 'WBC',
          value: '7.5',
          unit: 'K/µL',
          referenceRange: '4.0-11.0',
          status: 'Normal' as const,
          date: '2024-01-15',
        },
        {
          testName: 'RBC',
          value: '4.8',
          unit: 'M/µL',
          referenceRange: '4.5-5.9',
          status: 'Normal' as const,
          date: '2024-01-15',
        },
      ],
    };
    await expectValid(LabPanelSchema, panel);
  });

  it('should reject panel with empty results (S.filter invariant)', async () => {
    const panel = {
      panelName: 'Empty Panel',
      date: '2024-01-15',
      results: [],
    };
    await expectInvalid(LabPanelSchema, panel);
  });

  it('should reject empty panel name', async () => {
    const panel = {
      panelName: '',
      date: '2024-01-15',
      results: [
        {
          testName: 'WBC',
          value: '7.5',
          unit: 'K/µL',
          date: '2024-01-15',
        },
      ],
    };
    await expectInvalid(LabPanelSchema, panel);
  });
});

// ============================================================================
// TIMELINE
// ============================================================================

describe('TimelineSummarySchema', () => {
  it('should validate timeline summary with correct invariants', async () => {
    const summary = {
      totalDocuments: 10,
      uniqueDocuments: 8,
      duplicates: 2,
      dateRange: {
        earliest: '2024-01-01',
        latest: '2024-12-31',
      },
      documentTypes: {
        'lab_report': 5,
        'imaging': 3,
        'progress_note': 0,
        'pathology': 0,
        'medication': 0,
        'discharge': 0,
        'correspondence': 0,
        'unknown': 2,
      },
    };
    const result = await expectValid(TimelineSummarySchema, summary);
    expect(result.totalDocuments).toBe(10);
    expect(result.uniqueDocuments).toBe(8);
    expect(result.duplicates).toBe(2);
  });

  it('should validate summary with all zero document types', async () => {
    const summary = {
      totalDocuments: 0,
      uniqueDocuments: 0,
      duplicates: 0,
      dateRange: {
        earliest: '2024-01-01',
        latest: '2024-12-31',
      },
      documentTypes: {
        'lab_report': 0,
        'imaging': 0,
        'progress_note': 0,
        'pathology': 0,
        'medication': 0,
        'discharge': 0,
        'correspondence': 0,
        'unknown': 0,
      },
    };
    await expectValid(TimelineSummarySchema, summary);
  });

  it('should reject when total != unique + duplicates (S.filter invariant)', async () => {
    const summary = {
      totalDocuments: 10,
      uniqueDocuments: 8,
      duplicates: 3, // 8 + 3 = 11 != 10
      dateRange: {
        earliest: '2024-01-01',
        latest: '2024-12-31',
      },
      documentTypes: {
        'lab_report': 0,
        'imaging': 0,
        'progress_note': 0,
        'pathology': 0,
        'medication': 0,
        'discharge': 0,
        'correspondence': 0,
        'unknown': 10,
      },
    };
    await expectInvalid(TimelineSummarySchema, summary);
  });

  it('should reject negative document counts', async () => {
    const summary = {
      totalDocuments: -1,
      uniqueDocuments: 0,
      duplicates: 0,
      dateRange: {
        earliest: '2024-01-01',
        latest: '2024-12-31',
      },
      documentTypes: {
        'lab_report': 0,
        'imaging': 0,
        'progress_note': 0,
        'pathology': 0,
        'medication': 0,
        'discharge': 0,
        'correspondence': 0,
        'unknown': 0,
      },
    };
    await expectInvalid(TimelineSummarySchema, summary);
  });
});

// ============================================================================
// AUDIT
// ============================================================================

describe('AuditEntrySchema', () => {
  it('should validate audit entry', async () => {
    const entry = {
      patternType: 'regex',
      patternName: 'ssn_pattern',
      matchCount: 2,
      replacements: [
        { original: '123-45-6789', placeholder: '[SSN-001]' },
        { original: '987-65-4321', placeholder: '[SSN-002]' },
      ],
      timestamp: Date.now(),
      durationMs: 50,
    };
    const result = await expectValid(AuditEntrySchema, entry);
    expect(result.matchCount).toBe(2);
    expect(result.replacements).toHaveLength(2);
  });

  it('should validate entry without optional durationMs', async () => {
    const entry = {
      patternType: 'ml',
      patternName: 'bert_ner',
      matchCount: 1,
      replacements: [
        { original: 'John Doe', placeholder: '[PATIENT-001]' },
      ],
      timestamp: Date.now(),
    };
    await expectValid(AuditEntrySchema, entry);
  });

  it('should reject when matchCount != replacements length (S.filter invariant)', async () => {
    const entry = {
      patternType: 'regex',
      patternName: 'ssn_pattern',
      matchCount: 5, // Says 5 but only 2 replacements
      replacements: [
        { original: '123-45-6789', placeholder: '[SSN-001]' },
        { original: '987-65-4321', placeholder: '[SSN-002]' },
      ],
      timestamp: Date.now(),
    };
    await expectInvalid(AuditEntrySchema, entry);
  });
});

describe('AuditSummarySchema', () => {
  it('should validate audit summary', async () => {
    const now = Date.now();
    const summary = {
      totalDetections: 15,
      byCategory: {
        'NAME': 5,
        'DATE': 8,
        'PHONE': 2,
      },
      totalDurationMs: 1500,
      confidenceScore: 87.5,
      startedAt: now,
      completedAt: now + 1500,
      piiDensityPercent: 5.2,
      piiCharactersRemoved: 150,
      sizeChangeBytes: -200,
      averagePiiLength: 12.5,
    };
    const result = await expectValid(AuditSummarySchema, summary);
    expect(result.totalDetections).toBe(15);
  });

  it('should reject when completedAt < startedAt (S.filter invariant)', async () => {
    const now = Date.now();
    const summary = {
      totalDetections: 15,
      byCategory: { 'NAME': 15 },
      totalDurationMs: 1500,
      confidenceScore: 87.5,
      startedAt: now,
      completedAt: now - 1000, // Completed before started!
      piiDensityPercent: 5.2,
      piiCharactersRemoved: 150,
      sizeChangeBytes: -200,
      averagePiiLength: 12.5,
    };
    await expectInvalid(AuditSummarySchema, summary);
  });

  it('should reject negative total detections', async () => {
    const now = Date.now();
    const summary = {
      totalDetections: -5,
      byCategory: {},
      totalDurationMs: 100,
      confidenceScore: 0,
      startedAt: now,
      completedAt: now + 100,
      piiDensityPercent: 0,
      piiCharactersRemoved: 0,
      sizeChangeBytes: 0,
      averagePiiLength: 0,
    };
    await expectInvalid(AuditSummarySchema, summary);
  });

  it('should reject negative totalDurationMs', async () => {
    const now = Date.now();
    const summary = {
      totalDetections: 5,
      byCategory: { 'NAME': 5 },
      totalDurationMs: -100, // Negative duration!
      confidenceScore: 85,
      startedAt: now,
      completedAt: now + 100,
      piiDensityPercent: 2.5,
      piiCharactersRemoved: 50,
      sizeChangeBytes: -50,
      averagePiiLength: 10,
    };
    await expectInvalid(AuditSummarySchema, summary);
  });
});

// ============================================================================
// DECODER INTEGRATION TESTS
// ============================================================================

describe('decodeProcessedFile', () => {
  it('should decode valid processed file', async () => {
    const input = {
      id: 'file-123',
      originalName: 'test.pdf',
      size: 1024,
      type: 'application/pdf',
      stage: 'COMPLETED',
    };

    const result = await Effect.runPromise(decodeProcessedFile(input));
    expect(result.id).toBe('file-123');
    expect(result.stage).toBe('COMPLETED');
  });

  it('should fail on invalid processed file', async () => {
    const input = {
      id: '',
      originalName: 'test.pdf',
      size: -1024,
      type: 'application/pdf',
      stage: 'INVALID',
    };

    await expect(Effect.runPromise(decodeProcessedFile(input))).rejects.toThrow();
  });
});

describe('decodeLabPanel', () => {
  it('should decode valid lab panel', async () => {
    const input = {
      panelName: 'CBC',
      date: '2024-01-15',
      results: [
        {
          testName: 'WBC',
          value: '7.5',
          unit: 'K/µL',
          date: '2024-01-15',
        },
      ],
    };

    const result = await Effect.runPromise(decodeLabPanel(input));
    expect(result.panelName).toBe('CBC');
    expect(result.results).toHaveLength(1);
  });

  it('should fail on empty results array', async () => {
    const input = {
      panelName: 'CBC',
      date: '2024-01-15',
      results: [],
    };

    await expect(Effect.runPromise(decodeLabPanel(input))).rejects.toThrow();
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle zero values correctly', async () => {
    const file = {
      id: 'file-0',
      originalName: 'empty.txt',
      size: 0, // Zero size is valid
      type: 'text/plain',
      stage: 'QUEUED' as const,
    };
    await expectValid(ProcessedFileSchema, file);
  });

  it('should handle very large numbers', async () => {
    const fingerprint = {
      contentHash: 'abc123',
      simHash: '1010101010101010',
      wordCount: 1000000, // Very large document
      dateReferences: [],
      documentType: DocumentType.UNKNOWN,
    };
    await expectValid(DocumentFingerprintSchema, fingerprint);
  });

  it('should handle Unicode in strings', async () => {
    const file = {
      id: 'file-unicode',
      originalName: 'document-日本語.pdf',
      size: 1024,
      type: 'application/pdf',
      stage: 'QUEUED' as const,
    };
    await expectValid(ProcessedFileSchema, file);
  });

  it('should handle empty arrays', async () => {
    const fingerprint = {
      contentHash: 'abc123',
      simHash: '1010101010101010',
      wordCount: 150,
      dateReferences: [], // Empty array is valid
      documentType: DocumentType.UNKNOWN,
    };
    await expectValid(DocumentFingerprintSchema, fingerprint);
  });

  it('should handle empty objects', async () => {
    const piiMap = {};
    await expectValid(PIIMapSchema, piiMap);
  });
});
