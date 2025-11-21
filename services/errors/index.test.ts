import { describe, it, expect, beforeEach } from 'vitest';
import { ErrorCollector, ErrorSeverity } from './index';

describe('ErrorCollector', () => {
  let collector: ErrorCollector;

  beforeEach(() => {
    collector = new ErrorCollector();
  });

  describe('addError', () => {
    it('should add a warning error', () => {
      collector.addError({
        severity: ErrorSeverity.WARNING,
        code: 'TEST_WARNING',
        message: 'This is a test warning',
      });

      expect(collector.hasErrors()).toBe(true);
      expect(collector.getAll()).toHaveLength(1);
      expect(collector.getAll()[0].severity).toBe(ErrorSeverity.WARNING);
    });

    it('should add an error with metadata', () => {
      const metadata = { field: 'test', value: 123 };
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'TEST_ERROR',
        message: 'Error with metadata',
        metadata,
      });

      const errors = collector.getAll();
      expect(errors[0].metadata).toEqual(metadata);
    });

    it('should add multiple errors', () => {
      collector.addError({
        severity: ErrorSeverity.WARNING,
        code: 'WARN_1',
        message: 'Warning 1',
      });

      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Error 1',
      });

      expect(collector.getAll()).toHaveLength(2);
    });

    it('should handle context field correctly', () => {
      collector.addError({
        severity: ErrorSeverity.INFO,
        code: 'INFO_TEST',
        message: 'Info message',
        context: 'document-parser',
      });

      expect(collector.getAll()[0].context).toBe('document-parser');
    });
  });

  describe('addWarning', () => {
    it('should add a warning with convenience method', () => {
      collector.addWarning('WARN_CODE', 'Warning message');

      const errors = collector.getAll();
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe(ErrorSeverity.WARNING);
      expect(errors[0].code).toBe('WARN_CODE');
      expect(errors[0].message).toBe('Warning message');
    });

    it('should add warning with metadata', () => {
      const meta = { line: 42 };
      collector.addWarning('WARN_META', 'Warning with metadata', meta);

      expect(collector.getAll()[0].metadata).toEqual(meta);
    });
  });

  describe('addInfo', () => {
    it('should add an info message', () => {
      collector.addInfo('INFO_CODE', 'Info message');

      const errors = collector.getAll();
      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe(ErrorSeverity.INFO);
    });
  });

  describe('hasErrors', () => {
    it('should return false when no errors added', () => {
      expect(collector.hasErrors()).toBe(false);
    });

    it('should return true when errors added', () => {
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR',
        message: 'Error',
      });

      expect(collector.hasErrors()).toBe(true);
    });

    it('should return true even with only warnings', () => {
      collector.addWarning('WARN', 'Warning');
      expect(collector.hasErrors()).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return empty array initially', () => {
      expect(collector.getAll()).toEqual([]);
    });

    it('should return all errors in order', () => {
      collector.addWarning('WARN_1', 'First');
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Second',
      });
      collector.addInfo('INFO_1', 'Third');

      const errors = collector.getAll();
      expect(errors).toHaveLength(3);
      expect(errors[0].message).toBe('First');
      expect(errors[1].message).toBe('Second');
      expect(errors[2].message).toBe('Third');
    });

    it('should return a copy of errors array', () => {
      collector.addWarning('WARN', 'Test');
      const errors1 = collector.getAll();
      const errors2 = collector.getAll();

      expect(errors1).not.toBe(errors2);
      expect(errors1).toEqual(errors2);
    });
  });

  describe('getByCode', () => {
    beforeEach(() => {
      collector.addWarning('CODE_A', 'Message A1');
      collector.addWarning('CODE_B', 'Message B1');
      collector.addWarning('CODE_A', 'Message A2');
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'CODE_C',
        message: 'Message C1',
      });
    });

    it('should return errors matching the code', () => {
      const errors = collector.getByCode('CODE_A');
      expect(errors).toHaveLength(2);
      expect(errors[0].message).toBe('Message A1');
      expect(errors[1].message).toBe('Message A2');
    });

    it('should return empty array for non-existent code', () => {
      expect(collector.getByCode('NON_EXISTENT')).toEqual([]);
    });

    it('should return single error for unique code', () => {
      expect(collector.getByCode('CODE_C')).toHaveLength(1);
    });
  });

  describe('getBySeverity', () => {
    beforeEach(() => {
      collector.addWarning('WARN_1', 'Warning 1');
      collector.addWarning('WARN_2', 'Warning 2');
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Error 1',
      });
      collector.addInfo('INFO_1', 'Info 1');
    });

    it('should return warnings', () => {
      const warnings = collector.getBySeverity(ErrorSeverity.WARNING);
      expect(warnings).toHaveLength(2);
      expect(warnings.every((e) => e.severity === ErrorSeverity.WARNING)).toBe(true);
    });

    it('should return errors', () => {
      const errors = collector.getBySeverity(ErrorSeverity.ERROR);
      expect(errors).toHaveLength(1);
      expect(errors[0].code).toBe('ERR_1');
    });

    it('should return info messages', () => {
      const infos = collector.getBySeverity(ErrorSeverity.INFO);
      expect(infos).toHaveLength(1);
    });

    it('should return empty array for severity with no matches', () => {
      const criticals = collector.getBySeverity(ErrorSeverity.CRITICAL);
      expect(criticals).toEqual([]);
    });
  });

  describe('getByContext', () => {
    beforeEach(() => {
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Error in parser',
        context: 'parser',
      });
      collector.addError({
        severity: ErrorSeverity.WARNING,
        code: 'WARN_1',
        message: 'Warning in parser',
        context: 'parser',
      });
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_2',
        message: 'Error in validator',
        context: 'validator',
      });
    });

    it('should return errors for specific context', () => {
      const parserErrors = collector.getByContext('parser');
      expect(parserErrors).toHaveLength(2);
      expect(parserErrors.every((e) => e.context === 'parser')).toBe(true);
    });

    it('should return empty array for non-existent context', () => {
      expect(collector.getByContext('non-existent')).toEqual([]);
    });

    it('should filter errors without context', () => {
      collector.addWarning('NO_CONTEXT', 'Error without context');
      const noContext = collector.getByContext(undefined);
      expect(noContext).toHaveLength(1);
    });
  });

  describe('clear', () => {
    it('should clear all errors', () => {
      collector.addWarning('WARN', 'Warning');
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR',
        message: 'Error',
      });

      expect(collector.hasErrors()).toBe(true);

      collector.clear();

      expect(collector.hasErrors()).toBe(false);
      expect(collector.getAll()).toEqual([]);
    });

    it('should allow adding errors after clear', () => {
      collector.addWarning('WARN_1', 'Warning 1');
      collector.clear();
      collector.addWarning('WARN_2', 'Warning 2');

      expect(collector.getAll()).toHaveLength(1);
      expect(collector.getAll()[0].code).toBe('WARN_2');
    });
  });

  describe('count', () => {
    it('should return 0 for empty collector', () => {
      expect(collector.count()).toBe(0);
    });

    it('should return correct count', () => {
      collector.addWarning('WARN_1', 'Warning 1');
      collector.addWarning('WARN_2', 'Warning 2');
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Error 1',
      });

      expect(collector.count()).toBe(3);
    });

    it('should update count after clear', () => {
      collector.addWarning('WARN', 'Warning');
      expect(collector.count()).toBe(1);

      collector.clear();
      expect(collector.count()).toBe(0);
    });
  });

  describe('hasSeverity', () => {
    beforeEach(() => {
      collector.addWarning('WARN_1', 'Warning');
      collector.addInfo('INFO_1', 'Info');
    });

    it('should return true for existing severity', () => {
      expect(collector.hasSeverity(ErrorSeverity.WARNING)).toBe(true);
      expect(collector.hasSeverity(ErrorSeverity.INFO)).toBe(true);
    });

    it('should return false for non-existent severity', () => {
      expect(collector.hasSeverity(ErrorSeverity.ERROR)).toBe(false);
      expect(collector.hasSeverity(ErrorSeverity.CRITICAL)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON format', () => {
      collector.addWarning('WARN_1', 'Warning message', { field: 'test' });
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'ERR_1',
        message: 'Error message',
        context: 'test-context',
      });

      const json = collector.toJSON();

      expect(json.totalCount).toBe(2);
      expect(json.errors).toHaveLength(2);
      expect(json.errors[0]).toMatchObject({
        severity: ErrorSeverity.WARNING,
        code: 'WARN_1',
        message: 'Warning message',
      });
    });

    it('should include timestamps in JSON output', () => {
      collector.addWarning('WARN', 'Test');
      const json = collector.toJSON();

      expect(json.errors[0]).toHaveProperty('timestamp');
      expect(typeof json.errors[0].timestamp).toBe('string');
    });

    it('should serialize empty collector', () => {
      const json = collector.toJSON();

      expect(json.totalCount).toBe(0);
      expect(json.errors).toEqual([]);
    });
  });

  describe('ErrorSeverity enum', () => {
    it('should have all expected severity levels', () => {
      expect(ErrorSeverity.INFO).toBe('INFO');
      expect(ErrorSeverity.WARNING).toBe('WARNING');
      expect(ErrorSeverity.ERROR).toBe('ERROR');
      expect(ErrorSeverity.CRITICAL).toBe('CRITICAL');
    });
  });

  describe('edge cases', () => {
    it('should handle very long error messages', () => {
      const longMessage = 'A'.repeat(10000);
      collector.addWarning('LONG', longMessage);

      expect(collector.getAll()[0].message).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const specialMessage = 'Error: <script>alert("XSS")</script>';
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'SPECIAL',
        message: specialMessage,
      });

      expect(collector.getAll()[0].message).toBe(specialMessage);
    });

    it('should handle null/undefined in metadata', () => {
      collector.addWarning('META_NULL', 'Test', { value: null, undef: undefined });

      const error = collector.getAll()[0];
      expect(error.metadata).toHaveProperty('value', null);
      expect(error.metadata).toHaveProperty('undef', undefined);
    });

    it('should handle nested metadata objects', () => {
      const nestedMeta = {
        level1: {
          level2: {
            level3: 'deep value',
          },
        },
      };

      collector.addWarning('NESTED', 'Test', nestedMeta);

      expect(collector.getAll()[0].metadata).toEqual(nestedMeta);
    });

    it('should handle concurrent error additions', () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(collector.addWarning(`WARN_${i}`, `Message ${i}`))
      );

      return Promise.all(promises).then(() => {
        expect(collector.count()).toBe(100);
      });
    });
  });

  describe('filtering combinations', () => {
    beforeEach(() => {
      collector.addError({
        severity: ErrorSeverity.WARNING,
        code: 'CODE_A',
        message: 'Warning A',
        context: 'ctx1',
      });
      collector.addError({
        severity: ErrorSeverity.ERROR,
        code: 'CODE_A',
        message: 'Error A',
        context: 'ctx2',
      });
      collector.addError({
        severity: ErrorSeverity.WARNING,
        code: 'CODE_B',
        message: 'Warning B',
        context: 'ctx1',
      });
    });

    it('should support filtering by code then severity', () => {
      const codeAErrors = collector.getByCode('CODE_A');
      const warnings = codeAErrors.filter((e) => e.severity === ErrorSeverity.WARNING);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toBe('Warning A');
    });

    it('should support filtering by context then code', () => {
      const ctx1Errors = collector.getByContext('ctx1');
      const codeA = ctx1Errors.filter((e) => e.code === 'CODE_A');

      expect(codeA).toHaveLength(1);
      expect(codeA[0].severity).toBe(ErrorSeverity.WARNING);
    });
  });
});