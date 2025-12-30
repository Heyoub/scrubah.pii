/**
 * TEMPLATE DETECTION SERVICE - EFFECT-TS
 *
 * Detects and strips repeated boilerplate across medical document corpus.
 * Uses n-gram fingerprinting for efficient template detection.
 *
 * Flow:
 * 1. buildCorpus() - Analyze documents, detect templates
 * 2. stripTemplates() - Remove templates from individual docs
 * 3. reconstructDocument() - Restore original if needed
 *
 * Performance:
 * - O(n*m) where n=docs, m=avg lines per doc
 * - Hash-based matching for fast lookups
 * - Streaming-friendly for large corpora
 */

import { Effect, Context, Layer, pipe } from "effect";
import {
  NGramConfig,
  defaultNGramConfig,
  DetectedTemplate,
  DocumentDelta,
  TemplateCorpus,
  TemplateDetectionResult,
  normalizeForFingerprint,
  extractNGrams,
  classifyTemplateType,
} from "../schemas/templateDetection";

// ============================================================================
// SERVICE ERROR TYPE
// ============================================================================

export class TemplateDetectionError extends Error {
  readonly _tag = "TemplateDetectionError";
  constructor(
    readonly message: string,
    readonly documentId?: string
  ) {
    super(message);
  }
}

// ============================================================================
// DOCUMENT INPUT TYPE
// ============================================================================

export interface DocumentInput {
  id: string;
  content: string;
  metadata?: {
    filename?: string;
    type?: string;
    pageCount?: number;
  };
}

// ============================================================================
// SERVICE INTERFACE
// ============================================================================

export interface TemplateDetectionService {
  /**
   * Build template corpus from document collection
   * Analyzes all documents and identifies repeated templates
   */
  readonly buildCorpus: (
    documents: DocumentInput[],
    config?: Partial<NGramConfig>
  ) => Effect.Effect<TemplateCorpus, TemplateDetectionError, never>;

  /**
   * Strip templates from a single document using existing corpus
   */
  readonly stripTemplates: (
    document: DocumentInput,
    corpus: TemplateCorpus
  ) => Effect.Effect<TemplateDetectionResult, TemplateDetectionError, never>;

  /**
   * Batch strip templates from multiple documents
   */
  readonly stripTemplatesBatch: (
    documents: DocumentInput[],
    corpus: TemplateCorpus
  ) => Effect.Effect<TemplateDetectionResult[], TemplateDetectionError, never>;

  /**
   * Reconstruct original document from delta + templates
   */
  readonly reconstructDocument: (
    delta: DocumentDelta,
    corpus: TemplateCorpus
  ) => Effect.Effect<string, TemplateDetectionError, never>;

  /**
   * One-shot: build corpus and strip all documents
   */
  readonly processCorpus: (
    documents: DocumentInput[],
    config?: Partial<NGramConfig>
  ) => Effect.Effect<
    {
      corpus: TemplateCorpus;
      results: TemplateDetectionResult[];
      stats: {
        totalOriginalSize: number;
        totalCompressedSize: number;
        overallCompressionRatio: number;
        templatesDetected: number;
      };
    },
    TemplateDetectionError,
    never
  >;
}

export const TemplateDetectionService =
  Context.GenericTag<TemplateDetectionService>("TemplateDetectionService");

// ============================================================================
// INTERNAL: FINGERPRINT FREQUENCY MAP
// ============================================================================

interface FingerprintStats {
  hash: string;
  content: string; // original (non-normalized) content
  normalizedContent: string;
  ngramSize: number;
  documentIds: Set<string>;
  firstLinePositions: Map<string, number>; // docId -> lineStart
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class TemplateDetectionServiceImpl implements TemplateDetectionService {
  /**
   * Build template corpus from documents
   */
  readonly buildCorpus = (
    documents: DocumentInput[],
    configOverrides?: Partial<NGramConfig>
  ) => {
    return Effect.sync(() => {
      const startTime = performance.now();
      const config = { ...defaultNGramConfig, ...configOverrides };

      // Sample documents if corpus is too large
      const docsToAnalyze =
        documents.length > config.maxDocumentsToSample
          ? documents.slice(0, config.maxDocumentsToSample)
          : documents;

      // Check minimum document count
      if (docsToAnalyze.length < config.minDocumentsForTemplate) {
        return {
          templates: [],
          totalDocuments: documents.length,
          totalTemplatesDetected: 0,
          averageCompressionRatio: 1.0,
          configUsed: config,
          processingTimeMs: Math.round(performance.now() - startTime),
          createdAt: new Date().toISOString(),
        } satisfies TemplateCorpus;
      }

      // Build fingerprint frequency map
      const fingerprintMap = new Map<string, FingerprintStats>();

      for (const doc of docsToAnalyze) {
        const lines = doc.content.split("\n");
        const fingerprints = extractNGrams(lines, doc.id, config);

        for (const fp of fingerprints) {
          const existing = fingerprintMap.get(fp.hash);

          if (existing) {
            existing.documentIds.add(doc.id);
            if (!existing.firstLinePositions.has(doc.id)) {
              existing.firstLinePositions.set(doc.id, fp.lineStart);
            }
          } else {
            // Get original content for this n-gram
            const originalLines = lines.slice(
              fp.lineStart,
              fp.lineStart + fp.ngramSize
            );
            const originalContent = originalLines.join("\n");
            const normalizedContent = originalLines
              .map((line) => normalizeForFingerprint(line, config))
              .join("\n");

            fingerprintMap.set(fp.hash, {
              hash: fp.hash,
              content: originalContent,
              normalizedContent,
              ngramSize: fp.ngramSize,
              documentIds: new Set([doc.id]),
              firstLinePositions: new Map([[doc.id, fp.lineStart]]),
            });
          }
        }
      }

      // Filter to templates (appear in >threshold% of docs)
      const templateThreshold = Math.max(
        config.minDocumentsForTemplate,
        Math.floor(docsToAnalyze.length * config.templateThreshold)
      );

      const detectedTemplates: DetectedTemplate[] = [];

      for (const [hash, stats] of fingerprintMap) {
        if (stats.documentIds.size >= templateThreshold) {
          // Determine position (START, END, MIDDLE)
          const positions = Array.from(stats.firstLinePositions.values());
          const avgPosition =
            positions.reduce((a, b) => a + b, 0) / positions.length;

          // Get average document length for position calculation
          const avgDocLines =
            docsToAnalyze.reduce(
              (sum, d) => sum + d.content.split("\n").length,
              0
            ) / docsToAnalyze.length;

          let position: "START" | "END" | "MIDDLE";
          if (avgPosition < avgDocLines * 0.2) {
            position = "START";
          } else if (avgPosition > avgDocLines * 0.8) {
            position = "END";
          } else {
            position = "MIDDLE";
          }

          // Classify template type
          const type = classifyTemplateType(stats.content, position);

          detectedTemplates.push({
            id: `tpl_${hash.substring(0, 8)}`,
            hash,
            content: stats.content,
            lineCount: stats.ngramSize,
            charCount: stats.content.length,
            type,
            position,
            documentCount: stats.documentIds.size,
            frequency: stats.documentIds.size / docsToAnalyze.length,
            firstSeenDocId: Array.from(stats.documentIds)[0],
          });
        }
      }

      // Sort by frequency (most common first)
      detectedTemplates.sort((a, b) => b.frequency - a.frequency);

      // Remove overlapping templates (keep larger ones)
      const filteredTemplates = this.removeOverlappingTemplates(
        detectedTemplates,
        config
      );

      const processingTimeMs = Math.round(performance.now() - startTime);

      return {
        templates: filteredTemplates,
        totalDocuments: documents.length,
        totalTemplatesDetected: filteredTemplates.length,
        averageCompressionRatio: 1.0, // Will be computed after stripping
        configUsed: config,
        processingTimeMs,
        createdAt: new Date().toISOString(),
      } satisfies TemplateCorpus;
    });
  };

  /**
   * Remove overlapping templates (prefer larger n-grams)
   */
  private removeOverlappingTemplates(
    templates: DetectedTemplate[],
    config: NGramConfig
  ): DetectedTemplate[] {
    // Sort by line count descending (larger templates first)
    const sorted = [...templates].sort((a, b) => b.lineCount - a.lineCount);
    const kept: DetectedTemplate[] = [];
    const usedContent = new Set<string>();

    for (const template of sorted) {
      // Normalize for comparison
      const normalized = normalizeForFingerprint(template.content, config);

      // Check if this content is already covered by a larger template
      let isSubset = false;
      for (const existing of usedContent) {
        if (existing.includes(normalized)) {
          isSubset = true;
          break;
        }
      }

      if (!isSubset) {
        kept.push(template);
        usedContent.add(normalized);
      }
    }

    return kept;
  }

  /**
   * Strip templates from a single document
   */
  readonly stripTemplates = (document: DocumentInput, corpus: TemplateCorpus) => {
    return Effect.sync(() => {
      const lines = document.content.split("\n");
      const config = corpus.configUsed;

      // Track which lines are covered by templates
      const lineCoverage = new Array(lines.length).fill(false);
      // Use mutable array for building, will be readonly when assigned to result
      const matchedTemplates: Array<{
        templateId: string;
        lineStart: number;
        lineEnd: number;
        confidence: number;
      }> = [];

      // Create lookup map for template hashes
      const templateByHash = new Map(corpus.templates.map((t) => [t.hash, t]));

      // Find all template matches in this document
      const documentFingerprints = extractNGrams(lines, document.id, config);

      for (const fp of documentFingerprints) {
        const template = templateByHash.get(fp.hash);
        if (template) {
          // Mark lines as covered
          for (
            let i = fp.lineStart;
            i < fp.lineStart + template.lineCount;
            i++
          ) {
            lineCoverage[i] = true;
          }

          matchedTemplates.push({
            templateId: template.id,
            lineStart: fp.lineStart,
            lineEnd: fp.lineStart + template.lineCount - 1,
            confidence: 1.0, // exact match
          });
        }
      }

      // Deduplicate overlapping matches (keep first occurrence)
      const deduplicatedMatches = this.deduplicateMatches(matchedTemplates);

      // Extract unique lines (not covered by templates)
      const uniqueLines: Array<{ lineNumber: number; content: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (!lineCoverage[i]) {
          uniqueLines.push({ lineNumber: i, content: lines[i] });
        }
      }

      const uniqueContent = uniqueLines.map((l) => l.content).join("\n");
      const originalSize = document.content.length;
      const compressedSize = uniqueContent.length;

      const delta: DocumentDelta = {
        documentId: document.id,
        originalCharCount: originalSize,
        deltaCharCount: compressedSize,
        compressionRatio: originalSize > 0 ? compressedSize / originalSize : 1,
        templateRefs: deduplicatedMatches.map((m) => ({
          templateId: m.templateId,
          lineStart: m.lineStart,
          lineEnd: m.lineEnd,
        })),
        uniqueContent,
        uniqueLines,
      };

      const coveredLines = lineCoverage.filter(Boolean).length;
      const templateCoverage = lines.length > 0 ? coveredLines / lines.length : 0;

      return {
        documentId: document.id,
        matchedTemplates: deduplicatedMatches,
        delta,
        originalSize,
        compressedSize,
        templateCoverage,
      } satisfies TemplateDetectionResult;
    });
  };

  /**
   * Deduplicate overlapping template matches
   */
  private deduplicateMatches(
    matches: readonly { templateId: string; lineStart: number; lineEnd: number; confidence: number }[]
  ): Array<{ templateId: string; lineStart: number; lineEnd: number; confidence: number }> {
    if (matches.length === 0) return [];

    // Sort by line start (spread to create mutable copy)
    const sorted = [...matches].sort((a, b) => a.lineStart - b.lineStart);
    const result: Array<{ templateId: string; lineStart: number; lineEnd: number; confidence: number }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const current = sorted[i];
      const last = result[result.length - 1];

      // Skip if overlapping with previous
      if (current.lineStart <= last.lineEnd) {
        // Keep the larger match
        if (current.lineEnd > last.lineEnd) {
          result[result.length - 1] = current;
        }
      } else {
        result.push(current);
      }
    }

    return result;
  }

  /**
   * Batch strip templates from multiple documents
   */
  readonly stripTemplatesBatch = (
    documents: DocumentInput[],
    corpus: TemplateCorpus
  ) => {
    return Effect.sync(() => {
      return documents.map((doc) => {
        // Run synchronously since stripTemplates is already sync
        return Effect.runSync(this.stripTemplates(doc, corpus));
      });
    });
  };

  /**
   * Reconstruct original document from delta + templates
   */
  readonly reconstructDocument = (
    delta: DocumentDelta,
    corpus: TemplateCorpus
  ) => {
    return Effect.sync(() => {
      // Create template lookup
      const templateById = new Map(corpus.templates.map((t) => [t.id, t]));

      // Build reconstruction plan
      const insertions: Array<{ lineNumber: number; content: string }> = [];

      // Add template content at their original positions
      for (const ref of delta.templateRefs) {
        const template = templateById.get(ref.templateId);
        if (template) {
          const templateLines = template.content.split("\n");
          for (let i = 0; i < templateLines.length; i++) {
            insertions.push({
              lineNumber: ref.lineStart + i,
              content: templateLines[i],
            });
          }
        }
      }

      // Add unique lines
      for (const line of delta.uniqueLines) {
        insertions.push({
          lineNumber: line.lineNumber,
          content: line.content,
        });
      }

      // Sort by line number and reconstruct
      insertions.sort((a, b) => a.lineNumber - b.lineNumber);

      return insertions.map((i) => i.content).join("\n");
    });
  };

  /**
   * One-shot: build corpus and strip all documents
   */
  readonly processCorpus = (
    documents: DocumentInput[],
    configOverrides?: Partial<NGramConfig>
  ) => {
    return Effect.gen(this, function* (_) {
      // Build corpus
      const corpus = yield* _(this.buildCorpus(documents, configOverrides));

      // Strip templates from all documents
      const results = yield* _(this.stripTemplatesBatch(documents, corpus));

      // Compute stats
      const totalOriginalSize = results.reduce(
        (sum, r) => sum + r.originalSize,
        0
      );
      const totalCompressedSize = results.reduce(
        (sum, r) => sum + r.compressedSize,
        0
      );
      const overallCompressionRatio =
        totalOriginalSize > 0 ? totalCompressedSize / totalOriginalSize : 1;

      // Update corpus with actual compression ratio
      const updatedCorpus: TemplateCorpus = {
        ...corpus,
        averageCompressionRatio: overallCompressionRatio,
      };

      return {
        corpus: updatedCorpus,
        results,
        stats: {
          totalOriginalSize,
          totalCompressedSize,
          overallCompressionRatio,
          templatesDetected: corpus.templates.length,
        },
      };
    });
  };
}

// ============================================================================
// SERVICE LAYER
// ============================================================================

export const TemplateDetectionServiceLive = Layer.succeed(
  TemplateDetectionService,
  new TemplateDetectionServiceImpl()
);

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Process a corpus of documents (convenience wrapper)
 */
export const processDocumentCorpus = (
  documents: DocumentInput[],
  config?: Partial<NGramConfig>
): Effect.Effect<
  {
    corpus: TemplateCorpus;
    results: TemplateDetectionResult[];
    stats: {
      totalOriginalSize: number;
      totalCompressedSize: number;
      overallCompressionRatio: number;
      templatesDetected: number;
    };
  },
  TemplateDetectionError,
  TemplateDetectionService
> => {
  return Effect.gen(function* (_) {
    const service = yield* _(TemplateDetectionService);
    return yield* _(service.processCorpus(documents, config));
  });
};

/**
 * Run corpus processing (standalone)
 */
export const runProcessCorpus = async (
  documents: DocumentInput[],
  config?: Partial<NGramConfig>
) => {
  const program = pipe(
    processDocumentCorpus(documents, config),
    Effect.provide(TemplateDetectionServiceLive)
  );

  return Effect.runPromise(program);
};

/**
 * Quick template detection stats
 */
export const getTemplateStats = (corpus: TemplateCorpus) => {
  const byType = new Map<string, number>();
  const byPosition = new Map<string, number>();

  for (const template of corpus.templates) {
    byType.set(template.type, (byType.get(template.type) || 0) + 1);
    byPosition.set(
      template.position,
      (byPosition.get(template.position) || 0) + 1
    );
  }

  return {
    totalTemplates: corpus.templates.length,
    byType: Object.fromEntries(byType),
    byPosition: Object.fromEntries(byPosition),
    topTemplates: corpus.templates.slice(0, 5).map((t) => ({
      type: t.type,
      frequency: t.frequency,
      preview: t.content.substring(0, 50) + "...",
    })),
  };
};
