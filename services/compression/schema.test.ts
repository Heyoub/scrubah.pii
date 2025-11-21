import { describe, it, expect } from 'vitest';
import * as S from '@effect/schema/Schema';
import {
  CompressionOptionsSchema,
  CompressedTimelineSchema,
  ProcessedDocumentSchema,
  TimelineEventSchema,
  CompressionMetadataSchema,
} from './schema';

describe('ProcessedDocumentSchema', () => {
  it('should validate a valid document', () => {
    const validDoc = {
      id: 'doc-123',
      filename: 'test.txt',
      text: 'Document content here',
      metadata: {
        documentType: 'medical-record',
      },
    };

    const result = S.decodeUnknownSync(ProcessedDocumentSchema)(validDoc);
    expect(result).toEqual(validDoc);
  });

  it('should allow optional metadata fields', () => {
    const docWithoutMetadata = {
      id: 'doc-456',
      filename: 'file.pdf',
      text: 'Content',
    };

    const result = S.decodeUnknownSync(ProcessedDocumentSchema)(docWithoutMetadata);
    expect(result.metadata).toBeUndefined();
  });

  it('should reject invalid document structure', () => {
    const invalidDoc = {
      id: 'doc-789',
      // missing filename and text
    };

    expect(() => {
      S.decodeUnknownSync(ProcessedDocumentSchema)(invalidDoc);
    }).toThrow();
  });

  it('should validate id as string', () => {
    const invalidId = {
      id: 12345, // number instead of string
      filename: 'test.txt',
      text: 'Content',
    };

    expect(() => {
      S.decodeUnknownSync(ProcessedDocumentSchema)(invalidId);
    }).toThrow();
  });

  it('should handle empty text', () => {
    const emptyText = {
      id: 'doc-empty',
      filename: 'empty.txt',
      text: '',
    };

    const result = S.decodeUnknownSync(ProcessedDocumentSchema)(emptyText);
    expect(result.text).toBe('');
  });

  it('should handle long text content', () => {
    const longDoc = {
      id: 'doc-long',
      filename: 'long.txt',
      text: 'A'.repeat(100000),
    };

    const result = S.decodeUnknownSync(ProcessedDocumentSchema)(longDoc);
    expect(result.text.length).toBe(100000);
  });

  it('should preserve metadata structure', () => {
    const docWithMetadata = {
      id: 'doc-meta',
      filename: 'meta.txt',
      text: 'Content',
      metadata: {
        documentType: 'lab-result',
        date: '2024-01-01',
        customField: 'value',
      },
    };

    const result = S.decodeUnknownSync(ProcessedDocumentSchema)(docWithMetadata);
    expect(result.metadata).toEqual(docWithMetadata.metadata);
  });
});

describe('TimelineEventSchema', () => {
  it('should validate a complete timeline event', () => {
    const validEvent = {
      id: 'event-1',
      timestamp: '2024-01-15T10:30:00Z',
      description: 'Patient admitted to ER',
      source: 'admission-record.pdf',
      category: 'admission',
      importance: 8,
    };

    const result = S.decodeUnknownSync(TimelineEventSchema)(validEvent);
    expect(result).toEqual(validEvent);
  });

  it('should allow optional fields', () => {
    const minimalEvent = {
      id: 'event-2',
      timestamp: '2024-01-15',
      description: 'Basic event',
      source: 'source.txt',
    };

    const result = S.decodeUnknownSync(TimelineEventSchema)(minimalEvent);
    expect(result.category).toBeUndefined();
    expect(result.importance).toBeUndefined();
  });

  it('should validate importance range', () => {
    const highImportance = {
      id: 'event-3',
      timestamp: '2024-01-15',
      description: 'Critical event',
      source: 'critical.pdf',
      importance: 10,
    };

    const result = S.decodeUnknownSync(TimelineEventSchema)(highImportance);
    expect(result.importance).toBe(10);
  });

  it('should handle various timestamp formats', () => {
    const timestamps = [
      '2024-01-15',
      '2024-01-15T10:30:00',
      '2024-01-15T10:30:00Z',
      '2024-01-15T10:30:00-05:00',
    ];

    timestamps.forEach((timestamp) => {
      const event = {
        id: 'event-ts',
        timestamp,
        description: 'Test',
        source: 'test.txt',
      };

      const result = S.decodeUnknownSync(TimelineEventSchema)(event);
      expect(result.timestamp).toBe(timestamp);
    });
  });

  it('should handle empty description', () => {
    const emptyDesc = {
      id: 'event-empty',
      timestamp: '2024-01-15',
      description: '',
      source: 'source.txt',
    };

    const result = S.decodeUnknownSync(TimelineEventSchema)(emptyDesc);
    expect(result.description).toBe('');
  });

  it('should reject missing required fields', () => {
    const incomplete = {
      id: 'event-incomplete',
      timestamp: '2024-01-15',
      // missing description and source
    };

    expect(() => {
      S.decodeUnknownSync(TimelineEventSchema)(incomplete);
    }).toThrow();
  });
});

describe('CompressionMetadataSchema', () => {
  it('should validate complete metadata', () => {
    const validMetadata = {
      originalSizeKb: 150.5,
      compressedSizeKb: 45.2,
      ratio: 0.3,
      eventsTotal: 100,
      eventsIncluded: 75,
      compressionDate: '2024-01-15T12:00:00Z',
    };

    const result = S.decodeUnknownSync(CompressionMetadataSchema)(validMetadata);
    expect(result).toEqual(validMetadata);
  });

  it('should handle zero sizes', () => {
    const zeroMetadata = {
      originalSizeKb: 0,
      compressedSizeKb: 0,
      ratio: 0,
      eventsTotal: 0,
      eventsIncluded: 0,
      compressionDate: '2024-01-15T12:00:00Z',
    };

    const result = S.decodeUnknownSync(CompressionMetadataSchema)(zeroMetadata);
    expect(result.originalSizeKb).toBe(0);
  });

  it('should handle large file sizes', () => {
    const largeMetadata = {
      originalSizeKb: 10000000,
      compressedSizeKb: 1000000,
      ratio: 0.1,
      eventsTotal: 50000,
      eventsIncluded: 25000,
      compressionDate: '2024-01-15T12:00:00Z',
    };

    const result = S.decodeUnknownSync(CompressionMetadataSchema)(largeMetadata);
    expect(result.originalSizeKb).toBe(10000000);
  });

  it('should validate ratio bounds', () => {
    const ratios = [0, 0.5, 1.0];

    ratios.forEach((ratio) => {
      const metadata = {
        originalSizeKb: 100,
        compressedSizeKb: ratio * 100,
        ratio,
        eventsTotal: 100,
        eventsIncluded: 100,
        compressionDate: '2024-01-15T12:00:00Z',
      };

      const result = S.decodeUnknownSync(CompressionMetadataSchema)(metadata);
      expect(result.ratio).toBe(ratio);
    });
  });

  it('should reject negative values', () => {
    const negativeSize = {
      originalSizeKb: -100,
      compressedSizeKb: 50,
      ratio: 0.5,
      eventsTotal: 100,
      eventsIncluded: 75,
      compressionDate: '2024-01-15T12:00:00Z',
    };

    expect(() => {
      S.decodeUnknownSync(CompressionMetadataSchema)(negativeSize);
    }).toThrow();
  });
});

describe('CompressedTimelineSchema', () => {
  it('should validate a complete compressed timeline', () => {
    const validTimeline = {
      events: [
        {
          id: 'event-1',
          timestamp: '2024-01-15',
          description: 'Event 1',
          source: 'source1.txt',
        },
        {
          id: 'event-2',
          timestamp: '2024-01-16',
          description: 'Event 2',
          source: 'source2.txt',
        },
      ],
      compressionMetadata: {
        originalSizeKb: 200,
        compressedSizeKb: 50,
        ratio: 0.25,
        eventsTotal: 150,
        eventsIncluded: 2,
        compressionDate: '2024-01-20T10:00:00Z',
      },
    };

    const result = S.decodeUnknownSync(CompressedTimelineSchema)(validTimeline);
    expect(result.events).toHaveLength(2);
    expect(result.compressionMetadata.ratio).toBe(0.25);
  });

  it('should handle empty events array', () => {
    const emptyTimeline = {
      events: [],
      compressionMetadata: {
        originalSizeKb: 100,
        compressedSizeKb: 0,
        ratio: 0,
        eventsTotal: 100,
        eventsIncluded: 0,
        compressionDate: '2024-01-20T10:00:00Z',
      },
    };

    const result = S.decodeUnknownSync(CompressedTimelineSchema)(emptyTimeline);
    expect(result.events).toEqual([]);
  });

  it('should validate large event arrays', () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({
      id: `event-${i}`,
      timestamp: '2024-01-15',
      description: `Description ${i}`,
      source: `source${i}.txt`,
    }));

    const timeline = {
      events,
      compressionMetadata: {
        originalSizeKb: 5000,
        compressedSizeKb: 500,
        ratio: 0.1,
        eventsTotal: 2000,
        eventsIncluded: 1000,
        compressionDate: '2024-01-20T10:00:00Z',
      },
    };

    const result = S.decodeUnknownSync(CompressedTimelineSchema)(timeline);
    expect(result.events).toHaveLength(1000);
  });

  it('should reject timeline without metadata', () => {
    const noMetadata = {
      events: [
        {
          id: 'event-1',
          timestamp: '2024-01-15',
          description: 'Event',
          source: 'source.txt',
        },
      ],
    };

    expect(() => {
      S.decodeUnknownSync(CompressedTimelineSchema)(noMetadata);
    }).toThrow();
  });
});

describe('CompressionOptionsSchema', () => {
  it('should validate default options', () => {
    const defaultOptions = {
      maxOutputSizeKb: 100,
      prioritizeMedicalEvents: true,
      preserveTimestamps: true,
      includeMetadata: true,
    };

    const result = S.decodeUnknownSync(CompressionOptionsSchema)(defaultOptions);
    expect(result).toEqual(defaultOptions);
  });

  it('should handle minimal options', () => {
    const minimalOptions = {
      maxOutputSizeKb: 50,
    };

    const result = S.decodeUnknownSync(CompressionOptionsSchema)(minimalOptions);
    expect(result.maxOutputSizeKb).toBe(50);
  });

  it('should validate boolean flags', () => {
    const allFalse = {
      maxOutputSizeKb: 100,
      prioritizeMedicalEvents: false,
      preserveTimestamps: false,
      includeMetadata: false,
    };

    const result = S.decodeUnknownSync(CompressionOptionsSchema)(allFalse);
    expect(result.prioritizeMedicalEvents).toBe(false);
  });

  it('should reject invalid max size', () => {
    const invalidSize = {
      maxOutputSizeKb: -50,
    };

    expect(() => {
      S.decodeUnknownSync(CompressionOptionsSchema)(invalidSize);
    }).toThrow();
  });

  it('should handle large max sizes', () => {
    const largeSize = {
      maxOutputSizeKb: 10000,
    };

    const result = S.decodeUnknownSync(CompressionOptionsSchema)(largeSize);
    expect(result.maxOutputSizeKb).toBe(10000);
  });

  it('should reject non-numeric max size', () => {
    const wrongType = {
      maxOutputSizeKb: '100',
    };

    expect(() => {
      S.decodeUnknownSync(CompressionOptionsSchema)(wrongType);
    }).toThrow();
  });
});

describe('Schema integration', () => {
  it('should compose schemas correctly', () => {
    const fullData = {
      documents: [
        {
          id: 'doc-1',
          filename: 'test.txt',
          text: 'Content',
        },
      ],
      timeline: {
        events: [
          {
            id: 'event-1',
            timestamp: '2024-01-15',
            description: 'Event',
            source: 'doc-1',
          },
        ],
        compressionMetadata: {
          originalSizeKb: 100,
          compressedSizeKb: 30,
          ratio: 0.3,
          eventsTotal: 50,
          eventsIncluded: 1,
          compressionDate: '2024-01-20T10:00:00Z',
        },
      },
      options: {
        maxOutputSizeKb: 100,
        prioritizeMedicalEvents: true,
      },
    };

    // Validate each component
    fullData.documents.forEach((doc) => {
      expect(() => S.decodeUnknownSync(ProcessedDocumentSchema)(doc)).not.toThrow();
    });

    expect(() => {
      S.decodeUnknownSync(CompressedTimelineSchema)(fullData.timeline);
    }).not.toThrow();

    expect(() => {
      S.decodeUnknownSync(CompressionOptionsSchema)(fullData.options);
    }).not.toThrow();
  });

  it('should handle encoding and decoding round trip', () => {
    const event = {
      id: 'event-rt',
      timestamp: '2024-01-15T10:00:00Z',
      description: 'Round trip test',
      source: 'test.txt',
      category: 'test',
      importance: 5,
    };

    const encoded = S.encodeSync(TimelineEventSchema)(event);
    const decoded = S.decodeUnknownSync(TimelineEventSchema)(encoded);

    expect(decoded).toEqual(event);
  });
});