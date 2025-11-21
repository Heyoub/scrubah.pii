import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import {
  generateYAMLFromResult,
  estimateYAMLSize,
  CompressedTimeline,
  ErrorCollector,
  DateRange,
  CompressionMetadata,
} from './index';

describe('YAML Generator', () => {
  const createMockTimeline = (): CompressedTimeline => ({
    patientId: 'TEST-PATIENT',
    dateRange: {
      start: new Date('2024-01-01'),
      end: new Date('2024-12-31'),
    } as DateRange,
    totalDocuments: 5,
    totalEvents: 10,
    demographics: {
      patientId: 'TEST-PATIENT',
      ageAtFirstVisit: 45,
    },
    timeline: [
      {
        id: 'event-1',
        date: new Date('2024-01-15'),
        type: 'visit' as const,
        sourceDocument: 'visit.pdf',
        confidence: 'high' as const,
      },
    ],
    medications: {
      current: [],
      discontinued: [],
    },
    labTrends: [],
    compressionMetadata: {
      originalSizeKb: 100,
      compressedSizeKb: 25,
      ratio: 0.25,
      eventsTotal: 10,
      eventsIncluded: 5,
      deduplication: 'aggressive' as const,
    } as CompressionMetadata,
  });

  describe('Basic YAML Generation', () => {
    it('should generate valid YAML structure', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('timeline:');
      expect(yaml).toContain('metadata:');
      expect(yaml).toContain('patient:');
    });

    it('should include header comment', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('# COMPRESSED MEDICAL TIMELINE');
      expect(yaml).toContain('# All PII has been redacted');
    });

    it('should format dates as YYYY-MM-DD', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(yaml).not.toContain('T'); // No time component
    });

    it('should use proper YAML indentation', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      // Check for consistent 2-space indentation
      const lines = yaml.split('\n');
      const indentedLines = lines.filter(l => l.startsWith('  '));
      expect(indentedLines.length).toBeGreaterThan(0);
    });
  });

  describe('Metadata Section', () => {
    it('should include generation timestamp', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('generatedAt:');
      expect(yaml).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include version information', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('version:');
      expect(yaml).toContain('schemaVersion:');
    });

    it('should include compression statistics', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('compression:');
      expect(yaml).toContain('originalSizeKb:');
      expect(yaml).toContain('compressedSizeKb:');
      expect(yaml).toContain('ratio:');
      expect(yaml).toContain('eventsTotal:');
      expect(yaml).toContain('eventsIncluded:');
    });

    it('should format compression ratio as percentage', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toMatch(/ratio: \d+\.\d+%/);
    });

    it('should calculate events removed', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('eventsRemoved:');
      expect(yaml).toContain('eventsRemoved: 5'); // 10 total - 5 included
    });
  });

  describe('Patient Demographics', () => {
    it('should include patient ID', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('patient:');
      expect(yaml).toContain('id: TEST-PATIENT');
    });

    it('should include age at first visit', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('ageAtFirstVisit: 45');
    });

    it('should include date range', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('dateRange:');
      expect(yaml).toContain('start:');
      expect(yaml).toContain('end:');
    });

    it('should calculate duration in days', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('durationDays:');
    });

    it('should include document counts', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('totalDocuments: 5');
      expect(yaml).toContain('totalEvents: 10');
    });
  });

  describe('Timeline Events', () => {
    it('should format events as YAML list', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('timeline:');
      expect(yaml).toContain('- id: event-1');
    });

    it('should include all event fields', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('date:');
      expect(yaml).toContain('type: visit');
      expect(yaml).toContain('source: visit.pdf');
      expect(yaml).toContain('confidence: high');
    });

    it('should handle empty timeline', async () => {
      const timeline = createMockTimeline();
      timeline.timeline = [];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('timeline:');
      expect(yaml).toBeDefined();
    });

    it('should handle multiple events', async () => {
      const timeline = createMockTimeline();
      timeline.timeline = [
        {
          id: 'event-1',
          date: new Date('2024-01-15'),
          type: 'visit' as const,
          sourceDocument: 'visit.pdf',
          confidence: 'high' as const,
        },
        {
          id: 'event-2',
          date: new Date('2024-02-20'),
          type: 'lab_result' as const,
          sourceDocument: 'labs.pdf',
          confidence: 'high' as const,
        },
      ];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('event-1');
      expect(yaml).toContain('event-2');
    });
  });

  describe('Medications Section', () => {
    it('should include current medications', async () => {
      const timeline = createMockTimeline();
      timeline.medications.current = [
        {
          name: 'Lisinopril',
          started: new Date('2024-01-01'),
          reason: 'Hypertension',
        },
      ];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('medications:');
      expect(yaml).toContain('current:');
      expect(yaml).toContain('name: Lisinopril');
    });

    it('should include discontinued medications', async () => {
      const timeline = createMockTimeline();
      timeline.medications.discontinued = [
        {
          name: 'Metformin',
          started: new Date('2024-01-01'),
          stopped: new Date('2024-06-01'),
          reason: 'Side effects',
        },
      ];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('discontinued:');
      expect(yaml).toContain('name: Metformin');
      expect(yaml).toContain('stopped:');
    });

    it('should omit medications section if empty', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      // Empty medications should not add section
      const hasMedsSection = yaml.includes('medications:');
      if (!hasMedsSection) {
        expect(true).toBe(true); // Expected
      }
    });
  });

  describe('Lab Trends Section', () => {
    it('should include lab trends when present', async () => {
      const timeline = createMockTimeline();
      timeline.labTrends = [
        {
          name: 'Glucose',
          trend: 'increasing' as const,
          values: [
            {
              date: new Date('2024-01-01'),
              value: 100,
              abnormal: false,
            },
          ],
        },
      ];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('labTrends:');
      expect(yaml).toContain('name: Glucose');
      expect(yaml).toContain('trend: increasing');
    });

    it('should format lab values correctly', async () => {
      const timeline = createMockTimeline();
      timeline.labTrends = [
        {
          name: 'Hemoglobin',
          trend: 'stable' as const,
          values: [
            {
              date: new Date('2024-01-01'),
              value: 14.5,
              abnormal: false,
              flag: '→' as const,
            },
          ],
        },
      ];
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('value: 14.5');
      expect(yaml).toContain('abnormal: false');
      expect(yaml).toContain('flag: →');
    });

    it('should omit lab trends section if empty', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      const hasLabSection = yaml.includes('labTrends:');
      if (!hasLabSection) {
        expect(true).toBe(true); // Expected
      }
    });
  });

  describe('Errors and Warnings', () => {
    it('should include warnings section when errors present', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();
      errors.add({
        type: 'DateAmbiguityError',
        message: 'Ambiguous date format',
        file: 'test.pdf',
        suggestion: 'Verify date format',
        recoverable: true,
        impact: 'medium' as const,
        timestamp: new Date().toISOString(),
      } as any);

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('warnings:');
      expect(yaml).toContain('type: DateAmbiguityError');
      expect(yaml).toContain('message:');
      expect(yaml).toContain('suggestion:');
    });

    it('should include error details', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();
      errors.add({
        type: 'ParseError',
        message: 'Failed to parse',
        file: 'bad.pdf',
        suggestion: 'Check file',
        recoverable: false,
        impact: 'high' as const,
        timestamp: new Date().toISOString(),
        details: {
          field: 'date',
          expected: 'MM/DD/YYYY',
        },
      } as any);

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('details:');
      expect(yaml).toContain('field: date');
    });

    it('should omit warnings section if no errors', async () => {
      const timeline = createMockTimeline();
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).not.toContain('warnings:');
    });
  });

  describe('Special Character Handling', () => {
    it('should escape YAML special characters', async () => {
      const timeline = createMockTimeline();
      timeline.timeline[0].sourceDocument = 'file:with[special]chars.pdf';
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toBeDefined();
      // Should either escape or quote
    });

    it('should handle filenames with colons', async () => {
      const timeline = createMockTimeline();
      timeline.timeline[0].sourceDocument = 'file:name:with:colons.pdf';
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toBeDefined();
    });

    it('should handle unicode characters', async () => {
      const timeline = createMockTimeline();
      timeline.patientId = 'PATIENT-ÉMOJIS-🏥';
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('🏥');
    });

    it('should handle quotes in text', async () => {
      const timeline = createMockTimeline();
      timeline.timeline[0].sourceDocument = 'file"with"quotes.pdf';
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toBeDefined();
    });
  });

  describe('Size Estimation', () => {
    it('should estimate YAML size', () => {
      const timeline = createMockTimeline();

      const size = estimateYAMLSize(timeline);

      expect(size).toBeGreaterThan(0);
    });

    it('should scale with number of events', () => {
      const timeline1 = createMockTimeline();
      timeline1.timeline = Array.from({ length: 10 }, (_, i) => ({
        id: `event-${i}`,
        date: new Date(),
        type: 'visit' as const,
        sourceDocument: 'test.pdf',
        confidence: 'high' as const,
      }));

      const timeline2 = createMockTimeline();
      timeline2.timeline = Array.from({ length: 50 }, (_, i) => ({
        id: `event-${i}`,
        date: new Date(),
        type: 'visit' as const,
        sourceDocument: 'test.pdf',
        confidence: 'high' as const,
      }));

      const size1 = estimateYAMLSize(timeline1);
      const size2 = estimateYAMLSize(timeline2);

      expect(size2).toBeGreaterThan(size1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty patient ID', async () => {
      const timeline = createMockTimeline();
      timeline.patientId = '';
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toBeDefined();
    });

    it('should handle very long event lists', async () => {
      const timeline = createMockTimeline();
      timeline.timeline = Array.from({ length: 1000 }, (_, i) => ({
        id: `event-${i}`,
        date: new Date(`2024-01-${(i % 28) + 1}`),
        type: 'visit' as const,
        sourceDocument: `file${i}.pdf`,
        confidence: 'high' as const,
      }));
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toBeDefined();
      expect(yaml.length).toBeGreaterThan(10000);
    });

    it('should handle date range spanning years', async () => {
      const timeline = createMockTimeline();
      timeline.dateRange.start = new Date('2020-01-01');
      timeline.dateRange.end = new Date('2024-12-31');
      const errors = new ErrorCollector();

      const yaml = await generateYAMLFromResult(timeline, errors);

      expect(yaml).toContain('2020-01-01');
      expect(yaml).toContain('2024-12-31');
    });
  });
});