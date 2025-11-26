/**
 * STRUCTURED TEST LOGGER
 *
 * Provides consistent logging across test environments.
 * Only logs in verbose mode to keep test output clean.
 *
 * Benefits:
 * - Same structure as production logs (easier to trace issues)
 * - Controlled by environment variable (no noise in CI)
 * - JSON format (machine-parseable if needed)
 * - Never logs PII (only metadata)
 */

interface LogMetadata {
  [key: string]: string | number | boolean | undefined;
}

const isVerbose = process.env.VITEST_VERBOSE === 'true' || process.env.DEBUG === 'true';

/**
 * Test logger - matches production logging structure
 */
export const testLogger = {
  /**
   * Log test metadata (no PII)
   */
  info(event: string, metadata: LogMetadata = {}) {
    if (isVerbose) {
      console.log(JSON.stringify({
        level: 'info',
        event,
        timestamp: new Date().toISOString(),
        ...metadata
      }));
    }
  },

  /**
   * Log performance metrics
   */
  perf(event: string, metrics: { duration?: number; size?: number; count?: number }) {
    if (isVerbose) {
      console.log(JSON.stringify({
        level: 'perf',
        event,
        timestamp: new Date().toISOString(),
        ...metrics
      }));
    }
  },

  /**
   * Log test warnings (always shown)
   */
  warn(event: string, metadata: LogMetadata = {}) {
    console.warn(JSON.stringify({
      level: 'warn',
      event,
      timestamp: new Date().toISOString(),
      ...metadata
    }));
  },

  /**
   * Log test errors (always shown)
   */
  error(event: string, error: Error, metadata: LogMetadata = {}) {
    console.error(JSON.stringify({
      level: 'error',
      event,
      timestamp: new Date().toISOString(),
      errorMessage: error.message,
      errorStack: error.stack,
      ...metadata
    }));
  }
};

/**
 * Usage in tests:
 *
 * ```typescript
 * // Only logs if VITEST_VERBOSE=true
 * testLogger.info('test:email-scrubbing', {
 *   placeholderCount: 3,
 *   entityType: 'EMAIL'
 * });
 *
 * // Always logs (for important warnings)
 * testLogger.warn('test:assumption-violation', {
 *   expected: 5,
 *   actual: 3
 * });
 *
 * // Performance tracking
 * testLogger.perf('test:large-document', {
 *   duration: 2500, // ms
 *   size: 14000,    // characters
 *   count: 5        // entities
 * });
 * ```
 *
 * Run with verbose logging:
 * ```bash
 * VITEST_VERBOSE=true pnpm test
 * ```
 */
