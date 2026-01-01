/**
 * SCRUBBER WORKER MANAGER
 *
 * Provides a clean API for using the Web Worker for PII scrubbing.
 * Falls back to main thread if Web Workers aren't available.
 */

import type { AuditReport } from './auditCollector';
import type { WorkerResponse } from './scrubber.worker';
import { appLogger } from './appLogger';

export interface WorkerScrubResult {
  text: string;
  replacements: Record<string, string>;
  count: number;
  auditReport: AuditReport;
}

export interface WorkerScrubOptions {
  filename?: string;
  onProgress?: (stage: string, percent: number) => void;
}

class ScrubberWorkerManager {
  private worker: Worker | null = null;
  private pendingJobs: Map<string, {
    resolve: (result: WorkerScrubResult) => void;
    reject: (error: Error) => void;
    onProgress?: (stage: string, percent: number) => void;
  }> = new Map();

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined') {
      appLogger.warn('worker_unavailable');
      return;
    }

    try {
      // Vite-specific worker import syntax
      this.worker = new Worker(
        new URL('./scrubber.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleMessage(event.data);
      };

      this.worker.onerror = (error) => {
        appLogger.error('worker_error', { errorMessage: error?.message });
        // Reject all pending jobs
        for (const [_jobId, job] of this.pendingJobs) {
          job.reject(new Error('Worker error: ' + error.message));
        }
        this.pendingJobs.clear();
      };

      appLogger.info('worker_initialized');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      appLogger.warn('worker_init_failed', { errorMessage });
      this.worker = null;
    }
  }

  private handleMessage(msg: WorkerResponse): void {
    const job = this.pendingJobs.get(msg.jobId);
    if (!job) return;

    switch (msg.type) {
      case 'progress':
        job.onProgress?.(msg.stage, msg.percent);
        break;

      case 'result':
        job.resolve({
          text: msg.text,
          replacements: msg.replacements,
          count: msg.count,
          auditReport: msg.auditReport
        });
        this.pendingJobs.delete(msg.jobId);
        break;

      case 'error':
        job.reject(new Error(msg.error));
        this.pendingJobs.delete(msg.jobId);
        break;
    }
  }

  /**
   * Scrub text using Web Worker (or fallback to main thread)
   */
  async scrub(text: string, options: WorkerScrubOptions = {}): Promise<WorkerScrubResult> {
    // If no worker, fall back to main thread (import piiScrubber dynamically)
    if (!this.worker) {
      appLogger.warn('worker_fallback_main_thread');
      const { runScrubPII, DEFAULT_SCRUB_CONFIG } = await import('./piiScrubber.effect');
      const result = await runScrubPII(text, DEFAULT_SCRUB_CONFIG);
      const originalSize = text.length;
      const scrubbedSize = result.text.length;
      const sizeChange = scrubbedSize - originalSize;

      // Calculate PII characters removed (estimate based on size change)
      const piiCharactersRemoved = Math.max(0, -sizeChange);

      // Calculate PII density
      const piiDensity = originalSize > 0 ? (piiCharactersRemoved / originalSize) * 100 : 0;

      // Calculate average PII length
      const avgPiiLength = result.count > 0 ? piiCharactersRemoved / result.count : 0;

      return {
        text: result.text,
        replacements: result.replacements,
        count: result.count,
        auditReport: {
          summary: {
            totalDetections: result.count,
            byCategory: {},
            totalDurationMs: 0,
            confidenceScore: result.confidence || 95,
            startedAt: Date.now(),
            completedAt: Date.now(),
            piiDensityPercent: Math.round(piiDensity * 100) / 100,
            piiCharactersRemoved,
            sizeChangeBytes: sizeChange,
            averagePiiLength: Math.round(avgPiiLength * 10) / 10
          },
          entries: [],
          document: {
            filename: options.filename,
            originalSizeBytes: originalSize,
            scrubbedSizeBytes: scrubbedSize
          }
        }
      };
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return new Promise((resolve, reject) => {
      this.pendingJobs.set(jobId, {
        resolve,
        reject,
        onProgress: options.onProgress
      });

      this.worker!.postMessage({
        type: 'scrub',
        text,
        filename: options.filename,
        jobId
      });
    });
  }

  /**
   * Process multiple documents sequentially using the worker
   */
  async scrubBatch(
    documents: Array<{ text: string; filename: string }>,
    onProgress?: (completed: number, total: number, currentFile: string) => void
  ): Promise<WorkerScrubResult[]> {
    const results: WorkerScrubResult[] = [];
    const total = documents.length;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      onProgress?.(i, total, doc.filename);

      const result = await this.scrub(doc.text, {
        filename: doc.filename,
        onProgress: (stage, percent) => {
          onProgress?.(i + (percent / 100), total, `${doc.filename}: ${stage}`);
        }
      });

      results.push(result);
    }

    onProgress?.(total, total, 'Complete');
    return results;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    if (this.worker) {
      // Reject any pending jobs
      for (const [_jobId, job] of this.pendingJobs) {
        job.reject(new Error('Worker terminated'));
      }
      this.pendingJobs.clear();

      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Check if worker is available
   */
  isWorkerAvailable(): boolean {
    return this.worker !== null;
  }
}

// Singleton instance
let instance: ScrubberWorkerManager | null = null;

export const getScrubberWorker = (): ScrubberWorkerManager => {
  if (!instance) {
    instance = new ScrubberWorkerManager();
  }
  return instance;
};

export const createScrubberWorker = (): ScrubberWorkerManager => {
  return new ScrubberWorkerManager();
};
