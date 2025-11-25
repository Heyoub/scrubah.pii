/**
 * SERVICE-LEVEL ERROR SYSTEM (Effect-TS)
 *
 * Errors are values, not exceptions. Composable, type-safe, structured.
 *
 * Philosophy:
 * - Errors are part of the type signature (Effect<A, E, R>)
 * - Failed computations return Effect, not throw
 * - Error messages optimized for debugging
 * - Recovery strategies built-in
 */

import { Data } from "effect";

/**
 * VALIDATION ERROR - Data doesn't meet schema constraints
 *
 * Used when runtime validation fails (Effect Schema decoding)
 */
export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return false; // Invalid data structure = hard fail
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * ML MODEL ERROR - Machine learning inference failed
 *
 * Used by piiScrubber.effect.ts when BERT NER model fails
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

/**
 * PII DETECTION WARNING - Possible PII detected but uncertain
 *
 * Used when confidence score is low but pattern matches
 */
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
 * FINGERPRINT ERROR - Content hashing or deduplication failed
 *
 * Used by contentHasher.effect.ts when fingerprint generation fails
 */
export class FingerprintError extends Data.TaggedError("FingerprintError")<{
  readonly message: string;
  readonly filename?: string;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return true; // Can skip fingerprinting and still process file
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      filename: this.filename,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * LAB EXTRACTION ERROR - Failed to parse lab results
 *
 * Used by labExtractor.effect.ts when regex patterns don't match
 */
export class LabExtractionError extends Data.TaggedError("LabExtractionError")<{
  readonly message: string;
  readonly filename?: string;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return true; // Can still show raw text even if structured extraction fails
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      filename: this.filename,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * TIMELINE ERROR - Failed to build chronological timeline
 *
 * Used by timelineOrganizer.effect.ts when date parsing or sorting fails
 */
export class TimelineError extends Data.TaggedError("TimelineError")<{
  readonly message: string;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return false; // Timeline is critical - can't proceed without it
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      context: this.context,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * MISSING DATE ERROR - Date not found in filename or content
 *
 * Used when document date cannot be determined
 */
export class MissingDateError extends Data.TaggedError("MissingDateError")<{
  readonly documentId: string;
  readonly eventType: string;
  readonly suggestion: string;
}> {
  get recoverable(): boolean {
    return true; // Can use current date as fallback
  }

  get message(): string {
    return `Missing date for document: ${this.documentId}`;
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
 * TIMELINE CONFLICT ERROR - Documents conflict in timeline
 *
 * Used when duplicate or same-event documents are detected
 */
export class TimelineConflictError extends Data.TaggedError("TimelineConflictError")<{
  readonly event1Id: string;
  readonly event2Id: string;
  readonly reason: string;
  readonly resolution: string;
  readonly suggestion: string;
}> {
  get recoverable(): boolean {
    return true; // Can still include both documents with note
  }

  get message(): string {
    return `Timeline conflict between ${this.event1Id} and ${this.event2Id}: ${this.reason}`;
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

/**
 * PDF PARSE ERROR - PDF parsing failed
 *
 * Used by fileParser.effect.ts when PDF extraction fails
 */
export class PDFParseError extends Data.TaggedError("PDFParseError")<{
  readonly file: string;
  readonly page?: number;
  readonly reason: string;
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

/**
 * OCR ERROR - Optical character recognition failed or low confidence
 *
 * Used by fileParser.effect.ts when OCR quality is poor
 */
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
 * SCHEMA VALIDATION ERROR - Runtime schema validation failed
 *
 * Used when Effect Schema decode fails
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
 * FILE SYSTEM ERROR - File I/O operation failed
 *
 * Used when file read/write/delete fails
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
 * APP ERROR - Generic application error (union type alias)
 *
 * For backward compatibility with existing code
 */
export type AppError = ServiceError;

/**
 * Union of all service errors (for type safety)
 */
export type ServiceError =
  | ValidationError
  | MLModelError
  | PIIDetectionWarning
  | FingerprintError
  | LabExtractionError
  | TimelineError
  | MissingDateError
  | TimelineConflictError
  | PDFParseError
  | OCRError
  | SchemaValidationError
  | FileSystemError;

/**
 * Error Collector (for accumulating multiple errors during processing)
 *
 * Used when we want to continue processing despite errors (graceful degradation)
 */
export class ErrorCollector {
  private errors: ServiceError[] = [];

  add(error: ServiceError): void {
    this.errors.push(error);
  }

  getAll(): ServiceError[] {
    return [...this.errors];
  }

  count(): number {
    return this.errors.length;
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasUnrecoverableErrors(): boolean {
    return this.errors.some((e) => !e.recoverable);
  }

  clear(): void {
    this.errors = [];
  }

  toJSON() {
    return this.errors.map(e => e.toJSON());
  }
}
