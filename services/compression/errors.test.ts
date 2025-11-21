import { describe, it, expect } from 'vitest';
import {
  CompressionError,
  ValidationError,
  EngineError,
  YAMLGenerationError,
} from './errors';

describe('CompressionError', () => {
  it('should create error with message', () => {
    const error = new CompressionError('Test compression error');

    expect(error.message).toBe('Test compression error');
    expect(error.name).toBe('CompressionError');
    expect(error).toBeInstanceOf(Error);
  });

  it('should preserve stack trace', () => {
    const error = new CompressionError('Stack test');

    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('CompressionError');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new CompressionError('Throwable test');
    }).toThrow(CompressionError);

    expect(() => {
      throw new CompressionError('Message test');
    }).toThrow('Message test');
  });
});

describe('ValidationError', () => {
  it('should create validation error with message', () => {
    const error = new ValidationError('Invalid input data');

    expect(error.message).toBe('Invalid input data');
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(CompressionError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct inheritance chain', () => {
    const error = new ValidationError('Test');

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(CompressionError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should be distinguishable from other error types', () => {
    const validationError = new ValidationError('Validation failed');
    const engineError = new EngineError('Engine failed');

    expect(validationError).toBeInstanceOf(ValidationError);
    expect(validationError).not.toBeInstanceOf(EngineError);
    expect(engineError).not.toBeInstanceOf(ValidationError);
  });

  it('should preserve custom error properties', () => {
    const error = new ValidationError('Custom validation error');

    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Custom validation error');
  });
});

describe('EngineError', () => {
  it('should create engine error with message', () => {
    const error = new EngineError('Engine processing failed');

    expect(error.message).toBe('Engine processing failed');
    expect(error.name).toBe('EngineError');
    expect(error).toBeInstanceOf(CompressionError);
  });

  it('should handle empty message', () => {
    const error = new EngineError('');

    expect(error.message).toBe('');
    expect(error.name).toBe('EngineError');
  });

  it('should handle long error messages', () => {
    const longMessage = 'Error: '.repeat(1000);
    const error = new EngineError(longMessage);

    expect(error.message).toBe(longMessage);
  });

  it('should capture stack trace at creation point', () => {
    function createError() {
      return new EngineError('Stack capture test');
    }

    const error = createError();
    expect(error.stack).toContain('createError');
  });
});

describe('YAMLGenerationError', () => {
  it('should create YAML generation error', () => {
    const error = new YAMLGenerationError('YAML serialization failed');

    expect(error.message).toBe('YAML serialization failed');
    expect(error.name).toBe('YAMLGenerationError');
    expect(error).toBeInstanceOf(CompressionError);
  });

  it('should work with instanceof checks', () => {
    const error = new YAMLGenerationError('Test');

    expect(error).toBeInstanceOf(YAMLGenerationError);
    expect(error).toBeInstanceOf(CompressionError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should be catchable specifically', () => {
    try {
      throw new YAMLGenerationError('Specific catch');
    } catch (err) {
      expect(err).toBeInstanceOf(YAMLGenerationError);
      if (err instanceof YAMLGenerationError) {
        expect(err.message).toBe('Specific catch');
      }
    }
  });
});

describe('Error type checking and handling', () => {
  it('should allow catching all compression errors', () => {
    const errors = [
      new ValidationError('Validation failed'),
      new EngineError('Engine failed'),
      new YAMLGenerationError('YAML failed'),
    ];

    errors.forEach((error) => {
      expect(error).toBeInstanceOf(CompressionError);
    });
  });

  it('should allow specific error handling', () => {
    function processData(shouldFail: 'validation' | 'engine' | 'yaml' | 'none') {
      switch (shouldFail) {
        case 'validation':
          throw new ValidationError('Validation error');
        case 'engine':
          throw new EngineError('Engine error');
        case 'yaml':
          throw new YAMLGenerationError('YAML error');
        default:
          return 'success';
      }
    }

    expect(() => processData('validation')).toThrow(ValidationError);
    expect(() => processData('engine')).toThrow(EngineError);
    expect(() => processData('yaml')).toThrow(YAMLGenerationError);
    expect(processData('none')).toBe('success');
  });

  it('should preserve error context through re-throw', () => {
    function innerFunction() {
      throw new ValidationError('Inner error');
    }

    function outerFunction() {
      try {
        innerFunction();
      } catch (err) {
        if (err instanceof ValidationError) {
          throw new EngineError(`Engine wrapper: ${err.message}`);
        }
        throw err;
      }
    }

    expect(() => outerFunction()).toThrow(EngineError);
    expect(() => outerFunction()).toThrow('Engine wrapper: Inner error');
  });

  it('should work with Promise rejections', async () => {
    const promise = Promise.reject(new ValidationError('Async validation error'));

    await expect(promise).rejects.toThrow(ValidationError);
    await expect(promise).rejects.toThrow('Async validation error');
  });

  it('should support error serialization', () => {
    const error = new EngineError('Serialization test');
    const serialized = JSON.stringify({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });

    expect(serialized).toContain('EngineError');
    expect(serialized).toContain('Serialization test');
  });
});

describe('Error message formatting', () => {
  it('should handle multiline messages', () => {
    const multilineMessage = `Error on line 1
Error on line 2
Error on line 3`;
    const error = new ValidationError(multilineMessage);

    expect(error.message).toBe(multilineMessage);
  });

  it('should handle special characters', () => {
    const specialChars = 'Error with "quotes", \'apostrophes\', and \n newlines';
    const error = new EngineError(specialChars);

    expect(error.message).toBe(specialChars);
  });

  it('should handle Unicode characters', () => {
    const unicode = '错误: データエラー, خطأ';
    const error = new YAMLGenerationError(unicode);

    expect(error.message).toBe(unicode);
  });

  it('should handle empty and whitespace messages', () => {
    const emptyError = new ValidationError('');
    const whitespaceError = new ValidationError('   ');

    expect(emptyError.message).toBe('');
    expect(whitespaceError.message).toBe('   ');
  });
});

describe('Error inheritance and polymorphism', () => {
  it('should allow polymorphic error handling', () => {
    function handleError(error: CompressionError): string {
      if (error instanceof ValidationError) {
        return 'Validation issue';
      } else if (error instanceof EngineError) {
        return 'Engine issue';
      } else if (error instanceof YAMLGenerationError) {
        return 'YAML issue';
      }
      return 'Unknown compression issue';
    }

    expect(handleError(new ValidationError('test'))).toBe('Validation issue');
    expect(handleError(new EngineError('test'))).toBe('Engine issue');
    expect(handleError(new YAMLGenerationError('test'))).toBe('YAML issue');
  });

  it('should support type guards', () => {
    function isValidationError(error: unknown): error is ValidationError {
      return error instanceof ValidationError;
    }

    const validationErr = new ValidationError('test');
    const engineErr = new EngineError('test');

    expect(isValidationError(validationErr)).toBe(true);
    expect(isValidationError(engineErr)).toBe(false);
    expect(isValidationError('not an error')).toBe(false);
  });
});