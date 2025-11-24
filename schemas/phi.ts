/**
 * PHI (Protected Health Information) TYPE SYSTEM
 *
 * HIPAA Compliance via TypeScript Branded Types (Simplified)
 *
 * Uses simple string branding that won't cause TypeScript stack overflow
 * with complex libraries like Effect-TS.
 */

// ============================================================================
// SIMPLIFIED BRANDED TYPES
// ============================================================================

/**
 * Brand tags - these are compile-time only markers
 */
type Brand<K, T> = K & { __brand: T };

/**
 * RawPHI - DANGEROUS: Contains unredacted patient information
 */
export type RawPHI = Brand<string, 'RawPHI'>;

/**
 * ScrubbedText - SAFE: All PII has been removed
 */
export type ScrubbedText = Brand<string, 'ScrubbedText'>;

/**
 * PIIPlaceholder - A redaction marker like [PER_1], [PHONE_2]
 */
export type PIIPlaceholder = Brand<string, 'PIIPlaceholder'>;

// ============================================================================
// TYPE CONSTRUCTORS
// ============================================================================

/**
 * Mark raw text as containing PHI (DANGEROUS)
 */
export function markAsRawPHI(text: string): RawPHI {
  return text as RawPHI;
}

/**
 * Mark text as scrubbed (SAFE) - ONLY CALL FROM SCRUBBER
 *
 * @internal - Do not call directly, use piiScrubber.scrub()
 */
export function markAsScrubbed(text: string): ScrubbedText {
  return text as ScrubbedText;
}

/**
 * Create a PII placeholder
 */
export function createPlaceholder(type: string, index: number): PIIPlaceholder {
  return `[${type}_${index}]` as PIIPlaceholder;
}

// ============================================================================
// RUNTIME CHECKS
// ============================================================================

/**
 * Check if text appears to be scrubbed (has placeholders)
 */
export function looksLikeScrubbed(text: string): boolean {
  return /\[[A-Z_]+_\d+\]/.test(text);
}

/**
 * Check if text appears to contain PII (runtime heuristic)
 */
export function mightContainPII(text: string): boolean {
  const patterns = [
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,           // Phone numbers
    /\b\d{3}-\d{2}-\d{4}\b/,                    // SSN
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
    /\b\d{5}(-\d{4})?\b/,                       // ZIP codes
  ];
  return patterns.some(pattern => pattern.test(text));
}

// ============================================================================
// SAFE CONVERSION UTILITIES
// ============================================================================

/**
 * Convert ScrubbedText to plain string for export
 */
export function toExportableString(text: ScrubbedText): string {
  return text as string;
}

/**
 * Get the raw string from RawPHI (DANGEROUS - use only for scrubbing)
 * @internal
 */
export function unsafeUnwrapPHI(phi: RawPHI): string {
  return phi as string;
}

// ============================================================================
// EXTRACTION UTILITIES
// ============================================================================

/**
 * Extract all placeholders from scrubbed text
 */
export function extractPlaceholders(text: ScrubbedText): PIIPlaceholder[] {
  const matches = text.match(/\[[A-Z_]+_\d+\]/g) || [];
  return matches as PIIPlaceholder[];
}

/**
 * Count placeholders by type
 */
export function countPlaceholdersByType(text: ScrubbedText): Record<string, number> {
  const placeholders = extractPlaceholders(text);
  const counts: Record<string, number> = {};

  for (const placeholder of placeholders) {
    const match = placeholder.match(/^\[([A-Z_]+)_\d+\]$/);
    if (match) {
      const type = match[1];
      counts[type] = (counts[type] || 0) + 1;
    }
  }

  return counts;
}
