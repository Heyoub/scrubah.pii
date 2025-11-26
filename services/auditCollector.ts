/**
 * AUDIT COLLECTOR
 *
 * Tracks all PII detection actions for compliance and debugging.
 * Similar pattern to ErrorCollector in compression module.
 *
 * Types imported from schemas.ts (single source of truth)
 */

import {
  type AuditEntry,
  type AuditSummary,
  type AuditReport,
} from '../schemas/schemas';

// Re-export for backward compatibility
export type { AuditEntry, AuditSummary, AuditReport };

export class AuditCollector {
  private entries: AuditEntry[] = [];
  private startTime: number = 0;
  private documentFilename?: string;
  private originalSize: number = 0;

  /**
   * Start a new audit session
   */
  start(filename?: string, originalText?: string): void {
    this.entries = [];
    this.startTime = Date.now();
    this.documentFilename = filename;
    this.originalSize = originalText?.length || 0;
  }

  /**
   * Log a pattern match
   */
  log(
    patternType: string,
    patternName: string,
    matches: Array<{ original: string; placeholder: string }>,
    durationMs?: number
  ): void {
    this.entries.push({
      patternType,
      patternName,
      matchCount: matches.length,
      replacements: matches,
      timestamp: Date.now(),
      durationMs
    });
  }

  /**
   * Get all audit entries
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Generate summary statistics
   */
  getSummary(confidenceScore: number, scrubbedText: string): AuditSummary {
    const byCategory: Record<string, number> = {};
    let totalDetections = 0;
    let totalDuration = 0;
    let totalPiiCharacters = 0;

    for (const entry of this.entries) {
      byCategory[entry.patternType] = (byCategory[entry.patternType] || 0) + entry.matchCount;
      totalDetections += entry.matchCount;
      totalDuration += entry.durationMs || 0;

      // Calculate total characters of PII removed
      for (const replacement of entry.replacements) {
        totalPiiCharacters += replacement.original.length;
      }
    }

    const scrubbedSize = scrubbedText.length;
    const sizeChange = scrubbedSize - this.originalSize;

    // PII density: what percentage of original text was PII
    const piiDensity = this.originalSize > 0
      ? (totalPiiCharacters / this.originalSize) * 100
      : 0;

    // Average PII item length
    const avgPiiLength = totalDetections > 0
      ? totalPiiCharacters / totalDetections
      : 0;

    return {
      totalDetections,
      byCategory,
      totalDurationMs: totalDuration || (Date.now() - this.startTime),
      confidenceScore,
      startedAt: this.startTime,
      completedAt: Date.now(),
      piiDensityPercent: Math.round(piiDensity * 100) / 100,
      piiCharactersRemoved: totalPiiCharacters,
      sizeChangeBytes: sizeChange,
      averagePiiLength: Math.round(avgPiiLength * 10) / 10
    };
  }

  /**
   * Generate full audit report
   */
  getReport(confidenceScore: number, scrubbedText: string): AuditReport {
    return {
      summary: this.getSummary(confidenceScore, scrubbedText),
      entries: this.getEntries(),
      document: {
        filename: this.documentFilename,
        originalSizeBytes: this.originalSize,
        scrubbedSizeBytes: scrubbedText.length
      }
    };
  }

  /**
   * Export as JSON for logging/compliance
   */
  toJSON(confidenceScore: number, scrubbedText: string): string {
    return JSON.stringify(this.getReport(confidenceScore, scrubbedText), null, 2);
  }

  /**
   * Get a quick console-friendly summary
   */
  toConsoleLog(): string {
    const lines: string[] = ['📋 AUDIT LOG'];
    lines.push('─'.repeat(40));

    for (const entry of this.entries) {
      if (entry.matchCount > 0) {
        lines.push(`  ${entry.patternName}: ${entry.matchCount} matches`);
      }
    }

    lines.push('─'.repeat(40));
    const total = this.entries.reduce((sum, e) => sum + e.matchCount, 0);
    lines.push(`  TOTAL: ${total} PII items detected`);

    return lines.join('\n');
  }
}

// Singleton instance for global access
let globalAuditCollector: AuditCollector | null = null;

export const getAuditCollector = (): AuditCollector => {
  if (!globalAuditCollector) {
    globalAuditCollector = new AuditCollector();
  }
  return globalAuditCollector;
};

export const createAuditCollector = (): AuditCollector => {
  return new AuditCollector();
};
