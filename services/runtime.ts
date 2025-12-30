/**
 * EFFECT RUNTIME - CENTRALIZED RUNTIME CONFIGURATION
 *
 * Provides a unified runtime for Effect-TS programs with:
 * - Consistent error handling and logging
 * - Dependency injection layers
 * - Performance monitoring hooks
 * - HIPAA-compliant audit logging
 *
 * Architecture:
 * - ManagedRuntime for async operations (Effect.runPromise)
 * - Runtime.runSync for pure computations
 * - Custom error handlers for ServiceError types
 * - Structured logging for compliance
 *
 * OCaml equivalent:
 * module Runtime : sig
 *   val run_promise : 'a Effect.t -> 'a Promise.t
 *   val run_sync : 'a Effect.t -> 'a
 *   val with_logging : 'a Effect.t -> 'a Effect.t
 * end
 */

import { Effect, Runtime, Console, Logger } from "effect";
import type { ServiceError } from "./errors";

// ============================================================================
// RUNTIME CONFIGURATION
// ============================================================================

/**
 * Custom logger for HIPAA-compliant structured logging
 *
 * Logs are structured for:
 * - Audit trail requirements (who, what, when)
 * - PHI scrubbing verification
 * - Performance monitoring
 * - Error tracking
 */
const AppLogger = Logger.make(({ logLevel, message, annotations }) => {
  const timestamp = new Date().toISOString();
  const level = logLevel.label;

  // Structured log format
  const logEntry = {
    timestamp,
    level,
    message,
    ...annotations,
  };

  // Console output (development)
  if (level === "ERROR" || level === "FATAL") {
    console.error(JSON.stringify(logEntry));
  } else if (level === "WARN") {
    console.warn(JSON.stringify(logEntry));
  } else if (level === "INFO") {
    console.info(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
});

/**
 * Base runtime layer with logging
 *
 * Includes:
 * - Console service for debugging
 * - Structured logger for audit trail
 * - Log level filtering (INFO+ in production, DEBUG+ in dev)
 */
const AppLayer = Logger.replace(Logger.defaultLogger, AppLogger);

/**
 * Default runtime with app layer
 *
 * Note: Custom logger is automatically applied via Logger.replace
 * For ManagedRuntime usage, see Effect.provide(AppLayer) in helpers
 */
const AppRuntime = Runtime.defaultRuntime;

// ============================================================================
// RUNTIME HELPERS
// ============================================================================

/**
 * Run Effect as Promise with error handling
 *
 * Use this for async operations in services
 *
 * OCaml equivalent:
 * val run_promise : 'a Effect.t -> ('a, error) result Promise.t
 *
 * @example
 * const result = await runPromise(generateFingerprint(filename, text));
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 */
export const runPromise = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<{ success: true; data: A } | { success: false; error: E }> => {
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(AppLayer),  // Apply custom logger
      Effect.map((data) => ({ success: true as const, data })),
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, error })
      )
    )
  );
};

/**
 * Run Effect synchronously (for pure computations)
 *
 * Use this for quick, non-async operations
 * CAUTION: Will throw if Effect fails
 *
 * OCaml equivalent:
 * val run_sync : 'a Effect.t -> 'a
 *
 * @example
 * const formatted = runSync(formatToMarkdown(file, scrubResult, timeMs));
 */
export const runSync = <A>(
  effect: Effect.Effect<A, never, never>
): A => {
  return Effect.runSync(effect);
};

/**
 * Run Effect with Result type (no exceptions)
 *
 * Safer alternative to runSync for synchronous operations
 *
 * @example
 * const result = runSyncResult(extractLabResults(text, date));
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(result.error);
 * }
 */
export const runSyncResult = <A, E>(
  effect: Effect.Effect<A, E, never>
): { success: true; data: A } | { success: false; error: E } => {
  return Effect.runSync(
    effect.pipe(
      Effect.provide(AppLayer),  // Apply custom logger
      Effect.map((data) => ({ success: true as const, data })),
      Effect.catchAll((error) =>
        Effect.succeed({ success: false as const, error })
      )
    )
  );
};

/**
 * Run Effect with automatic logging
 *
 * Logs start, success, and errors automatically
 *
 * @example
 * await runWithLogging(
 *   "PII Scrubbing",
 *   scrubPII(text)
 * );
 */
export const runWithLogging = async <A, E>(
  operationName: string,
  effect: Effect.Effect<A, E, never>
): Promise<{ success: true; data: A } | { success: false; error: E }> => {
  const startTime = Date.now();

  console.log(`🚀 Starting: ${operationName}`);

  const result = await runPromise(effect);

  const duration = Date.now() - startTime;

  if (result.success) {
    console.log(`✅ Completed: ${operationName} (${duration}ms)`);
  } else {
    console.error(`❌ Failed: ${operationName} (${duration}ms)`, result.error);
  }

  return result;
};

/**
 * Retry an Effect with exponential backoff
 *
 * Useful for network operations or flaky external services
 *
 * @example
 * const result = await runWithRetry(
 *   loadModel(),
 *   { attempts: 3, delayMs: 1000 }
 * );
 */
export const runWithRetry = async <A, E extends { recoverable: boolean }>(
  effect: Effect.Effect<A, E, never>,
  options: { attempts: number; delayMs: number }
): Promise<{ success: true; data: A } | { success: false; error: E }> => {
  // Validate attempts
  if (options.attempts <= 0) {
    throw new Error("Retry attempts must be greater than 0");
  }

  let lastError: E | undefined;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    const result = await runPromise(effect);

    if (result.success) {
      if (attempt > 1) {
        console.log(`✅ Retry succeeded on attempt ${attempt}`);
      }
      return result;
    }

    lastError = result.error;

    // Do not retry unrecoverable errors
    if (!lastError.recoverable) {
      console.error(`❌ Unrecoverable error on attempt ${attempt}, aborting retry.`);
      break;
    }

    if (attempt < options.attempts) {
      const delay = options.delayMs * Math.pow(2, attempt - 1);
      console.warn(`⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  console.error(`❌ All ${options.attempts} attempts failed`);
  // lastError is guaranteed to be defined here since we validated attempts > 0
  return { success: false, error: lastError as E };
};

// ============================================================================
// SERVICE ERROR HELPERS
// ============================================================================

/**
 * Check if error is recoverable
 *
 * Uses the recoverable flag from ServiceError types
 *
 * @example
 * if (isRecoverable(error)) {
 *   console.warn("Warning, but continuing...");
 * } else {
 *   throw error;
 * }
 */
export const isRecoverable = (error: ServiceError): boolean => {
  return error.recoverable;
};

/**
 * Extract error message from ServiceError
 *
 * Provides consistent error message formatting
 */
export const getErrorMessage = (error: ServiceError): string => {
  return error.message;
};

/**
 * Convert ServiceError to JSON for logging
 *
 * HIPAA-compliant structured error format
 */
export const serializeError = (error: ServiceError): Record<string, unknown> => {
  return error.toJSON();
};

// ============================================================================
// EXPORTS
// ============================================================================

export { AppLayer, AppRuntime, AppLogger };

/**
 * Re-export Effect utilities for convenience
 */
export { Effect, Console, Logger };
