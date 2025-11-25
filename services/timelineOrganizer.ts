/**
 * Temporal Organization & Master Timeline Generation
 * Optimized for LLM pathological analysis
 *
 * Types imported from schemas.ts (single source of truth)
 */

import { parse, isValid } from 'date-fns';
import {
  type DocumentFingerprint,
  type DuplicateAnalysis,
  type TimelineDocument,
  type MasterTimeline,
  type TimelineSummary,
  type LabPanel,
  DocumentType,
} from '../schemas';
import { analyzeDuplication, generateFingerprint } from './contentHasher';
import { extractLabResults, formatLabTable, generateTrendAnalysis } from './labExtractor';
import { ProcessedFile } from '../types';

// Re-export for backward compatibility
export type {
  TimelineDocument,
  MasterTimeline,
  TimelineSummary,
  DocumentFingerprint,
  DuplicateAnalysis,
};

/**
 * Extract primary date from filename or content using date-fns
 */
export const extractPrimaryDate = (filename: string, content: string): Date => {
  const dateFormats = [
    'MM-dd-yyyy',
    'MM/dd/yyyy',
    'yyyy-MM-dd',
    'MMM dd yyyy',
    'MMMM dd yyyy'
  ];

  // Try filename first (most reliable)
  const filenamePatterns = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/,           // MM-DD-YYYY or MM/DD/YYYY
    /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/,           // YYYY-MM-DD
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i
  ];

  for (const pattern of filenamePatterns) {
    const match = filename.match(pattern);
    if (match) {
      const dateStr = match[0];

      // Try parsing with date-fns (more robust than new Date())
      for (const formatStr of dateFormats) {
        try {
          const parsedDate = parse(dateStr, formatStr, new Date());
          if (isValid(parsedDate)) {
            return parsedDate;
          }
        } catch {
          // Try next format
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
  for (const pattern of filenamePatterns) {
    const match = contentStart.match(pattern);
    if (match) {
      const dateStr = match[0];

      for (const formatStr of dateFormats) {
        try {
          const parsedDate = parse(dateStr, formatStr, new Date());
          if (isValid(parsedDate)) {
            return parsedDate;
          }
        } catch {
          continue;
        }
      }

      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }

  // Fallback to current date (should be rare)
  console.warn(`No date found for: ${filename}, using current date`);
  return new Date();
};

/**
 * Build master timeline from processed documents
 * @param files - Processed medical documents
 * @param options - Configuration options (reverseChronological: newest first for quick updates)
 */
export const buildMasterTimeline = async (
  files: ProcessedFile[],
  options?: { reverseChronological?: boolean }
): Promise<MasterTimeline> => {
  const reverseOrder = options?.reverseChronological || false;
  console.log(`🗓️ Building master timeline (${reverseOrder ? 'newest → oldest' : 'oldest → newest'})...`);

  // Step 1: Generate fingerprints and temporal data
  const timelineDocuments: TimelineDocument[] = [];

  for (const file of files) {
    if (!file.scrubbedText) continue;

    const date = extractPrimaryDate(file.originalName, file.scrubbedText);
    const fingerprint = await generateFingerprint(file.originalName, file.scrubbedText);

    // Extract lab data if applicable (convert null to undefined)
    const labData = fingerprint.documentType === DocumentType.LAB_REPORT
      ? extractLabResults(file.scrubbedText, date.toLocaleDateString()) ?? undefined
      : undefined;

    timelineDocuments.push({
      id: file.id,
      filename: file.originalName,
      date,
      displayDate: date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }),
      content: file.scrubbedText,
      fingerprint,
      labData,
      documentNumber: 0 // Will be set after sorting
    });
  }

  // Step 2: Sort chronologically
  // FIXED: Support reverse chronological (newest first) for quick updates
  if (reverseOrder) {
    timelineDocuments.sort((a, b) => b.date.getTime() - a.date.getTime());
  } else {
    timelineDocuments.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  // Assign document numbers
  timelineDocuments.forEach((doc, idx) => {
    doc.documentNumber = idx + 1;
  });

  // Step 3: Detect duplicates
  for (let i = 0; i < timelineDocuments.length; i++) {
    const currentDoc = timelineDocuments[i];

    // Compare with all previous documents
    for (let j = 0; j < i; j++) {
      const previousDoc = timelineDocuments[j];

      const duplicationInfo = analyzeDuplication(
        currentDoc.fingerprint,
        previousDoc.fingerprint,
        currentDoc.date,
        previousDoc.date
      );

      // If duplicate found, mark it
      if (duplicationInfo.isDuplicate || duplicationInfo.differenceType === 'same-event') {
        currentDoc.duplicationInfo = duplicationInfo;
        break; // Only mark first duplicate found
      }
    }
  }

  // Step 4: Generate summary statistics
  const summary = generateSummary(timelineDocuments);

  // Step 5: Generate optimized markdown
  const markdown = generateTimelineMarkdown(timelineDocuments, summary, reverseOrder);

  console.log(`✅ Timeline built: ${summary.totalDocuments} docs, ${summary.uniqueDocuments} unique`);

  return {
    documents: timelineDocuments,
    summary,
    markdown
  };
};

/**
 * Generate summary statistics
 */
const generateSummary = (documents: TimelineDocument[]): TimelineSummary => {
  const duplicates = documents.filter(d => d.duplicationInfo?.isDuplicate).length;
  const uniqueDocuments = documents.length - duplicates;

  const documentTypes: Record<DocumentType, number> = {} as Record<DocumentType, number>;
  for (const doc of documents) {
    const type = doc.fingerprint.documentType;
    documentTypes[type] = (documentTypes[type] || 0) + 1;
  }

  const dates = documents.map(d => d.date.getTime());
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));

  return {
    totalDocuments: documents.length,
    uniqueDocuments,
    duplicates,
    dateRange: {
      earliest: earliest.toLocaleDateString(),
      latest: latest.toLocaleDateString()
    },
    documentTypes
  };
};

/**
 * Generate LLM-optimized markdown timeline
 */
const generateTimelineMarkdown = (
  documents: TimelineDocument[],
  summary: TimelineSummary,
  reverseChronological: boolean = false
): string => {
  const sections: string[] = [];
  const sortDirection = reverseChronological ? 'newest → oldest' : 'oldest → newest';

  // Header
  sections.push('# 🏥 Medical Record Timeline\n');
  sections.push('## 📊 Summary Statistics\n');
  sections.push(`- **Date Range**: ${summary.dateRange.earliest} → ${summary.dateRange.latest}`);
  sections.push(`- **Total Documents**: ${summary.totalDocuments} (${summary.uniqueDocuments} unique, ${summary.duplicates} duplicates)`);
  sections.push(`- **Document Types**:`);

  for (const [type, count] of Object.entries(summary.documentTypes)) {
    const emoji = getDocTypeEmoji(type as DocumentType);
    sections.push(`  - ${emoji} ${formatDocTypeName(type as DocumentType)}: ${count}`);
  }

  sections.push('\n---\n');

  // Timeline sections
  sections.push('## 📅 Chronological Timeline\n');
  sections.push(`_Documents are ordered chronologically (${sortDirection}) for temporal analysis._\n`);

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
    const relationNote = doc.duplicationInfo?.differenceType === 'same-event'
      ? `\n> 🔗 **Related**: This document appears to reference the same clinical encounter as document #${getOriginalDocNumber(documents, doc.duplicationInfo.duplicateOf!)} but contains different information.\n`
      : '';

    // Document header
    const emoji = getDocTypeEmoji(doc.fingerprint.documentType);
    sections.push(
      `### ${emoji} ${doc.displayDate} | ${doc.filename}\n` +
      `**Document #${doc.documentNumber}** | Type: ${formatDocTypeName(doc.fingerprint.documentType)} | ` +
      `Hash: \`${doc.fingerprint.contentHash.substring(0, 8)}\`` +
      relationNote + '\n'
    );

    // Lab results get special formatting
    if (doc.labData) {
      sections.push(formatLabTable(doc.labData));

      // Add trend analysis if we have previous labs
      if (previousLabPanel) {
        const trends = generateTrendAnalysis(doc.labData, previousLabPanel);
        if (trends) {
          sections.push(trends + '\n');
        }
      }

      previousLabPanel = doc.labData;

      // Add raw content in collapsible section
      sections.push('<details>\n<summary>📄 View Full Lab Report</summary>\n\n');
      sections.push('```\n' + doc.content + '\n```\n');
      sections.push('</details>\n');
    } else {
      // Non-lab documents: Truncate long content for cognitive load reduction
      // FIXED: Limit to 50 lines to prevent overwhelming output
      const lines = doc.content.split('\n');
      const MAX_LINES = 50;

      if (lines.length > MAX_LINES) {
        const truncatedContent = lines.slice(0, MAX_LINES).join('\n');
        const remainingLines = lines.length - MAX_LINES;
        sections.push(truncatedContent + '\n');
        sections.push(`\n> ⚠️ **Content truncated** - ${remainingLines} additional lines omitted for readability. Full document available in source files.\n`);
      } else {
        sections.push(doc.content + '\n');
      }
    }

    sections.push('\n---\n');
  }

  return sections.join('\n');
};

/**
 * Helper functions
 */
const getDocTypeEmoji = (type: DocumentType): string => {
  const emojiMap: Record<DocumentType, string> = {
    [DocumentType.LAB_REPORT]: '🧪',
    [DocumentType.IMAGING]: '🔬',
    [DocumentType.PATHOLOGY]: '🔬',
    [DocumentType.PROGRESS_NOTE]: '📝',
    [DocumentType.MEDICATION]: '💊',
    [DocumentType.DISCHARGE]: '🏠',
    [DocumentType.CORRESPONDENCE]: '✉️',
    [DocumentType.UNKNOWN]: '📄'
  };
  return emojiMap[type] || '📄';
};

const formatDocTypeName = (type: DocumentType): string => {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const getOriginalDocNumber = (
  documents: TimelineDocument[],
  duplicateHash: string
): number => {
  const original = documents.find(d => d.fingerprint.contentHash === duplicateHash);
  return original?.documentNumber || 0;
};
