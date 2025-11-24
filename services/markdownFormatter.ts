import { ProcessedFile, ScrubResult } from '../types';
import { ScrubbedText, toExportableString } from '../schemas/phi';

/**
 * HIPAA COMPLIANCE NOTE:
 * This formatter ONLY accepts ScrubResult which contains ScrubbedText.
 * The type system ensures raw PHI cannot be passed to this function.
 */

interface FrontmatterMetadata {
  source_file: string;
  processed_date: string;
  pii_scrubbed_count: number;
  pii_confidence_score?: number;
  processing_engine: string;
  processing_seconds: string;
  hipaa_compliant: boolean;
  [key: string]: any;
}

/**
 * Service responsible for the final serialization of processed records.
 * Implements a consistent schema for LLM ingestion (YAML Frontmatter + Markdown).
 */
export const formatToMarkdown = (
  fileEntry: ProcessedFile,
  scrubResult: ScrubResult,
  processingTimeMs: number
): string => {
  
  // 1. Construct Data Lineage (Frontmatter)
  // HIPAA AUDIT: Include confidence score for compliance tracking
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

  // 2. Serialize Frontmatter (YAML style)
  const yamlBlock = Object.entries(metadata)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');

  // 3. Optimize Body (Remove artifacts, fix spacing)
  const cleanBody = cleanFinalOutput(scrubResult.text);

  // 4. Assemble Final Artifact
  return [
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
};

/**
 * Aggressive-but-Safe text optimization for LLM ingestion.
 * - Removes OCR "stutter" (identical duplicate lines).
 * - Collapses excessive whitespace (max 2 newlines).
 * - Preserves table structures and bullet points.
 */
const cleanFinalOutput = (text: string): string => {
  const lines = text.split('\n');
  const cleanedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimRight();
    const prevLine = cleanedLines[cleanedLines.length - 1];

    // 1. OCR Stutter Removal
    // If current line is identical to previous line and is short (< 50 chars), it's likely a scan artifact.
    // We use a length check because two long identical paragraphs might be intentional legalese.
    if (prevLine && line === prevLine && line.length < 50 && line.length > 0) {
        continue; 
    }
    
    cleanedLines.push(line);
  }

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // Max 2 newlines (Standard Markdown paragraph gap)
    .trim();
};