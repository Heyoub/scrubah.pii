import { describe, it, expect } from 'vitest';
import * as S from '@effect/schema/Schema';
import {
  ProcessingStageSchema,
  PIIMapSchema,
  ScrubResultSchema,
  ProcessingStatsSchema,
  ProcessedFileSchema,
  createQueuedFile,
  startParsing,
  startScrubbing,
  startFormatting,
  markCompleted,
  markError,
  ProcessingStage,
  decodeProcessedFile,
  decodeScrubResult,
} from './schemas';

describe('schemas.ts', () => {
  describe('ProcessingStageSchema', () => {
    it('should validate valid processing stages', () => {
      const stages = ['QUEUED', 'PARSING', 'SCRUBBING', 'FORMATTING', 'COMPLETED', 'ERROR'];
      
      stages.forEach(stage => {
        const result = S.decodeUnknownSync(ProcessingStageSchema)(stage);
        expect(result).toBe(stage);
      });
    });

    it('should reject invalid stages', () => {
      expect(() => {
        S.decodeUnknownSync(ProcessingStageSchema)('INVALID');
      }).toThrow();
    });
  });

  describe('PIIMapSchema', () => {
    it('should validate string-to-string maps', () => {
      const validMap = {
        'john.doe@example.com': '[EMAIL_1]',
        'Jane Smith': '[PER_1]',
      };

      const result = S.decodeUnknownSync(PIIMapSchema)(validMap);
      expect(result).toEqual(validMap);
    });

    it('should handle empty maps', () => {
      const emptyMap = {};
      const result = S.decodeUnknownSync(PIIMapSchema)(emptyMap);
      expect(result).toEqual(emptyMap);
    });
  });

  describe('ScrubResultSchema', () => {
    it('should validate valid scrub results', () => {
      const validResult = {
        text: 'Scrubbed text with [EMAIL_1]',
        replacements: {
          'john@example.com': '[EMAIL_1]',
        },
        count: 1,
      };

      const result = S.decodeUnknownSync(ScrubResultSchema)(validResult);
      expect(result).toEqual(validResult);
    });

    it('should enforce count matches replacements size', () => {
      const invalidResult = {
        text: 'Text',
        replacements: {
          'a': '[A]',
          'b': '[B]',
        },
        count: 1, // Should be 2
      };

      expect(() => {
        S.decodeUnknownSync(ScrubResultSchema)(invalidResult);
      }).toThrow();
    });

    it('should accept when count matches', () => {
      const validResult = {
        text: 'Text',
        replacements: {
          'a': '[A]',
          'b': '[B]',
          'c': '[C]',
        },
        count: 3,
      };

      const result = S.decodeUnknownSync(ScrubResultSchema)(validResult);
      expect(result.count).toBe(3);
    });
  });

  describe('ProcessingStatsSchema', () => {
    it('should validate processing stats', () => {
      const stats = {
        piiRemovedCount: 5,
        processingTimeMs: 1500,
      };

      const result = S.decodeUnknownSync(ProcessingStatsSchema)(stats);
      expect(result).toEqual(stats);
    });

    it('should require integer counts', () => {
      const invalidStats = {
        piiRemovedCount: 5.5,
        processingTimeMs: 1500,
      };

      expect(() => {
        S.decodeUnknownSync(ProcessingStatsSchema)(invalidStats);
      }).toThrow();
    });
  });

  describe('ProcessedFileSchema', () => {
    it('should validate complete processed file', () => {
      const file = {
        id: 'file-123',
        originalName: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        stage: 'COMPLETED',
        rawText: 'Raw content',
        scrubbedText: 'Scrubbed content',
        markdown: '# Markdown',
        stats: {
          piiRemovedCount: 3,
          processingTimeMs: 2000,
        },
      };

      const result = S.decodeUnknownSync(ProcessedFileSchema)(file);
      expect(result).toEqual(file);
    });

    it('should allow optional fields', () => {
      const minimalFile = {
        id: 'file-456',
        originalName: 'minimal.txt',
        size: 100,
        type: 'text/plain',
        stage: 'QUEUED',
      };

      const result = S.decodeUnknownSync(ProcessedFileSchema)(minimalFile);
      expect(result.id).toBe('file-456');
    });

    it('should require non-empty id', () => {
      const invalidFile = {
        id: '',
        originalName: 'test.pdf',
        size: 100,
        type: 'application/pdf',
        stage: 'QUEUED',
      };

      expect(() => {
        S.decodeUnknownSync(ProcessedFileSchema)(invalidFile);
      }).toThrow();
    });
  });

  describe('Smart Constructors', () => {
    it('should create queued file', () => {
      const file = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');

      expect(file.id).toBe('id-1');
      expect(file.originalName).toBe('test.pdf');
      expect(file.size).toBe(1024);
      expect(file.type).toBe('application/pdf');
      expect(file.stage).toBe('QUEUED');
    });

    it('should transition to parsing', () => {
      const queued = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const parsing = startParsing(queued);

      expect(parsing.stage).toBe('PARSING');
      expect(parsing.id).toBe(queued.id);
    });

    it('should transition to scrubbing with raw text', () => {
      const queued = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const scrubbing = startScrubbing(queued, 'Raw text content');

      expect(scrubbing.stage).toBe('SCRUBBING');
      expect(scrubbing.rawText).toBe('Raw text content');
    });

    it('should transition to formatting with scrubbed text', () => {
      const queued = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const formatting = startFormatting(queued, 'Scrubbed text', 5);

      expect(formatting.stage).toBe('FORMATTING');
      expect(formatting.scrubbedText).toBe('Scrubbed text');
      expect(formatting.stats?.piiRemovedCount).toBe(5);
    });

    it('should mark as completed with markdown', () => {
      const queued = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const completed = markCompleted(queued, '# Markdown', 3000);

      expect(completed.stage).toBe('COMPLETED');
      expect(completed.markdown).toBe('# Markdown');
      expect(completed.stats?.processingTimeMs).toBe(3000);
    });

    it('should mark as error with message', () => {
      const queued = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const errored = markError(queued, 'Parse failed');

      expect(errored.stage).toBe('ERROR');
      expect(errored.error).toBe('Parse failed');
    });
  });

  describe('State Machine Transitions', () => {
    it('should maintain immutability through transitions', () => {
      const original = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const parsing = startParsing(original);

      expect(original.stage).toBe('QUEUED');
      expect(parsing.stage).toBe('PARSING');
      expect(original).not.toBe(parsing);
    });

    it('should chain transitions correctly', () => {
      const file = createQueuedFile('id-1', 'test.pdf', 1024, 'application/pdf');
      const pipeline = markCompleted(
        startFormatting(
          startScrubbing(
            startParsing(file),
            'Raw'
          ),
          'Scrubbed',
          3
        ),
        '# MD',
        2000
      );

      expect(pipeline.stage).toBe('COMPLETED');
      expect(pipeline.rawText).toBe('Raw');
      expect(pipeline.scrubbedText).toBe('Scrubbed');
      expect(pipeline.markdown).toBe('# MD');
    });
  });

  describe('Decoders and Encoders', () => {
    it('should decode processed file from unknown', async () => {
      const unknownData: unknown = {
        id: 'file-1',
        originalName: 'test.pdf',
        size: 1024,
        type: 'application/pdf',
        stage: 'COMPLETED',
      };

      const result = await decodeProcessedFile(unknownData);
      
      if (result._tag === 'Right') {
        expect(result.right.id).toBe('file-1');
      }
    });

    it('should decode scrub result from unknown', async () => {
      const unknownData: unknown = {
        text: 'Scrubbed',
        replacements: { 'email@test.com': '[EMAIL_1]' },
        count: 1,
      };

      const result = await decodeScrubResult(unknownData);
      
      if (result._tag === 'Right') {
        expect(result.right.count).toBe(1);
      }
    });
  });

  describe('Legacy Compatibility', () => {
    it('should export ProcessingStage enum', () => {
      expect(ProcessingStage.QUEUED).toBe('QUEUED');
      expect(ProcessingStage.PARSING).toBe('PARSING');
      expect(ProcessingStage.SCRUBBING).toBe('SCRUBBING');
      expect(ProcessingStage.FORMATTING).toBe('FORMATTING');
      expect(ProcessingStage.COMPLETED).toBe('COMPLETED');
      expect(ProcessingStage.ERROR).toBe('ERROR');
    });
  });
});