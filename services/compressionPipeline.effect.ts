/**
 * COMPRESSION PIPELINE SERVICE - EFFECT-TS
 *
 * Unified pipeline orchestrating all compression stages:
 * 1. OCR Quality Gate
 * 2. Template Detection & Stripping
 * 3. Semantic Deduplication
 * 4. Structured Extraction
 * 5. Narrative Generation
 *
 * Design:
 * - Composable stages using Effect
 * - Progress tracking
 * - Error resilience
 * - Comprehensive metrics
 */

import { Effect, Context, Layer } from "effect";
import {
  PipelineConfig,
  defaultPipelineConfig,
  PipelineDocument,
  PipelineResult,
  DocumentResult,
  StageResult,
  PipelineStage,
  ProgressCallback,
  getEnabledStages,
  calculateOverallCompression,
} from "../schemas/compressionPipeline";

// Import stage services (when they exist)
// For now, we'll implement simplified versions inline

// ============================================================================
// SERVICE ERROR TYPE
// ============================================================================

export class PipelineError extends Error {
  readonly _tag = "PipelineError";
  constructor(
    readonly message: string,
    readonly stage?: PipelineStage,
    readonly documentId?: string
  ) {
    super(message);
  }
}

// ============================================================================
// SERVICE INTERFACE
// ============================================================================

export interface CompressionPipelineService {
  /**
   * Process documents through the full pipeline
   */
  readonly process: (
    documents: PipelineDocument[],
    config?: Partial<PipelineConfig>,
    onProgress?: ProgressCallback
  ) => Effect.Effect<PipelineResult, PipelineError, never>;

  /**
   * Process a single document
   */
  readonly processSingle: (
    document: PipelineDocument,
    config?: Partial<PipelineConfig>
  ) => Effect.Effect<DocumentResult, PipelineError, never>;

  /**
   * Run a specific stage only
   */
  readonly runStage: (
    stage: PipelineStage,
    documents: PipelineDocument[],
    config?: Partial<PipelineConfig>
  ) => Effect.Effect<StageResult, PipelineError, never>;

  /**
   * Estimate compression for a document set
   */
  readonly estimateCompression: (
    documents: PipelineDocument[],
    config?: Partial<PipelineConfig>
  ) => Effect.Effect<{ estimatedRatio: number; estimatedOutputChars: number }, never, never>;
}

export const CompressionPipelineService =
  Context.GenericTag<CompressionPipelineService>("CompressionPipelineService");

// ============================================================================
// SIMPLIFIED STAGE IMPLEMENTATIONS
// (These call the actual services when available)
// ============================================================================

/**
 * OCR Quality stage - simplified for now
 * Returns quality score based on character patterns
 */
const runOcrQualityStage = (
  docs: PipelineDocument[],
  minQuality: number
): { passed: PipelineDocument[]; filtered: PipelineDocument[]; scores: Map<string, number> } => {
  const scores = new Map<string, number>();
  const passed: PipelineDocument[] = [];
  const filtered: PipelineDocument[] = [];

  for (const doc of docs) {
    // Simplified quality heuristic
    const text = doc.content;
    const alphaRatio = (text.match(/[a-zA-Z]/g)?.length || 0) / Math.max(text.length, 1);
    const spaceRatio = (text.match(/\s/g)?.length || 0) / Math.max(text.length, 1);
    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
    const avgWordLen = wordCount > 0 ? text.replace(/\s/g, "").length / wordCount : 0;

    // Quality score based on multiple factors
    let score = 0;
    if (alphaRatio > 0.5) score += 0.3;
    if (spaceRatio > 0.1 && spaceRatio < 0.3) score += 0.2;
    if (avgWordLen > 3 && avgWordLen < 15) score += 0.3;
    if (wordCount > 10) score += 0.2;

    scores.set(doc.id, score);

    if (score >= minQuality) {
      passed.push(doc);
    } else {
      filtered.push(doc);
    }
  }

  return { passed, filtered, scores };
};

/**
 * Template Detection stage - simplified
 * Strips common repeating patterns
 */
const runTemplateDetectionStage = (
  docs: PipelineDocument[],
  _minFrequency: number
): { processed: Array<{ doc: PipelineDocument; charsRemoved: number }> } => {
  const processed: Array<{ doc: PipelineDocument; charsRemoved: number }> = [];

  // Find common lines across documents
  const lineCounts = new Map<string, number>();
  for (const doc of docs) {
    const lines = doc.content.split("\n").map((l) => l.trim());
    const seenInDoc = new Set<string>();
    for (const line of lines) {
      if (line.length >= 20 && !seenInDoc.has(line)) {
        lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
        seenInDoc.add(line);
      }
    }
  }

  // Lines appearing in 50%+ of docs are templates
  const threshold = Math.max(2, Math.floor(docs.length * 0.5));
  const templateLines = new Set<string>();
  for (const [line, count] of lineCounts) {
    if (count >= threshold) {
      templateLines.add(line);
    }
  }

  // Strip template lines from each doc
  for (const doc of docs) {
    const originalLen = doc.content.length;
    const lines = doc.content.split("\n");
    const filteredLines = lines.filter((l) => !templateLines.has(l.trim()));
    const newContent = filteredLines.join("\n");

    processed.push({
      doc: { ...doc, content: newContent },
      charsRemoved: originalLen - newContent.length,
    });
  }

  return { processed };
};

/**
 * Semantic Dedup stage - simplified
 * Uses Jaccard similarity on word sets
 */
const runSemanticDedupStage = (
  docs: PipelineDocument[],
  similarityThreshold: number
): { representatives: PipelineDocument[]; duplicates: Map<string, string> } => {
  const duplicates = new Map<string, string>(); // docId -> representativeId
  const representatives: PipelineDocument[] = [];

  // Simple word-set based similarity
  const wordSets = docs.map((doc) => ({
    doc,
    words: new Set(doc.content.toLowerCase().split(/\s+/).filter((w) => w.length > 3)),
  }));

  const used = new Set<string>();

  for (let i = 0; i < wordSets.length; i++) {
    if (used.has(wordSets[i].doc.id)) continue;

    representatives.push(wordSets[i].doc);
    used.add(wordSets[i].doc.id);

    // Find duplicates of this document
    for (let j = i + 1; j < wordSets.length; j++) {
      if (used.has(wordSets[j].doc.id)) continue;

      // Jaccard similarity
      const intersection = new Set([...wordSets[i].words].filter((w) => wordSets[j].words.has(w)));
      const union = new Set([...wordSets[i].words, ...wordSets[j].words]);
      const similarity = union.size > 0 ? intersection.size / union.size : 0;

      if (similarity >= similarityThreshold) {
        duplicates.set(wordSets[j].doc.id, wordSets[i].doc.id);
        used.add(wordSets[j].doc.id);
      }
    }
  }

  return { representatives, duplicates };
};

/**
 * Structured Extraction stage - simplified
 * Returns basic extraction counts
 */
const runStructuredExtractionStage = (
  docs: PipelineDocument[]
): {
  extractions: Array<{
    docId: string;
    diagnosisCount: number;
    medicationCount: number;
    labCount: number;
    abnormalLabCount: number;
  }>;
} => {
  const extractions = docs.map((doc) => {
    const text = doc.content;

    // Count diagnosis patterns
    const dxMatches = text.match(/\b(diagnos|assessment|impression|A\/P)/gi) || [];

    // Count medication patterns
    const medMatches = text.match(/\b(mg|mcg|tablet|capsule|PO|IV)\b/gi) || [];

    // Count lab patterns
    const labMatches = text.match(/\b(WBC|HGB|PLT|Na|K|Cr|BUN|glucose)\b/gi) || [];
    const abnormalMatches = text.match(/\b(H|L|HIGH|LOW|CRIT)\b/g) || [];

    return {
      docId: doc.id,
      diagnosisCount: Math.min(dxMatches.length, 10),
      medicationCount: Math.min(medMatches.length / 2, 20), // Rough estimate
      labCount: labMatches.length,
      abnormalLabCount: Math.min(abnormalMatches.length, labMatches.length),
    };
  });

  return { extractions };
};

/**
 * Narrative Generation stage - simplified
 * Creates basic summary
 */
const runNarrativeGenerationStage = (
  docs: PipelineDocument[],
  verbosity: "MINIMAL" | "BRIEF" | "STANDARD" | "DETAILED"
): { narratives: Array<{ docId: string; narrative: string }> } => {
  const maxLen =
    verbosity === "MINIMAL"
      ? 200
      : verbosity === "BRIEF"
        ? 500
        : verbosity === "STANDARD"
          ? 1000
          : 2000;

  const narratives = docs.map((doc) => {
    // Simple extraction of key lines
    const lines = doc.content.split("\n").filter((l) => l.trim().length > 0);
    const keyLines = lines
      .filter(
        (l) =>
          /\b(diagnos|assessment|impression|medication|lab|vital|finding)/i.test(l) ||
          /\b(WBC|HGB|BP|HR|mg|mcg)\b/i.test(l)
      )
      .slice(0, verbosity === "MINIMAL" ? 3 : verbosity === "BRIEF" ? 5 : 10);

    const narrative = keyLines.join("\n").slice(0, maxLen);

    return { docId: doc.id, narrative };
  });

  return { narratives };
};

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class CompressionPipelineServiceImpl implements CompressionPipelineService {
  /**
   * Process a single document
   */
  readonly processSingle = (
    document: PipelineDocument,
    configOverrides?: Partial<PipelineConfig>
  ) => {
    return Effect.gen(this, function* () {
      const startTime = Date.now();
      const config = { ...defaultPipelineConfig, ...configOverrides };
      const warnings: string[] = [];

      let currentContent = document.content;
      const originalCharCount = document.content.length;

      // Mutable builder for stage results
      let ocrQualityScore: number | undefined;
      let ocrPassed: boolean | undefined;
      let templateStripped: boolean | undefined;
      let templateCharsRemoved: number | undefined;
      let isDuplicate: boolean | undefined;
      let extractionCount: number | undefined;
      let narrative: string | undefined;
      let narrativeGenerated: boolean | undefined;
      let narrativeCharCount: number | undefined;

      // Stage 1: OCR Quality
      if (config.enableOcrQuality) {
        const { scores, passed } = runOcrQualityStage([document], config.ocrMinQuality);
        const score = scores.get(document.id) || 0;
        ocrQualityScore = score;
        ocrPassed = passed.length > 0;

        if (!ocrPassed) {
          currentContent = "";
          warnings.push(`OCR quality too low: ${(score * 100).toFixed(0)}%`);
        }

        if (score < config.ocrWarnThreshold && score >= config.ocrMinQuality) {
          warnings.push(`Low OCR quality: ${(score * 100).toFixed(0)}%`);
        }
      }

      // Stage 2: Template Detection
      if (config.enableTemplateDetection && ocrPassed !== false) {
        const { processed } = runTemplateDetectionStage(
          [{ ...document, content: currentContent }],
          config.templateMinFrequency
        );
        if (processed.length > 0) {
          currentContent = processed[0].doc.content;
          templateStripped = processed[0].charsRemoved > 0;
          templateCharsRemoved = processed[0].charsRemoved;
        }
      }

      // Stage 3: Semantic Dedup (single doc - always representative)
      if (config.enableSemanticDedup && ocrPassed !== false) {
        isDuplicate = false;
      }

      // Stage 4: Structured Extraction
      if (config.enableStructuredExtraction && ocrPassed !== false) {
        const { extractions } = runStructuredExtractionStage([
          { ...document, content: currentContent },
        ]);
        if (extractions.length > 0) {
          extractionCount =
            extractions[0].diagnosisCount +
            extractions[0].medicationCount +
            extractions[0].labCount;
        }
      }

      // Stage 5: Narrative Generation
      if (config.enableNarrativeGeneration && ocrPassed !== false) {
        const { narratives } = runNarrativeGenerationStage(
          [{ ...document, content: currentContent }],
          config.narrativeVerbosity
        );
        if (narratives.length > 0) {
          narrative = narratives[0].narrative;
          narrativeGenerated = narratives[0].narrative.length > 0;
          narrativeCharCount = narratives[0].narrative.length;
        }
      }

      // Build immutable result
      const result: DocumentResult = {
        documentId: document.id,
        originalCharCount,
        finalCharCount: currentContent.length,
        processedContent: currentContent,
        processingTimeMs: Date.now() - startTime,
        warnings,
        ...(ocrQualityScore !== undefined ? { ocrQualityScore } : {}),
        ...(ocrPassed !== undefined ? { ocrPassed } : {}),
        ...(templateStripped !== undefined ? { templateStripped } : {}),
        ...(templateCharsRemoved !== undefined ? { templateCharsRemoved } : {}),
        ...(isDuplicate !== undefined ? { isDuplicate } : {}),
        ...(extractionCount !== undefined ? { extractionCount } : {}),
        ...(narrative !== undefined ? { narrative } : {}),
        ...(narrativeGenerated !== undefined ? { narrativeGenerated } : {}),
        ...(narrativeCharCount !== undefined ? { narrativeCharCount } : {}),
      };

      return result;
    });
  };

  /**
   * Run a specific stage
   */
  readonly runStage = (
    stage: PipelineStage,
    documents: PipelineDocument[],
    configOverrides?: Partial<PipelineConfig>
  ) => {
    return Effect.sync(() => {
      const startTime = Date.now();
      const config = { ...defaultPipelineConfig, ...configOverrides };

      let outputCount = documents.length;
      let filteredCount = 0;

      switch (stage) {
        case "OCR_QUALITY": {
          const { passed, filtered } = runOcrQualityStage(documents, config.ocrMinQuality);
          outputCount = passed.length;
          filteredCount = filtered.length;
          break;
        }
        case "TEMPLATE_DETECTION": {
          const { processed } = runTemplateDetectionStage(documents, config.templateMinFrequency);
          outputCount = processed.length;
          break;
        }
        case "SEMANTIC_DEDUP": {
          const { representatives, duplicates } = runSemanticDedupStage(
            documents,
            config.dedupSimilarityThreshold
          );
          outputCount = representatives.length;
          filteredCount = duplicates.size;
          break;
        }
        case "STRUCTURED_EXTRACTION": {
          const { extractions } = runStructuredExtractionStage(documents);
          outputCount = extractions.length;
          break;
        }
        case "NARRATIVE_GENERATION": {
          const { narratives } = runNarrativeGenerationStage(documents, config.narrativeVerbosity);
          outputCount = narratives.length;
          break;
        }
      }

      return {
        stage,
        status: "COMPLETED" as const,
        inputCount: documents.length,
        outputCount,
        filteredCount,
        processingTimeMs: Date.now() - startTime,
      };
    });
  };

  /**
   * Process documents through full pipeline
   */
  readonly process = (
    documents: PipelineDocument[],
    configOverrides?: Partial<PipelineConfig>,
    onProgress?: ProgressCallback
  ) => {
    return Effect.gen(this, function* () {
      const startTime = Date.now();
      const config = { ...defaultPipelineConfig, ...configOverrides };
      const enabledStages = getEnabledStages(config);

      // Initialize results
      const stageResults: StageResult[] = [];
      const documentResults: DocumentResult[] = [];

      let currentDocs = documents;
      let totalInputChars = documents.reduce((sum, d) => sum + d.content.length, 0);
      let totalOutputChars = totalInputChars;
      let totalNarrativeChars = 0;
      let ocrFilteredCount = 0;
      let templateCharsRemoved = 0;
      let duplicatesRemoved = 0;
      let totalExtractions = 0;
      let diagnosisCount = 0;
      let medicationCount = 0;
      let labCount = 0;
      let abnormalLabCount = 0;

      // Track OCR scores and duplicate mappings
      const ocrScores = new Map<string, number>();
      const duplicateMap = new Map<string, string>();

      // Run each stage
      for (let stageIndex = 0; stageIndex < enabledStages.length; stageIndex++) {
        const stage = enabledStages[stageIndex];
        const stageStartTime = Date.now();

        // Report progress
        if (onProgress) {
          onProgress({
            stage,
            stageIndex,
            totalStages: enabledStages.length,
            documentIndex: 0,
            totalDocuments: currentDocs.length,
            percentComplete: (stageIndex / enabledStages.length) * 100,
            message: `Running ${stage}...`,
          });
        }

        try {
          switch (stage) {
            case "OCR_QUALITY": {
              const { passed, filtered, scores } = runOcrQualityStage(
                currentDocs,
                config.ocrMinQuality
              );
              scores.forEach((v, k) => ocrScores.set(k, v));
              ocrFilteredCount = filtered.length;
              currentDocs = passed;
              stageResults.push({
                stage,
                status: "COMPLETED",
                inputCount: passed.length + filtered.length,
                outputCount: passed.length,
                filteredCount: filtered.length,
                processingTimeMs: Date.now() - stageStartTime,
              });
              break;
            }

            case "TEMPLATE_DETECTION": {
              const { processed } = runTemplateDetectionStage(
                currentDocs,
                config.templateMinFrequency
              );
              templateCharsRemoved = processed.reduce((sum, p) => sum + p.charsRemoved, 0);
              currentDocs = processed.map((p) => p.doc);
              stageResults.push({
                stage,
                status: "COMPLETED",
                inputCount: processed.length,
                outputCount: processed.length,
                filteredCount: 0,
                processingTimeMs: Date.now() - stageStartTime,
              });
              break;
            }

            case "SEMANTIC_DEDUP": {
              const { representatives, duplicates } = runSemanticDedupStage(
                currentDocs,
                config.dedupSimilarityThreshold
              );
              duplicates.forEach((v, k) => duplicateMap.set(k, v));
              duplicatesRemoved = duplicates.size;
              currentDocs = representatives;
              stageResults.push({
                stage,
                status: "COMPLETED",
                inputCount: representatives.length + duplicates.size,
                outputCount: representatives.length,
                filteredCount: duplicates.size,
                processingTimeMs: Date.now() - stageStartTime,
              });
              break;
            }

            case "STRUCTURED_EXTRACTION": {
              const { extractions } = runStructuredExtractionStage(currentDocs);
              extractions.forEach((e) => {
                totalExtractions += e.diagnosisCount + e.medicationCount + e.labCount;
                diagnosisCount += e.diagnosisCount;
                medicationCount += e.medicationCount;
                labCount += e.labCount;
                abnormalLabCount += e.abnormalLabCount;
              });
              stageResults.push({
                stage,
                status: "COMPLETED",
                inputCount: currentDocs.length,
                outputCount: currentDocs.length,
                filteredCount: 0,
                processingTimeMs: Date.now() - stageStartTime,
              });
              break;
            }

            case "NARRATIVE_GENERATION": {
              const { narratives } = runNarrativeGenerationStage(
                currentDocs,
                config.narrativeVerbosity
              );
              totalNarrativeChars = narratives.reduce((sum, n) => sum + n.narrative.length, 0);
              stageResults.push({
                stage,
                status: "COMPLETED",
                inputCount: currentDocs.length,
                outputCount: narratives.length,
                filteredCount: 0,
                processingTimeMs: Date.now() - stageStartTime,
              });
              break;
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          stageResults.push({
            stage,
            status: "FAILED",
            inputCount: currentDocs.length,
            outputCount: 0,
            filteredCount: 0,
            processingTimeMs: Date.now() - stageStartTime,
            error: errorMsg,
          });

          if (!config.continueOnError) {
            return yield* Effect.fail(new PipelineError(`Stage ${stage} failed: ${errorMsg}`, stage));
          }
        }
      }

      // Calculate final output chars
      totalOutputChars = currentDocs.reduce((sum, d) => sum + d.content.length, 0);

      // Build document results
      for (const doc of documents) {
        const ocrScore = ocrScores.get(doc.id);
        const ocrPassed = ocrScore !== undefined ? ocrScore >= config.ocrMinQuality : true;
        const isDuplicate = duplicateMap.has(doc.id);
        const duplicateOf = duplicateMap.get(doc.id);

        const processedDoc = currentDocs.find((d) => d.id === doc.id);
        const finalContent = processedDoc?.content || (ocrPassed && !isDuplicate ? doc.content : "");

        documentResults.push({
          documentId: doc.id,
          originalCharCount: doc.content.length,
          finalCharCount: finalContent.length,
          ocrQualityScore: ocrScore,
          ocrPassed: ocrPassed,
          templateStripped: templateCharsRemoved > 0,
          isDuplicate,
          duplicateOf,
          processedContent: finalContent,
          processingTimeMs: Date.now() - startTime,
          warnings: [],
        });
      }

      // Final metrics
      const compressionRatio = calculateOverallCompression(
        totalInputChars,
        totalOutputChars,
        totalNarrativeChars
      );

      return {
        documents: documentResults,
        documentCount: documents.length,
        successCount: documentResults.filter((d) => d.finalCharCount > 0).length,
        failedCount: documentResults.filter((d) => d.finalCharCount === 0).length,
        stages: stageResults,
        totalInputChars,
        totalOutputChars,
        totalNarrativeChars,
        compressionRatio,
        ocrFilteredCount,
        templateCharsRemoved,
        duplicatesRemoved,
        totalExtractions,
        diagnosisCount,
        medicationCount,
        labCount,
        abnormalLabCount,
        totalProcessingTimeMs: Date.now() - startTime,
        avgTimePerDocument: (Date.now() - startTime) / documents.length,
        config,
      };
    });
  };

  /**
   * Estimate compression without full processing
   */
  readonly estimateCompression = (
    documents: PipelineDocument[],
    configOverrides?: Partial<PipelineConfig>
  ) => {
    return Effect.sync(() => {
      const config = { ...defaultPipelineConfig, ...configOverrides };
      const totalInputChars = documents.reduce((sum, d) => sum + d.content.length, 0);

      // Rough estimates based on typical compression rates
      let estimatedRatio = 0;

      if (config.enableOcrQuality) estimatedRatio += 0.05; // ~5% filtered
      if (config.enableTemplateDetection) estimatedRatio += 0.20; // ~20% templates
      if (config.enableSemanticDedup) estimatedRatio += 0.15; // ~15% duplicates
      if (config.enableNarrativeGeneration) estimatedRatio += 0.30; // ~30% summarization

      // Cap at 80%
      estimatedRatio = Math.min(estimatedRatio, 0.80);

      return {
        estimatedRatio,
        estimatedOutputChars: Math.round(totalInputChars * (1 - estimatedRatio)),
      };
    });
  };
}

// ============================================================================
// LAYER
// ============================================================================

export const CompressionPipelineServiceLive = Layer.succeed(
  CompressionPipelineService,
  new CompressionPipelineServiceImpl()
);
