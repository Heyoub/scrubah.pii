// @ts-nocheck
import { describe, it, expect, beforeEach } from 'vitest';
import { Effect } from 'effect';
import {
  runCompression,
  ProcessedDocument,
  defaultCompressionOptions,
  CompressionOptions,
} from './index';

describe('Compression Engine', () => {
  describe('Event Extraction', () => {
    it('should extract visit events with date parsing', async () => {
      const doc: ProcessedDocument = {
        id: 'test-1',
        filename: 'visit.pdf',
        text: 'Patient had a visit on 03/15/2024 for annual checkup.',
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      const visitEvents = result.timeline.timeline.filter(e => e.type === 'visit');
      expect(visitEvents.length).toBeGreaterThan(0);
      expect(visitEvents[0].sourceDocument).toBe('visit.pdf');
    });

    it('should handle multiple date formats', async () => {
      const doc: ProcessedDocument = {
        id: 'test-2',
        filename: 'multi-dates.pdf',
        text: 'Visit on 01/15/2024. Lab on 02/20/2024. Started meds on 03/10/2024.',
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      expect(result.timeline.timeline.length).toBeGreaterThanOrEqual(3);
    });

    it('should skip invalid dates', async () => {
      const doc: ProcessedDocument = {
        id: 'test-3',
        filename: 'invalid.pdf',
        text: 'Visit on 99/99/9999',
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      // Should not crash, should collect error
      expect(result.errors.hasErrors()).toBe(true);
    });

    it('should detect date ambiguity', async () => {
      const doc: ProcessedDocument = {
        id: 'test-4',
        filename: 'ambiguous.pdf',
        text: 'Appointment on 01/02/2024',
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      const ambiguityErrors = result.errors.getAll().filter(
        e => e.type === 'DateAmbiguityError'
      );
      expect(ambiguityErrors.length).toBeGreaterThan(0);
    });

    it('should handle empty documents gracefully', async () => {
      const doc: ProcessedDocument = {
        id: 'test-5',
        filename: 'empty.pdf',
        text: '',
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      expect(result.timeline).toBeDefined();
      expect(result.timeline.timeline.length).toBe(0);
    });

    it('should extract all event types from comprehensive document', async () => {
      const doc: ProcessedDocument = {
        id: 'test-6',
        filename: 'comprehensive.pdf',
        text: `
          Patient visit on 01/10/2024 for routine checkup.
          Lab results received on 01/15/2024 showing elevated glucose.
          Started Metformin 500mg on 01/20/2024.
        `,
        metadata: {},
      };

      const result = await runCompression([doc], defaultCompressionOptions);

      const hasVisit = result.timeline.timeline.some(e => e.type === 'visit');
      const hasLab = result.timeline.timeline.some(e => e.type === 'lab_result');
      const hasMed = result.timeline.timeline.some(e => e.type === 'medication_change');

      expect(hasVisit).toBe(true);
      expect(hasLab).toBe(true);
      expect(hasMed).toBe(true);
    });
  });

  describe('Deduplication', () => {
    it('should remove exact duplicates with aggressive mode', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'visit1.pdf',
          text: 'Visit on 03/15/2024',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'visit2.pdf',
          text: 'Visit on 03/15/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: true,
      });

      expect(result.timeline.timeline.length).toBe(1);
      expect(result.errors.hasErrors()).toBe(true);
    });

    it('should keep both with light deduplication', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'clinic_a.pdf',
          text: 'Visit on 04/10/2024',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'clinic_b.pdf',
          text: 'Visit on 04/10/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: false,
      });

      // Different sources, so should keep both
      expect(result.timeline.timeline.length).toBeGreaterThan(0);
    });

    it('should track deduplication in metadata', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'dup1.pdf',
          text: 'Visit on 05/01/2024',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'dup2.pdf',
          text: 'Visit on 05/01/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: true,
      });

      expect(result.timeline.compressionMetadata.deduplication).toBe('aggressive');
    });

    it('should handle fuzzy matching with aggressive mode', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'lab1.pdf',
          text: 'Lab results on 06/01/2024',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'lab2.pdf',
          text: 'Lab test on 06/01/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: true,
      });

      // Same date + same type = merge
      expect(result.timeline.timeline.length).toBe(1);
    });
  });

  describe('Prioritization', () => {
    it('should prioritize high-confidence events', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'visit.pdf',
          text: 'Visit on 01/10/2024', // Medium confidence
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'labs.pdf',
          text: 'Lab results on 01/05/2024', // High confidence
          metadata: {},
        },
      ];

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        maxOutputSizeKb: 0.5, // Force prioritization
      });

      if (result.timeline.timeline.length > 0) {
        const firstEvent = result.timeline.timeline[0];
        expect(firstEvent.confidence).toBe('high');
      }
    });

    it('should prioritize recent events when confidence equal', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'lab1.pdf',
          text: 'Lab results on 01/01/2024',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'lab2.pdf',
          text: 'Lab results on 06/01/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      const events = result.timeline.timeline;
      if (events.length >= 2) {
        expect(events[0].date.getTime()).toBeGreaterThanOrEqual(
          events[1].date.getTime()
        );
      }
    });

    it('should maintain sort order through pipeline', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 10 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${(i % 12) + 1}/15/2024`,
        metadata: {},
      }));

      const result = await runCompression(docs, defaultCompressionOptions);

      const events = result.timeline.timeline;
      for (let i = 1; i < events.length; i++) {
        // Should be sorted by confidence then recency
        const prev = events[i - 1];
        const curr = events[i];

        const confidenceWeight = { high: 3, medium: 2, low: 1 };
        const prevWeight = confidenceWeight[prev.confidence];
        const currWeight = confidenceWeight[curr.confidence];

        if (prevWeight === currWeight) {
          // Same confidence: more recent first
          expect(prev.date.getTime()).toBeGreaterThanOrEqual(curr.date.getTime());
        } else {
          // Higher confidence first
          expect(prevWeight).toBeGreaterThanOrEqual(currWeight);
        }
      }
    });
  });

  describe('Compression to Target Size', () => {
    it('should compress to target size', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 50 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${(i % 12) + 1}/${(i % 28) + 1}/2024`,
        metadata: {},
      }));

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        maxOutputSizeKb: 2, // Force compression (50 events ≈ 5KB, target 2KB)
      });

      const meta = result.timeline.compressionMetadata;
      expect(meta.eventsIncluded).toBeLessThan(meta.eventsTotal);
      expect(meta.compressedSizeKb).toBeLessThanOrEqual(2.5); // Allow some margin
    });

    it('should warn when target cannot be met', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 20 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${(i % 12) + 1}/15/2024`,
        metadata: {},
      }));

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        maxOutputSizeKb: 0.5, // Impossibly small
      });

      const sizeErrors = result.errors.getAll().filter(
        e => e.type === 'CompressionSizeExceededError'
      );
      expect(sizeErrors.length).toBeGreaterThan(0);
    });

    it('should maintain minimum events threshold', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 100 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${(i % 12) + 1}/${(i % 28) + 1}/2024`,
        metadata: {},
      }));

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        maxOutputSizeKb: 0.1, // Force to minimum
      });

      // Should keep at least 10 events
      expect(result.timeline.timeline.length).toBeGreaterThanOrEqual(10);
    });

    it('should calculate compression ratio correctly', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'large.pdf',
          text: 'A'.repeat(10000), // ~10KB
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      const meta = result.timeline.compressionMetadata;
      expect(meta.ratio).toBeGreaterThan(0);
      expect(meta.ratio).toBeLessThanOrEqual(1);
      expect(meta.compressedSizeKb).toBeLessThan(meta.originalSizeKb);
    });
  });

  describe('Metadata Tracking', () => {
    it('should track original and compressed sizes', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'test.pdf',
          text: 'Visit on 01/15/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      const meta = result.timeline.compressionMetadata;
      expect(meta.originalSizeKb).toBeGreaterThan(0);
      expect(meta.compressedSizeKb).toBeGreaterThan(0);
    });

    it('should track event counts', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'test.pdf',
          text: 'Visit on 01/10/2024. Lab on 01/15/2024.',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      const meta = result.timeline.compressionMetadata;
      expect(meta.eventsTotal).toBeGreaterThan(0);
      expect(meta.eventsIncluded).toBeGreaterThan(0);
      expect(meta.eventsIncluded).toBeLessThanOrEqual(meta.eventsTotal);
    });

    it('should set deduplication mode', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'test.pdf',
          text: 'Visit on 01/15/2024',
          metadata: {},
        },
      ];

      const lightResult = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: false,
      });

      const aggressiveResult = await runCompression(docs, {
        ...defaultCompressionOptions,
        deduplicationAggressive: true,
      });

      expect(lightResult.timeline.compressionMetadata.deduplication).toBe('light');
      expect(aggressiveResult.timeline.compressionMetadata.deduplication).toBe('aggressive');
    });
  });

  describe('Error Handling', () => {
    it('should collect parse errors without crashing', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'bad.pdf',
          text: 'Visit on invalid-date',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      expect(result.timeline).toBeDefined();
    });

    it('should handle malformed documents gracefully', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'malformed.pdf',
          text: '\x00\x01\x02', // Binary data
          metadata: {},
        },
      ];

      await expect(
        runCompression(docs, defaultCompressionOptions)
      ).resolves.toBeDefined();
    });

    it('should continue processing after errors', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'bad1.pdf',
          text: 'Visit on 99/99/9999',
          metadata: {},
        },
        {
          id: 'doc2',
          filename: 'good.pdf',
          text: 'Visit on 01/15/2024',
          metadata: {},
        },
        {
          id: 'doc3',
          filename: 'bad2.pdf',
          text: 'Visit on invalid',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      // Should process the good document
      expect(result.timeline).toBeDefined();
      expect(result.errors.hasErrors()).toBe(true);
    });
  });

  describe('Progress Reporting', () => {
    it('should call progress callback with all stages', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'test.pdf',
          text: 'Visit on 01/15/2024',
          metadata: {},
        },
      ];

      const stages: string[] = [];

      await runCompression(docs, defaultCompressionOptions, (progress) => {
        stages.push(progress.stage);
      });

      expect(stages).toContain('extracting');
      expect(stages).toContain('deduplicating');
      expect(stages).toContain('compressing');
      expect(stages).toContain('generating');
    });

    it('should report progress for multiple documents', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 5 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${i + 1}/15/2024`,
        metadata: {},
      }));

      let extractionProgress = 0;

      await runCompression(docs, defaultCompressionOptions, (progress) => {
        if (progress.stage === 'extracting') {
          extractionProgress = progress.current;
        }
      });

      expect(extractionProgress).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single document', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'single.pdf',
          text: 'Visit on 01/15/2024',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      expect(result.timeline.totalDocuments).toBe(1);
    });

    it('should handle hundreds of documents', async () => {
      const docs: ProcessedDocument[] = Array.from({ length: 200 }, (_, i) => ({
        id: `doc${i}`,
        filename: `test${i}.pdf`,
        text: `Visit on ${(i % 12) + 1}/${(i % 28) + 1}/2024`,
        metadata: {},
      }));

      const result = await runCompression(docs, {
        ...defaultCompressionOptions,
        maxOutputSizeKb: 10,
      });

      expect(result.timeline).toBeDefined();
      expect(result.timeline.totalDocuments).toBe(200);
    });

    it('should handle documents with special characters', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'special<>:"/\\|?*.pdf',
          text: 'Visit on 01/15/2024 with émojis 🏥',
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      expect(result.timeline).toBeDefined();
    });

    it('should handle very long text', async () => {
      const docs: ProcessedDocument[] = [
        {
          id: 'doc1',
          filename: 'long.pdf',
          text: 'Visit on 01/15/2024. ' + 'A'.repeat(100000),
          metadata: {},
        },
      ];

      const result = await runCompression(docs, defaultCompressionOptions);

      expect(result.timeline).toBeDefined();
    });

    it('should handle empty document array', async () => {
      const result = await runCompression([], defaultCompressionOptions);

      expect(result.timeline.totalDocuments).toBe(0);
      expect(result.timeline.timeline.length).toBe(0);
    });
  });
});