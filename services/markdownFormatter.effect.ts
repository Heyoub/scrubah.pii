/**
 * MARKDOWN FORMATTER - EFFECT-TS VERSION
 *
 * Final serialization with YAML frontmatter and markdown body.
 *
 * Architecture:
 * - Effect<FormattedDocument, never, never> (pure computation)
 * - HIPAA compliance metadata tracking
 * - Token-optimized output (OCR artifact removal)
 * - Immutable transformations
 *
 * OCaml equivalent:
 * module MarkdownFormatter : sig
 *   val format_to_markdown : processed_file -> scrub_result -> processing_time -> string
 *   val clean_final_output : string -> string
 * end
 */

import { Effect, pipe } from "effect";
import { ProcessedFile, ScrubResult } from "../schemas/schemas";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Frontmatter metadata (YAML format)
 *
 * HIPAA COMPLIANCE: All metadata fields are audit-logged
 */
export interface FrontmatterMetadata {
  readonly source_file: string;
  readonly file_size_bytes?: number;
  readonly file_type?: string;
  readonly processed_date: string;
  readonly pii_scrubbed_count: number;
  readonly pii_confidence_score: number;
  readonly processing_engine: string;
  readonly processing_seconds: string;
  readonly hipaa_compliant: boolean;
  readonly [key: string]: string | number | boolean | undefined;
}

/**
 * Formatted document output
 */
export interface FormattedDocument {
  readonly markdown: string;
  readonly metadata: FrontmatterMetadata;
}

// ============================================================================
// MARKDOWN FORMATTING (Effect-based)
// ============================================================================

/**
 * Format processed file to markdown with YAML frontmatter
 *
 * Pure computation with Effect wrapper
 *
 * OCaml equivalent:
 * let format_to_markdown file scrub_result processing_time =
 *   let metadata = construct_frontmatter file scrub_result processing_time in
 *   let yaml_block = serialize_yaml metadata in
 *   let clean_body = clean_final_output scrub_result.text in
 *   assemble_markdown yaml_block clean_body scrub_result.count
 */
export const formatToMarkdown = (
  fileEntry: ProcessedFile,
  scrubResult: ScrubResult,
  processingTimeMs: number
): Effect.Effect<FormattedDocument, never, never> =>
  pipe(
    Effect.sync(() => {
      // 1. Construct metadata (HIPAA audit trail)
      const metadata: FrontmatterMetadata = {
        source_file: fileEntry.originalName,
        file_size_bytes: fileEntry.size,
        file_type: fileEntry.type,
        processed_date: new Date().toISOString(),
        pii_scrubbed_count: scrubResult.count,
        pii_confidence_score: scrubResult.confidence ?? 100,
        processing_engine: "Scrubah.PII-Local-v2-HIPAA",
        processing_seconds: (processingTimeMs / 1000).toFixed(2),
        hipaa_compliant: true
      };

      return metadata;
    }),
    Effect.map((metadata) => {
      // 2. Serialize frontmatter (YAML style)
      const yamlBlock = Object.entries(metadata)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join('\n');

      // 3. Optimize body (remove OCR artifacts)
      const cleanBody = cleanFinalOutput(scrubResult.text);

      // 4. Assemble final markdown
      const markdown = [
        '---',
        yamlBlock,
        '---',
        '',
        '# Document Extraction',
        '',
        cleanBody,
        '',
        '---',
        `*CONFIDENTIALITY NOTICE: This document has been automatically scrubbed of PII. Original entities replaced: ${scrubResult.count}.*`
      ].join('\n');

      return {
        markdown,
        metadata
      };
    })
  );

// ============================================================================
// TEXT CLEANING (Pure computation)
// ============================================================================

/**
 * Aggressive-but-Safe text optimization for LLM ingestion
 *
 * Pure function - no side effects
 *
 * Optimizations:
 * - Removes OCR "stutter" (identical duplicate lines)
 * - Collapses excessive whitespace (max 2 newlines)
 * - Preserves table structures and bullet points
 * - Token-efficient output
 *
 * OCaml equivalent:
 * let clean_final_output text =
 *   text
 *   |> split_lines
 *   |> remove_ocr_stutter
 *   |> collapse_whitespace
 *   |> String.trim
 */
export const cleanFinalOutput = (text: string): string => {
  const lines = text.split('\n');
  const cleanedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimRight();
    const prevLine = cleanedLines[cleanedLines.length - 1];

    // OCR Stutter Removal
    // If current line is identical to previous line and is short (< 50 chars),
    // it's likely a scan artifact.
    // Length check prevents removing intentional repeated paragraphs (legalese).
    if (prevLine && line === prevLine && line.length < 50 && line.length > 0) {
      continue;
    }

    cleanedLines.push(line);
  }

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // Max 2 newlines (standard markdown paragraph gap)
    .trim();
};

/**
 * Extract metadata from formatted document
 *
 * Pure computation
 */
export const extractMetadata = (
  formattedDoc: FormattedDocument
): FrontmatterMetadata => {
  return formattedDoc.metadata;
};

/**
 * Get document statistics
 *
 * Pure computation
 */
export const getDocumentStats = (
  formattedDoc: FormattedDocument
): {
  readonly characterCount: number;
  readonly lineCount: number;
  readonly wordCount: number;
  readonly piiCount: number;
} => {
  const lines = formattedDoc.markdown.split('\n');
  const words = formattedDoc.markdown.split(/\s+/).filter(w => w.length > 0);

  return {
    characterCount: formattedDoc.markdown.length,
    lineCount: lines.length,
    wordCount: words.length,
    piiCount: formattedDoc.metadata.pii_scrubbed_count,
  };
};

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

/**
 * Legacy sync wrapper for existing non-Effect code
 *
 * This will be removed once all services are migrated to Effect
 */
export const formatToMarkdownSync = (
  fileEntry: ProcessedFile,
  scrubResult: ScrubResult,
  processingTimeMs: number
): string => {
  const result = Effect.runSync(formatToMarkdown(fileEntry, scrubResult, processingTimeMs));
  return result.markdown;
};
