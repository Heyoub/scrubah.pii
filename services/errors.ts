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
  readonly message: string;
  readonly modelName?: string;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return true; // Can fall back to regex-only scrubbing
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      modelName: this.modelName,
      context: this.context,
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
  readonly message: string;
  readonly pattern: string;
  readonly confidence: number;
  readonly context?: Record<string, unknown>;
}> {
  get recoverable(): boolean {
    return true; // Warning, not error - can proceed
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      pattern: this.pattern,
      confidence: this.confidence,
      context: this.context,
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
 * Union of all service errors (for type safety)
 */
export type ServiceError =
  | ValidationError
  | MLModelError
  | PIIDetectionWarning
  | FingerprintError
  | LabExtractionError
  | TimelineError;

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
