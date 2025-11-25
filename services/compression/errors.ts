/**
 * EFFECT-BASED ERROR SYSTEM
 *
 * Errors are values, not exceptions. Composable, type-safe, LLM-friendly.
 *
 * Philosophy:
 * - Errors are part of the type signature
 * - Failed computations return Either/Effect, not throw
 * - Error messages optimized for LLMs (structured, contextual)
 * - Recovery suggestions built-in
 * - Stack traces optional (hidden unless debug mode)
 */

import { Data, Schema as S, pipe } from "effect";

/**
 * Base error interface (all errors extend this)
 */
export interface BaseError {
  readonly _tag: string;
  readonly message: string;
  readonly timestamp: Date;
  readonly recoverable: boolean;
  readonly suggestion: string;
  readonly context?: Record<string, unknown>;
  readonly technicalDetails?: string;
}

/**
 * Parse Error - Invalid data structure
 */
export class ParseError extends Data.TaggedError("ParseError")<{
  readonly file: string;
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly suggestion: string;
  readonly extra?: Record<string, unknown>;
}> {
  get message(): string {
    return `Failed to parse ${this.field} in ${this.file}`;
  }

  get recoverable(): boolean {
    return true; // Can skip this file and continue
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      file: this.file,
      field: this.field,
      expected: this.expected,
      actual: this.actual,
      suggestion: this.suggestion,
      extra: this.extra,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Validation Error - Data doesn't meet constraints
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string;
  readonly value: unknown;
  readonly constraint: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Validation failed for ${this.field}: ${this.constraint}`;
  }

  get recoverable(): boolean {
    return false; // Invalid data structure = hard fail
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      field: this.field,
      value: this.value,
      constraint: this.constraint,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Date Ambiguity Error - Unclear date format
 */
export class DateAmbiguityError extends Data.TaggedError("DateAmbiguityError")<{
  readonly file: string;
  readonly rawDate: string;
  readonly possibleInterpretations: string[];
  readonly chosenInterpretation: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Ambiguous date format in ${this.file}: "${this.rawDate}"`;
  }

  get recoverable(): boolean {
    return true; // Made an assumption, can proceed
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      file: this.file,
      rawDate: this.rawDate,
      possibleInterpretations: this.possibleInterpretations,
      chosenInterpretation: this.chosenInterpretation,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      impact: "medium" as const,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * OCR Warning - Handwritten notes not readable
 */
export class OCRWarning extends Data.TaggedError("OCRWarning")<{
  readonly file: string;
  readonly reason: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `OCR failed for ${this.file}`;
  }

  get recoverable(): boolean {
    return true; // Can skip this file
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      file: this.file,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      impact: "low" as const,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Deduplication Error - Can't determine if events are duplicates
 */
export class DeduplicationError extends Data.TaggedError("DeduplicationError")<{
  readonly event1: string;
  readonly event2: string;
  readonly similarity: number;
  readonly action: "merged" | "kept_both";
  readonly suggestion: string;
}> {
  get message(): string {
    return `Deduplication ambiguity: ${this.similarity * 100}% similar`;
  }

  get recoverable(): boolean {
    return true; // Made a decision, can proceed
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      event1: this.event1,
      event2: this.event2,
      similarity: this.similarity,
      action: this.action,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Compression Size Exceeded - Output too large
 */
export class CompressionSizeExceededError extends Data.TaggedError(
  "CompressionSizeExceededError"
)<{
  readonly targetSizeKb: number;
  readonly actualSizeKb: number;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Compressed output (${this.actualSizeKb}KB) exceeds target (${this.targetSizeKb}KB)`;
  }

  get recoverable(): boolean {
    return true; // Can increase target or compress more
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      targetSizeKb: this.targetSizeKb,
      actualSizeKb: this.actualSizeKb,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * File System Error - Can't read/write file
 */
export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly operation: "read" | "write" | "delete";
  readonly path: string;
  readonly reason: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `File ${this.operation} failed: ${this.path}`;
  }

  get recoverable(): boolean {
    return false; // Can't proceed without file access
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      operation: this.operation,
      path: this.path,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Union of all compression errors (for type safety)
 */
export type CompressionError =
  | ParseError
  | ValidationError
  | DateAmbiguityError
  | OCRWarning
  | DeduplicationError
  | CompressionSizeExceededError
  | FileSystemError;

/**
 * Error Schema (for serialization to YAML)
 */
export const ErrorRecordSchema = S.Struct({
  type: S.String,
  message: S.String,
  file: pipe(S.String, S.optional),
  suggestion: S.String,
  impact: pipe(S.Literal("low", "medium", "high"), S.optional),
  recoverable: S.Boolean,
  timestamp: S.String, // ISO string
  details: pipe(S.Record({ key: S.String, value: S.Unknown }), S.optional),
});
export type ErrorRecord = S.Schema.Type<typeof ErrorRecordSchema>;

/**
 * Convert Effect error to YAML-serializable record
 */
export const toErrorRecord = (error: CompressionError): ErrorRecord => {
  const baseRecord = {
    type: error._tag,
    message: error.message,
    recoverable: error.recoverable,
    timestamp: new Date().toISOString(),
  };

  switch (error._tag) {
    case "ParseError":
      return {
        ...baseRecord,
        file: error.file,
        suggestion: error.suggestion,
        details: {
          field: error.field,
          expected: error.expected,
          actual: error.actual,
          ...(error.extra ? { extra: error.extra } : {}),
        },
      };

    case "DateAmbiguityError":
      return {
        ...baseRecord,
        file: error.file,
        suggestion: error.suggestion,
        impact: "medium" as const,
        details: {
          rawDate: error.rawDate,
          possibleInterpretations: error.possibleInterpretations,
          chosenInterpretation: error.chosenInterpretation,
        },
      };

    case "OCRWarning":
      return {
        ...baseRecord,
        file: error.file,
        suggestion: error.suggestion,
        impact: "low" as const,
        details: {
          reason: error.reason,
        },
      };

    case "DeduplicationError":
      return {
        ...baseRecord,
        suggestion: error.suggestion,
        impact: "medium" as const,
        details: {
          event1: error.event1,
          event2: error.event2,
          similarity: error.similarity,
          action: error.action,
        },
      };

    case "CompressionSizeExceededError":
      return {
        ...baseRecord,
        suggestion: error.suggestion,
        impact: "high" as const,
        details: {
          targetSizeKb: error.targetSizeKb,
          actualSizeKb: error.actualSizeKb,
        },
      };

    case "ValidationError":
      return {
        ...baseRecord,
        suggestion: error.suggestion,
        impact: "high" as const,
        details: {
          field: error.field,
          value: error.value,
          constraint: error.constraint,
        },
      };

    case "FileSystemError":
      return {
        ...baseRecord,
        file: error.path,
        suggestion: error.suggestion,
        impact: "high" as const,
        details: {
          operation: error.operation,
          reason: error.reason,
        },
      };

    default:
      // Exhaustiveness check
      const _exhaustive: never = error;
      return _exhaustive;
  }
};

/**
 * Collect errors during compression (for YAML output)
 */
export class ErrorCollector {
  private errors: ErrorRecord[] = [];

  add(error: CompressionError): void {
    this.errors.push(toErrorRecord(error));
  }

  getAll(): ErrorRecord[] {
    return this.errors;
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasUnrecoverableErrors(): boolean {
    return this.errors.some((e) => !e.recoverable);
  }
}
