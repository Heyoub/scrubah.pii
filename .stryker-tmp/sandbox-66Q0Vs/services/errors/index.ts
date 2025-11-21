/**
 * SHARED ERROR SYSTEM - ALGEBRAIC EFFECTS
 *
 * OCaml-style error handling with discriminated unions.
 * Errors are values, not exceptions.
 *
 * Philosophy:
 * - Effect<Success, Error, Dependencies>
 * - Railway-oriented programming (Either monad)
 * - Exhaustive pattern matching on error types
 * - LLM-friendly error messages with recovery suggestions
 */
// @ts-nocheck


import { Data, Schema as S, pipe } from "effect";

/**
 * BASE ERROR (Polymorphic variant)
 *
 * OCaml equivalent:
 * type 'a error = {
 *   tag: string;
 *   message: string;
 *   recoverable: bool;
 *   suggestion: string;
 * }
 */
export interface BaseError {
  readonly _tag: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly suggestion: string;
  toJSON(): Record<string, unknown>;
}

/**
 * PARSING ERRORS (Document parsing failures)
 */
export class PDFParseError extends Data.TaggedError("PDFParseError")<{
  readonly file: string;
  readonly page?: number;
  readonly reason:string;
  readonly suggestion: string;
}> {
  readonly timestamp: string = new Date().toISOString();

  get message(): string {
    const pageInfo = this.page ? ` (page ${this.page})` : "";
    return `Failed to parse PDF ${this.file}${pageInfo}: ${this.reason}`;
  }
  get recoverable(): boolean {
    return false; // Can't recover from corrupt PDF
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      file: this.file,
      page: this.page,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: this.timestamp,
    };
  }
}

export class OCRError extends Data.TaggedError("OCRError")<{
  readonly file: string;
  readonly confidence: number;
  readonly suggestion: string;
}> {
  get message(): string {
    return `OCR confidence too low for ${this.file} (${(this.confidence * 100).toFixed(1)}%)`;
  }
  get recoverable(): boolean {
    return true; // Can try with manual review
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      file: this.file,
      confidence: this.confidence,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * PII SCRUBBING ERRORS
 */
export class MLModelError extends Data.TaggedError("MLModelError")<{
  readonly modelName: string;
  readonly reason: string;
  readonly fallbackUsed: boolean;
  readonly suggestion: string;
}> {
  get message(): string {
    return `ML model ${this.modelName} failed: ${this.reason}`;
  }
  get recoverable(): boolean {
    return this.fallbackUsed; // Recoverable if regex fallback worked
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      modelName: this.modelName,
      reason: this.reason,
      fallbackUsed: this.fallbackUsed,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

export class PIIDetectionWarning extends Data.TaggedError("PIIDetectionWarning")<{
  readonly entity: string;
  readonly confidence: number;
  readonly context: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Low confidence PII detection: "${this.entity}" (${(this.confidence * 100).toFixed(1)}%)`;
  }
  get recoverable(): boolean {
    return true; // Warnings are always recoverable
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      entity: this.entity,
      confidence: this.confidence,
      context: this.context,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * TIMELINE ORGANIZATION ERRORS
 */
export class TimelineConflictError extends Data.TaggedError("TimelineConflictError")<{
  readonly event1Id: string;
  readonly event2Id: string;
  readonly reason: string;
  readonly resolution: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Timeline conflict between ${this.event1Id} and ${this.event2Id}: ${this.reason}`;
  }
  get recoverable(): boolean {
    return true; // Conflicts can be resolved
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      event1Id: this.event1Id,
      event2Id: this.event2Id,
      reason: this.reason,
      resolution: this.resolution,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

export class MissingDateError extends Data.TaggedError("MissingDateError")<{
  readonly documentId: string;
  readonly eventType: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Missing date for ${this.eventType} in ${this.documentId}`;
  }
  get recoverable(): boolean {
    return true; // Can estimate or skip
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      documentId: this.documentId,
      eventType: this.eventType,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * VALIDATION ERRORS
 */
export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
  readonly schema: string;
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Schema validation failed for ${this.schema}.${this.field}: expected ${this.expected}, got ${this.actual}`;
  }
  get recoverable(): boolean {
    return false; // Schema violations are fatal
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      schema: this.schema,
      field: this.field,
      expected: this.expected,
      actual: this.actual,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * SYSTEM ERRORS (Infrastructure failures)
 */
export class FileSystemError extends Data.TaggedError("FileSystemError")<{
  readonly operation: "read" | "write" | "delete";
  readonly path: string;
  readonly reason: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `File ${this.operation} failed for ${this.path}: ${this.reason}`;
  }
  get recoverable(): boolean {
    return this.operation === "read"; // Reads can retry, writes are fatal
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
 * ERROR UNION TYPE (Sum Type - like OCaml variants)
 *
 * OCaml equivalent:
 * type app_error =
 *   | PDFParseError of pdf_parse_error
 *   | OCRError of ocr_error
 *   | MLModelError of ml_model_error
 *   | ...
 *
 * Use for exhaustive pattern matching in error handlers.
 */
export type AppError =
  | PDFParseError
  | OCRError
  | MLModelError
  | PIIDetectionWarning
  | TimelineConflictError
  | MissingDateError
  | SchemaValidationError
  | FileSystemError;

/**
 * ERROR COLLECTOR (Accumulate warnings without failing)
 *
 * OCaml equivalent:
 * type 'a with_warnings = 'a * warning list
 */
export class ErrorCollector {
  private errors: AppError[] = [];

  add(error: AppError): void {
    this.errors.push(error);
  }

  getAll(): AppError[] {
    return [...this.errors];
  }

  getRecoverable(): AppError[] {
    return this.errors.filter((e) => e.recoverable);
  }

  getUnrecoverable(): AppError[] {
    return this.errors.filter((e) => !e.recoverable);
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasUnrecoverable(): boolean {
    return this.getUnrecoverable().length > 0;
  }

  count(): number {
    return this.errors.length;
  }

  clear(): void {
    this.errors = [];
  }

  toJSON(): Record<string, unknown>[] {
    return this.errors.map((e) => e.toJSON());
  }
}

/**
 * ERROR SCHEMA (For serialization to YAML/JSON)
 */
export const ErrorRecordSchema = S.Struct({
  _tag: S.String,
  message: S.String,
  recoverable: S.Boolean,
  suggestion: S.String,
  timestamp: S.String,
  details: pipe(S.Record({ key: S.String, value: S.Unknown }), S.optional),
});
export type ErrorRecord = S.Schema.Type<typeof ErrorRecordSchema>;

/**
 * HELPER: Convert AppError to serializable record
 */
export const toErrorRecord = (error: AppError): ErrorRecord => {
  const json = error.toJSON();
  return {
    _tag: json._tag as string,
    message: json.message as string,
    recoverable: json.recoverable as boolean,
    suggestion: json.suggestion as string,
    timestamp: json.timestamp as string,
    details: Object.fromEntries(
      Object.entries(json).filter(
        ([key]) =>
          !["_tag", "message", "recoverable", "suggestion", "timestamp"].includes(
            key
          )
      )
    ),
  };
};
