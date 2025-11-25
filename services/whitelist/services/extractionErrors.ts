/**
 * MEDICAL EXTRACTION ERRORS
 * 
 * All errors extend Data.TaggedError for type-safe handling.
 * Each error includes recovery suggestions.
 */

import { Data } from "effect";

// ============================================================================
// EXTRACTION ERRORS
// ============================================================================

/**
 * Failed to parse document structure
 */
export class DocumentParseError extends Data.TaggedError("DocumentParseError")<{
  readonly documentHash: string;
  readonly reason: string;
  readonly rawTextPreview: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Failed to parse document structure: ${this.reason}`;
  }
  
  get recoverable(): boolean {
    return false;
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      documentHash: this.documentHash,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Section extraction failed but document may still be partially usable
 */
export class SectionExtractionError extends Data.TaggedError("SectionExtractionError")<{
  readonly sectionName: string;
  readonly reason: string;
  readonly rawContent: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Failed to extract section "${this.sectionName}": ${this.reason}`;
  }
  
  get recoverable(): boolean {
    return true; // Other sections may still work
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      sectionName: this.sectionName,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Lab value parsing failed
 */
export class LabParseError extends Data.TaggedError("LabParseError")<{
  readonly rawLine: string;
  readonly reason: string;
  readonly partialResult: Partial<{
    testName: string;
    value: string;
    unit: string;
    referenceRange: string;
  }>;
}> {
  get message(): string {
    return `Lab parse error: ${this.reason}`;
  }
  
  get recoverable(): boolean {
    return true;
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      rawLine: this.rawLine.substring(0, 100),
      reason: this.reason,
      partialResult: this.partialResult,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * PII detected in extracted content - CRITICAL
 */
export class PIILeakageError extends Data.TaggedError("PIILeakageError")<{
  readonly field: string;
  readonly pattern: string;
  readonly suspiciousContent: string;
  readonly severity: "warning" | "critical";
}> {
  get message(): string {
    return `POTENTIAL PII LEAK in ${this.field}: ${this.pattern} pattern detected`;
  }
  
  get recoverable(): boolean {
    return this.severity === "warning";
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      field: this.field,
      pattern: this.pattern,
      severity: this.severity,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Document type couldn't be determined
 */
export class DocumentClassificationError extends Data.TaggedError("DocumentClassificationError")<{
  readonly documentHash: string;
  readonly contentPreview: string;
  readonly attemptedClassifications: string[];
}> {
  get message(): string {
    return `Could not classify document type. Tried: ${this.attemptedClassifications.join(", ")}`;
  }
  
  get recoverable(): boolean {
    return true; // Can proceed with "unknown" type
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      documentHash: this.documentHash,
      attemptedClassifications: this.attemptedClassifications,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Date parsing failed
 */
export class DateParseError extends Data.TaggedError("DateParseError")<{
  readonly rawDate: string;
  readonly expectedFormats: string[];
}> {
  get message(): string {
    return `Could not parse date "${this.rawDate}". Expected formats: ${this.expectedFormats.join(", ")}`;
  }
  
  get recoverable(): boolean {
    return true;
  }
  
  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      rawDate: this.rawDate,
      expectedFormats: this.expectedFormats,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================================================
// UNION TYPE FOR SERVICE ERRORS
// ============================================================================

export type MedicalExtractionError =
  | DocumentParseError
  | SectionExtractionError
  | LabParseError
  | PIILeakageError
  | DocumentClassificationError
  | DateParseError;

// ============================================================================
// ERROR COLLECTION (for accumulating non-fatal errors)
// ============================================================================

export class ExtractionErrorCollector {
  private errors: MedicalExtractionError[] = [];
  private warnings: string[] = [];
  
  add(error: MedicalExtractionError): void {
    this.errors.push(error);
    if (error.recoverable) {
      this.warnings.push(error.message);
    }
  }
  
  addWarning(message: string): void {
    this.warnings.push(message);
  }
  
  hasUnrecoverableErrors(): boolean {
    return this.errors.some(e => !e.recoverable);
  }
  
  hasPIILeaks(): boolean {
    return this.errors.some(
      e => e._tag === "PIILeakageError" && e.severity === "critical"
    );
  }
  
  getWarnings(): string[] {
    return [...this.warnings];
  }
  
  getErrors(): MedicalExtractionError[] {
    return [...this.errors];
  }
  
  toJSON() {
    return {
      totalErrors: this.errors.length,
      unrecoverable: this.errors.filter(e => !e.recoverable).length,
      warnings: this.warnings,
      errors: this.errors.map(e => e.toJSON()),
    };
  }
}
