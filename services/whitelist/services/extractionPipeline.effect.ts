/**
 * MEDICAL EXTRACTION PIPELINE - INTEGRATION LAYER
 * 
 * This replaces the scrubbing pipeline with extraction pipeline.
 * 
 * OLD FLOW (blacklist):
 *   Raw PDF → Parse → Scrub PII → Format → Output
 * 
 * NEW FLOW (whitelist):
 *   Raw PDF → Parse → Extract Clinical Data → Validate → Format → Output
 * 
 * The key difference: we never see the PII because we only
 * extract structured clinical data fields.
 */

import { Effect, pipe, Array as A } from "effect";
import { extractMedicalData, type ExtractionInput } from "./medicalExtractor.effect";
import { formatMedicalTimeline } from "./timelineFormatter.effect";
import type { ExtractedMedicalRecord } from "../../../schemas/index";
import { ExtractionErrorCollector, type MedicalExtractionError } from "./extractionErrors";

// ============================================================================
// SIMPLE HASH FUNCTION (Browser-compatible)
// ============================================================================

const simpleHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
};

// ============================================================================
// BATCH EXTRACTION
// ============================================================================

export interface DocumentInput {
  id: string;
  filename: string;
  rawText: string;
}

export interface BatchExtractionResult {
  records: ExtractedMedicalRecord[];
  errors: MedicalExtractionError[];
  warnings: string[];
  stats: {
    totalDocuments: number;
    successfulExtractions: number;
    failedExtractions: number;
    totalLabResults: number;
    totalDiagnoses: number;
    totalMedications: number;
  };
}

/**
 * Extract medical data from multiple documents
 */
export const extractBatch = (
  documents: DocumentInput[]
): Effect.Effect<BatchExtractionResult, never, never> => {
  return Effect.gen(function* (_) {
    const records: ExtractedMedicalRecord[] = [];
    const errorCollector = new ExtractionErrorCollector();
    
    let successCount = 0;
    let failCount = 0;
    let totalLabs = 0;
    let totalDx = 0;
    let totalMeds = 0;
    
    for (const doc of documents) {
      const input: ExtractionInput = {
        text: doc.rawText,
        filename: doc.filename,
        documentHash: simpleHash(doc.rawText),
      };
      
      const result = yield* _(
        pipe(
          extractMedicalData(input),
          Effect.map(record => {
            successCount++;
            totalLabs += record.labPanels.reduce((sum, p) => sum + p.results.length, 0);
            totalDx += record.diagnoses.length;
            totalMeds += record.medications.length;
            return record;
          }),
          Effect.catchAll(error => {
            failCount++;
            errorCollector.add(error);
            return Effect.succeed(null);
          })
        )
      );
      
      if (result) {
        records.push(result);
      }
    }
    
    return {
      records,
      errors: errorCollector.getErrors(),
      warnings: errorCollector.getWarnings(),
      stats: {
        totalDocuments: documents.length,
        successfulExtractions: successCount,
        failedExtractions: failCount,
        totalLabResults: totalLabs,
        totalDiagnoses: totalDx,
        totalMedications: totalMeds,
      },
    };
  });
};

// ============================================================================
// FULL PIPELINE: Documents → Timeline Markdown
// ============================================================================

export interface PipelineInput {
  documents: DocumentInput[];
  timelineTitle?: string;
}

export interface PipelineResult {
  markdown: string;
  extraction: BatchExtractionResult;
}

/**
 * Complete pipeline: raw documents → formatted timeline
 */
export const runExtractionPipeline = (
  input: PipelineInput
): Effect.Effect<PipelineResult, never, never> => {
  return Effect.gen(function* (_) {
    // Step 1: Extract from all documents
    const extraction = yield* _(extractBatch(input.documents));
    
    // Step 2: Format into timeline
    const markdown = yield* _(formatMedicalTimeline({
      records: extraction.records,
      title: input.timelineTitle,
    }));
    
    // Step 3: Add extraction stats to output
    const statsBlock = [
      "",
      "---",
      "",
      "## 📈 Extraction Statistics",
      "",
      `- Documents processed: ${extraction.stats.totalDocuments}`,
      `- Successful extractions: ${extraction.stats.successfulExtractions}`,
      `- Failed extractions: ${extraction.stats.failedExtractions}`,
      `- Lab results extracted: ${extraction.stats.totalLabResults}`,
      `- Diagnoses extracted: ${extraction.stats.totalDiagnoses}`,
      `- Medications extracted: ${extraction.stats.totalMedications}`,
    ];
    
    if (extraction.warnings.length > 0) {
      statsBlock.push(
        "",
        "### ⚠️ Warnings",
        "",
        ...extraction.warnings.map(w => `- ${w}`),
      );
    }
    
    if (extraction.errors.length > 0) {
      statsBlock.push(
        "",
        "### ❌ Errors",
        "",
        ...extraction.errors.map(e => `- [${e._tag}] ${e.message}`),
      );
    }
    
    return {
      markdown: markdown + statsBlock.join("\n"),
      extraction,
    };
  });
};

// ============================================================================
// SYNC WRAPPERS
// ============================================================================

export const extractBatchSync = (documents: DocumentInput[]): BatchExtractionResult => {
  return Effect.runSync(extractBatch(documents));
};

export const runExtractionPipelineSync = (input: PipelineInput): PipelineResult => {
  return Effect.runSync(runExtractionPipeline(input));
};

// ============================================================================
// DROP-IN REPLACEMENT FOR EXISTING TIMELINE BUILDER
// ============================================================================

/**
 * Drop-in replacement for buildMasterTimeline in timelineOrganizer.ts
 * 
 * Takes the same ProcessedFile[] input format and returns compatible output.
 * This allows gradual migration without breaking existing code.
 */
export interface LegacyProcessedFile {
  id: string;
  originalName: string;
  scrubbedText?: string;
  rawText?: string;
}

export interface LegacyTimelineResult {
  markdown: string;
  summary: {
    totalDocuments: number;
    uniqueDocuments: number;
    duplicates: number;
  };
}

export const buildMasterTimelineV2 = (
  files: LegacyProcessedFile[]
): Effect.Effect<LegacyTimelineResult, never, never> => {
  return Effect.gen(function* (_) {
    // Convert to our input format
    const documents: DocumentInput[] = files
      .filter(f => f.scrubbedText || f.rawText)
      .map(f => ({
        id: f.id,
        filename: f.originalName,
        rawText: f.scrubbedText || f.rawText || "",
      }));
    
    // Run pipeline
    const result = yield* _(runExtractionPipeline({
      documents,
      timelineTitle: "Medical Record Timeline",
    }));
    
    // Return in legacy format
    return {
      markdown: result.markdown,
      summary: {
        totalDocuments: result.extraction.stats.totalDocuments,
        uniqueDocuments: result.extraction.stats.successfulExtractions,
        duplicates: result.extraction.stats.failedExtractions,
      },
    };
  });
};

export const buildMasterTimelineV2Sync = (files: LegacyProcessedFile[]): LegacyTimelineResult => {
  return Effect.runSync(buildMasterTimelineV2(files));
};
