/**
 * TIMELINE ORGANIZER - EFFECT-TS VERSION
 *
 * Temporal organization & master timeline generation.
 * Optimized for LLM pathological analysis.
 *
 * OCaml-style pure functional pipeline:
 * - Extract dates → Generate fingerprints → Detect duplicates → Sort → Format
 *
 * Architecture:
 * - Effect<MasterTimeline, AppError, ContentHasherService>
 * - Pure functions for date extraction, sorting, formatting
 * - Errors as values (MissingDateError, TimelineConflictError)
 * - Immutable timeline documents
 */

import { Effect, pipe } from "effect";
import { parse, format, isValid } from "date-fns";
import { ProcessedFile } from "../schemas";
import { AppError, MissingDateError, TimelineConflictError, ErrorCollector } from "./errors";
import {
  DocumentFingerprint,
  DuplicateAnalysis,
  DocumentType,
  analyzeDuplication,
  generateFingerprint,
} from "./contentHasher";
import {
  extractLabResults,
  formatLabTable,
  generateTrendAnalysis,
  LabPanel,
} from "./labExtractor";

/**
 * TIMELINE DOCUMENT (Immutable)
 *
 * OCaml equivalent:
 * type timeline_document = {
 *   id: string;
 *   filename: string;
 *   date: date;
 *   display_date: string;
 *   content: string;
 *   fingerprint: document_fingerprint;
 *   duplication_info: duplication_analysis option;
 *   lab_data: lab_panel option;
 *   document_number: int;
 * }
 */
export interface TimelineDocument {
  readonly id: string;
  readonly filename: string;
  readonly date: Date;
  readonly displayDate: string;
  readonly content: string;
  readonly fingerprint: DocumentFingerprint;
  readonly duplicationInfo?: DuplicateAnalysis;
  readonly labData?: LabPanel;
  readonly documentNumber: number;
}

/**
 * TIMELINE SUMMARY (Aggregated statistics)
 */
export interface TimelineSummary {
  readonly totalDocuments: number;
  readonly uniqueDocuments: number;
  readonly duplicates: number;
  readonly dateRange: {
    readonly earliest: string;
    readonly latest: string;
  };
  readonly documentTypes: Record<DocumentType, number>;
}

/**
 * MASTER TIMELINE (Final output)
 */
export interface MasterTimeline {
  readonly documents: readonly TimelineDocument[];
  readonly summary: TimelineSummary;
  readonly markdown: string;
}

/**
 * TIMELINE OPTIONS
 */
export interface TimelineOptions {
  readonly reverseChronological?: boolean;
}

/**
 * DATE FORMATS (for parsing)
 */
const DATE_FORMATS = [
  "MM-dd-yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
  "MMM dd yyyy",
  "MMMM dd yyyy",
] as const;

const FILENAME_PATTERNS = [
  /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/, // MM-DD-YYYY or MM/DD/YYYY
  /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/, // YYYY-MM-DD
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i,
] as const;

/**
 * EXTRACT PRIMARY DATE (Pure function)
 *
 * OCaml equivalent:
 * val extract_primary_date : string -> string -> (date, error) result
 */
export const extractPrimaryDate = (
  filename: string,
  content: string,
  errorCollector?: ErrorCollector
): Date => {
  // Try filename first (most reliable)
  for (const pattern of FILENAME_PATTERNS) {
    const match = filename.match(pattern);
    if (match) {
      const dateStr = match[0];

      // Try date-fns parsing (robust)
      for (const formatStr of DATE_FORMATS) {
        try {
          const parsedDate = parse(dateStr, formatStr, new Date());
          if (isValid(parsedDate)) {
            return parsedDate;
          }
        } catch (e) {
          continue;
        }
      }

      // Fallback to native Date parsing
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Try content (first 500 chars for performance)
  const contentStart = content.substring(0, 500);
  for (const pattern of FILENAME_PATTERNS) {
    const match = contentStart.match(pattern);
    if (match) {
      const dateStr = match[0];

      for (const formatStr of DATE_FORMATS) {
        try {
          const parsedDate = parse(dateStr, formatStr, new Date());
          if (isValid(parsedDate)) {
            return parsedDate;
          }
        } catch (e) {
          continue;
        }
      }

      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Fallback to current date (with warning)
  if (errorCollector) {
    errorCollector.add(
      new MissingDateError({
        documentId: filename,
        eventType: "unknown",
        suggestion:
          "Date not found in filename or content. Consider renaming file with date.",
      })
    );
  }

  console.warn(`No date found for: ${filename}, using current date`);
  return new Date();
};

/**
 * CREATE TIMELINE DOCUMENT (Smart constructor)
 *
 * Pure function - enforces invariants
 */
const createTimelineDocument = (
  file: ProcessedFile,
  fingerprint: DocumentFingerprint,
  labData: LabPanel | undefined,
  errorCollector: ErrorCollector
): TimelineDocument => {
  const date = extractPrimaryDate(
    file.originalName,
    file.scrubbedText || "",
    errorCollector
  );

  return {
    id: file.id,
    filename: file.originalName,
    date,
    displayDate: date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    content: file.scrubbedText || "",
    fingerprint,
    labData,
    documentNumber: 0, // Will be set after sorting
  };
};

/**
 * SORT TIMELINE DOCUMENTS (Pure function)
 */
const sortDocuments = (
  documents: readonly TimelineDocument[],
  reverseChronological: boolean
): readonly TimelineDocument[] => {
  const sorted = [...documents].sort((a, b) => {
    const diff = a.date.getTime() - b.date.getTime();
    return reverseChronological ? -diff : diff;
  });

  // Assign document numbers (immutable)
  return sorted.map((doc, idx) => ({
    ...doc,
    documentNumber: idx + 1,
  }));
};

/**
 * DETECT DUPLICATES (Pure function with side effects in errorCollector)
 */
const detectDuplicates = (
  documents: readonly TimelineDocument[],
  errorCollector: ErrorCollector
): readonly TimelineDocument[] => {
  const result: TimelineDocument[] = [];

  for (let i = 0; i < documents.length; i++) {
    const currentDoc = documents[i];
    let foundDuplicate = false;

    // Compare with all previous documents
    for (let j = 0; j < i; j++) {
      const previousDoc = documents[j];

      const duplicationInfo = analyzeDuplication(
        currentDoc.fingerprint,
        previousDoc.fingerprint,
        currentDoc.date,
        previousDoc.date
      );

      // If duplicate found, mark it
      if (
        duplicationInfo.isDuplicate ||
        duplicationInfo.differenceType === "same-event"
      ) {
        errorCollector.add(
          new TimelineConflictError({
            event1Id: currentDoc.id,
            event2Id: previousDoc.id,
            reason: `${duplicationInfo.differenceType} (${(duplicationInfo.similarity * 100).toFixed(1)}% similar)`,
            resolution: duplicationInfo.isDuplicate
              ? "Marked as duplicate, content omitted"
              : "Kept both documents, noted relationship",
            suggestion: duplicationInfo.isDuplicate
              ? "Review source files to determine which is canonical"
              : "Documents may reference same encounter with different details",
          })
        );

        result.push({
          ...currentDoc,
          duplicationInfo,
        });

        foundDuplicate = true;
        break;
      }
    }

    if (!foundDuplicate) {
      result.push(currentDoc);
    }
  }

  return result;
};

/**
 * GENERATE SUMMARY (Pure function)
 */
const generateSummary = (
  documents: readonly TimelineDocument[]
): TimelineSummary => {
  const duplicates = documents.filter((d) => d.duplicationInfo?.isDuplicate)
    .length;
  const uniqueDocuments = documents.length - duplicates;

  const documentTypes: Record<DocumentType, number> = {} as Record<
    DocumentType,
    number
  >;
  for (const doc of documents) {
    const type = doc.fingerprint.documentType;
    documentTypes[type] = (documentTypes[type] || 0) + 1;
  }

  const dates = documents.map((d) => d.date.getTime());
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));

  return {
    totalDocuments: documents.length,
    uniqueDocuments,
    duplicates,
    dateRange: {
      earliest: earliest.toLocaleDateString(),
      latest: latest.toLocaleDateString(),
    },
    documentTypes,
  };
};

/**
 * GENERATE TIMELINE MARKDOWN (Pure function)
 */
const generateTimelineMarkdown = (
  documents: readonly TimelineDocument[],
  summary: TimelineSummary,
  reverseChronological: boolean
): string => {
  const sections: string[] = [];
  const sortDirection = reverseChronological
    ? "newest → oldest"
    : "oldest → newest";

  // Header
  sections.push("# 🏥 Medical Record Timeline\n");
  sections.push("## 📊 Summary Statistics\n");
  sections.push(
    `- **Date Range**: ${summary.dateRange.earliest} → ${summary.dateRange.latest}`
  );
  sections.push(
    `- **Total Documents**: ${summary.totalDocuments} (${summary.uniqueDocuments} unique, ${summary.duplicates} duplicates)`
  );
  sections.push(`- **Document Types**:`);

  for (const [type, count] of Object.entries(summary.documentTypes)) {
    const emoji = getDocTypeEmoji(type as DocumentType);
    sections.push(
      `  - ${emoji} ${formatDocTypeName(type as DocumentType)}: ${count}`
    );
  }

  sections.push("\n---\n");

  // Timeline sections
  sections.push("## 📅 Chronological Timeline\n");
  sections.push(
    `_Documents are ordered chronologically (${sortDirection}) for temporal analysis._\n`
  );

  // Track previous lab results for trend analysis
  let previousLabPanel: LabPanel | undefined;

  for (const doc of documents) {
    // Handle duplicates differently
    if (doc.duplicationInfo?.isDuplicate) {
      sections.push(
        `### [DUPLICATE] ${doc.displayDate} | ${doc.filename}\n` +
          `⚠️ This document is a ${doc.duplicationInfo.differenceType} of document #${getOriginalDocNumber(documents, doc.duplicationInfo.duplicateOf!)} ` +
          `(${(doc.duplicationInfo.similarity * 100).toFixed(1)}% similar). Content omitted to reduce redundancy.\n`
      );
      continue;
    }

    // Same-event documents (keep but note relationship)
    const relationNote =
      doc.duplicationInfo?.differenceType === "same-event"
        ? `\n> 🔗 **Related**: This document appears to reference the same clinical encounter as document #${getOriginalDocNumber(documents, doc.duplicationInfo.duplicateOf!)} but contains different information.\n`
        : "";

    // Document header
    const emoji = getDocTypeEmoji(doc.fingerprint.documentType);
    sections.push(
      `### ${emoji} ${doc.displayDate} | ${doc.filename}\n` +
        `**Document #${doc.documentNumber}** | Type: ${formatDocTypeName(doc.fingerprint.documentType)} | ` +
        `Hash: \`${doc.fingerprint.contentHash.substring(0, 8)}\`` +
        relationNote +
        "\n"
    );

    // Lab results get special formatting
    if (doc.labData) {
      sections.push(formatLabTable(doc.labData));

      // Add trend analysis if we have previous labs
      if (previousLabPanel) {
        const trends = generateTrendAnalysis(doc.labData, previousLabPanel);
        if (trends) {
          sections.push(trends + "\n");
        }
      }

      previousLabPanel = doc.labData;

      // Add raw content in collapsible section
      sections.push(
        "<details>\n<summary>📄 View Full Lab Report</summary>\n\n"
      );
      sections.push("```\n" + doc.content + "\n```\n");
      sections.push("</details>\n");
    } else {
      // Non-lab documents: Truncate long content
      const lines = doc.content.split("\n");
      const MAX_LINES = 50;

      if (lines.length > MAX_LINES) {
        const truncatedContent = lines.slice(0, MAX_LINES).join("\n");
        const remainingLines = lines.length - MAX_LINES;
        sections.push(truncatedContent + "\n");
        sections.push(
          `\n> ⚠️ **Content truncated** - ${remainingLines} additional lines omitted for readability.\n`
        );
      } else {
        sections.push(doc.content + "\n");
      }
    }

    sections.push("\n---\n");
  }

  return sections.join("\n");
};

/**
 * HELPER FUNCTIONS (Pure)
 */
const getDocTypeEmoji = (type: DocumentType): string => {
  const emojiMap: Record<DocumentType, string> = {
    [DocumentType.LAB_REPORT]: "🧪",
    [DocumentType.IMAGING]: "🔬",
    [DocumentType.PATHOLOGY]: "🔬",
    [DocumentType.PROGRESS_NOTE]: "📝",
    [DocumentType.MEDICATION]: "💊",
    [DocumentType.DISCHARGE]: "🏠",
    [DocumentType.CORRESPONDENCE]: "✉️",
    [DocumentType.UNKNOWN]: "📄",
  };
  return emojiMap[type] || "📄";
};

const formatDocTypeName = (type: DocumentType): string => {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const getOriginalDocNumber = (
  documents: readonly TimelineDocument[],
  duplicateHash: string
): number => {
  const original = documents.find(
    (d) => d.fingerprint.contentHash === duplicateHash
  );
  return original?.documentNumber || 0;
};

/**
 * BUILD MASTER TIMELINE (Effect Pipeline)
 *
 * OCaml equivalent:
 * val build_master_timeline :
 *   processed_file list ->
 *   timeline_options ->
 *   (master_timeline, app_error) result
 */
export const buildMasterTimeline = (
  files: readonly ProcessedFile[],
  options?: TimelineOptions
): Effect.Effect<
  { timeline: MasterTimeline; errors: ErrorCollector },
  never,
  never
> => {
  return Effect.gen(function* (_) {
    const reverseOrder = options?.reverseChronological || false;
    const errorCollector = new ErrorCollector();

    console.log(
      `🗓️ Building master timeline (${reverseOrder ? "newest → oldest" : "oldest → newest"})...`
    );

    // Step 1: Generate fingerprints and temporal data
    const timelineDocuments: TimelineDocument[] = [];

    for (const file of files) {
      if (!file.scrubbedText) continue;

      const fingerprint = yield* _(
        Effect.promise(() =>
          generateFingerprint(file.originalName, file.scrubbedText!)
        )
      );

      // Extract lab data if applicable
      const date = extractPrimaryDate(
        file.originalName,
        file.scrubbedText,
        errorCollector
      );
      const labData =
        fingerprint.documentType === DocumentType.LAB_REPORT
          ? extractLabResults(file.scrubbedText, date.toLocaleDateString())
          : undefined;

      const doc = createTimelineDocument(
        file,
        fingerprint,
        labData,
        errorCollector
      );
      timelineDocuments.push(doc);
    }

    // Step 2: Sort chronologically
    const sorted = sortDocuments(timelineDocuments, reverseOrder);

    // Step 3: Detect duplicates
    const withDuplicates = detectDuplicates(sorted, errorCollector);

    // Step 4: Generate summary statistics
    const summary = generateSummary(withDuplicates);

    // Step 5: Generate optimized markdown
    const markdown = generateTimelineMarkdown(
      withDuplicates,
      summary,
      reverseOrder
    );

    console.log(
      `✅ Timeline built: ${summary.totalDocuments} docs, ${summary.uniqueDocuments} unique`
    );

    const timeline: MasterTimeline = {
      documents: withDuplicates,
      summary,
      markdown,
    };

    return { timeline, errors: errorCollector };
  });
};

/**
 * HELPER: Run timeline builder (for easy migration)
 */
export const runBuildMasterTimeline = async (
  files: ProcessedFile[],
  options?: TimelineOptions
): Promise<MasterTimeline> => {
  const { timeline, errors } = await Effect.runPromise(
    buildMasterTimeline(files, options)
  );

  // Log warnings if any
  if (errors.hasErrors()) {
    console.warn(
      `⚠️ Timeline built with ${errors.count()} warnings:`,
      errors.toJSON()
    );
  }

  return timeline;
};
