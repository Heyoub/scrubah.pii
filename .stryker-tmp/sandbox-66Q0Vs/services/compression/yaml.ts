/**
 * YAML GENERATION - LLM-OPTIMIZED OUTPUT
 *
 * Converts CompressedTimeline to clean, hierarchical YAML.
 *
 * Design principles:
 * - Human-readable (LLMs prefer natural structure)
 * - Minimal repetition (no redundant fields)
 * - Clear hierarchy (indentation conveys relationships)
 * - Embedded errors (warnings inline, not separate file)
 *
 * Why YAML over JSON/XML:
 * - 30% smaller than JSON (no quotes/braces overhead)
 * - 50% smaller than XML (no closing tags)
 * - More readable for humans and LLMs
 * - Comments allowed (for metadata)
 */
// @ts-nocheck


import { Effect } from "effect";
import {
  CompressedTimeline,
  TimelineEntry,
  YAMLOutput,
  YAMLMetadata,
} from "./schema";
import { ErrorCollector, ErrorRecord } from "./errors";

/**
 * YAML string builder (mutable builder pattern)
 */
class YAMLBuilder {
  private lines: string[] = [];
  private indentLevel = 0;

  indent(): YAMLBuilder {
    this.indentLevel += 2;
    return this;
  }

  outdent(): YAMLBuilder {
    this.indentLevel = Math.max(0, this.indentLevel - 2);
    return this;
  }

  addLine(content: string): YAMLBuilder {
    const padding = " ".repeat(this.indentLevel);
    this.lines.push(`${padding}${content}`);
    return this;
  }

  addBlankLine(): YAMLBuilder {
    this.lines.push("");
    return this;
  }

  addComment(comment: string): YAMLBuilder {
    const padding = " ".repeat(this.indentLevel);
    this.lines.push(`${padding}# ${comment}`);
    return this;
  }

  build(): string {
    return this.lines.join("\n");
  }
}

/**
 * Format date as YYYY-MM-DD (ISO date only, no time)
 */
const formatDate = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

/**
 * Escape YAML special characters
 */
const escapeYAML = (str: string): string => {
  // Quote strings with special chars
  if (/[:#\[\]{}|>*&!%@`]/.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
};

/**
 * Generate timeline events section
 */
const generateTimelineSection = (
  builder: YAMLBuilder,
  events: TimelineEntry[]
): YAMLBuilder => {
  builder.addLine("timeline:");
  builder.indent();

  for (const event of events) {
    builder.addLine(`- id: ${event.id}`);
    builder.indent();
    builder.addLine(`date: ${formatDate(event.date)}`);
    builder.addLine(`type: ${event.type}`);
    builder.addLine(`source: ${escapeYAML(event.sourceDocument)}`);
    builder.addLine(`confidence: ${event.confidence}`);
    builder.outdent();
  }

  builder.outdent();
  return builder;
};

/**
 * Generate metadata section
 */
const generateMetadataSection = (
  builder: YAMLBuilder,
  timeline: CompressedTimeline
): YAMLBuilder => {
  const meta = timeline.compressionMetadata;

  builder.addLine("metadata:");
  builder.indent();
  builder.addLine(`generatedAt: ${new Date().toISOString()}`);
  builder.addLine(`version: "1.0.0"`);
  builder.addLine(`schemaVersion: "1.0.0"`);
  builder.addBlankLine();

  builder.addLine("compression:");
  builder.indent();
  builder.addLine(`originalSizeKb: ${meta.originalSizeKb.toFixed(2)}`);
  builder.addLine(`compressedSizeKb: ${meta.compressedSizeKb.toFixed(2)}`);
  builder.addLine(`ratio: ${(meta.ratio * 100).toFixed(1)}%`);
  builder.addLine(`eventsTotal: ${meta.eventsTotal}`);
  builder.addLine(`eventsIncluded: ${meta.eventsIncluded}`);
  builder.addLine(`eventsRemoved: ${meta.eventsTotal - meta.eventsIncluded}`);
  builder.addLine(`deduplication: ${meta.deduplication}`);
  builder.outdent();

  builder.outdent();
  return builder;
};

/**
 * Generate errors/warnings section
 */
const generateErrorsSection = (
  builder: YAMLBuilder,
  errorCollector: ErrorCollector
): YAMLBuilder => {
  const errors = errorCollector.getAll();

  if (errors.length === 0) {
    return builder;
  }

  builder.addBlankLine();
  builder.addLine("warnings:");
  builder.indent();

  for (const error of errors) {
    builder.addLine(`- type: ${error.type}`);
    builder.indent();
    builder.addLine(`message: ${escapeYAML(error.message)}`);

    if (error.file) {
      builder.addLine(`file: ${escapeYAML(error.file)}`);
    }

    builder.addLine(`suggestion: ${escapeYAML(error.suggestion)}`);
    builder.addLine(`recoverable: ${error.recoverable}`);

    if (error.impact) {
      builder.addLine(`impact: ${error.impact}`);
    }

    if (error.details) {
      builder.addLine("details:");
      builder.indent();
      for (const [key, value] of Object.entries(error.details)) {
        builder.addLine(`${key}: ${escapeYAML(String(value))}`);
      }
      builder.outdent();
    }

    builder.outdent();
  }

  builder.outdent();
  return builder;
};

/**
 * Generate patient demographics section
 */
const generateDemographicsSection = (
  builder: YAMLBuilder,
  timeline: CompressedTimeline
): YAMLBuilder => {
  builder.addLine("patient:");
  builder.indent();
  builder.addLine(`id: ${timeline.patientId}`);
  builder.addLine(`ageAtFirstVisit: ${timeline.demographics.ageAtFirstVisit}`);
  builder.outdent();
  builder.addBlankLine();

  builder.addLine("dateRange:");
  builder.indent();
  builder.addLine(`start: ${formatDate(timeline.dateRange.start)}`);
  builder.addLine(`end: ${formatDate(timeline.dateRange.end)}`);
  builder.addLine(
    `durationDays: ${Math.floor((timeline.dateRange.end.getTime() - timeline.dateRange.start.getTime()) / (1000 * 60 * 60 * 24))}`
  );
  builder.outdent();
  builder.addBlankLine();

  builder.addLine(`totalDocuments: ${timeline.totalDocuments}`);
  builder.addLine(`totalEvents: ${timeline.totalEvents}`);

  return builder;
};

/**
 * Generate medications section
 */
const generateMedicationsSection = (
  builder: YAMLBuilder,
  timeline: CompressedTimeline
): YAMLBuilder => {
  if (
    timeline.medications.current.length === 0 &&
    timeline.medications.discontinued.length === 0
  ) {
    return builder;
  }

  builder.addBlankLine();
  builder.addLine("medications:");
  builder.indent();

  if (timeline.medications.current.length > 0) {
    builder.addLine("current:");
    builder.indent();
    for (const med of timeline.medications.current) {
      builder.addLine(`- name: ${escapeYAML(med.name)}`);
      builder.indent();
      builder.addLine(`started: ${formatDate(med.started)}`);
      if (med.reason) {
        builder.addLine(`reason: ${escapeYAML(med.reason)}`);
      }
      builder.outdent();
    }
    builder.outdent();
  }

  if (timeline.medications.discontinued.length > 0) {
    builder.addLine("discontinued:");
    builder.indent();
    for (const med of timeline.medications.discontinued) {
      builder.addLine(`- name: ${escapeYAML(med.name)}`);
      builder.indent();
      builder.addLine(`started: ${formatDate(med.started)}`);
      if (med.stopped) {
        builder.addLine(`stopped: ${formatDate(med.stopped)}`);
      }
      if (med.reason) {
        builder.addLine(`reason: ${escapeYAML(med.reason)}`);
      }
      builder.outdent();
    }
    builder.outdent();
  }

  builder.outdent();
  return builder;
};

/**
 * Generate lab trends section
 */
const generateLabTrendsSection = (
  builder: YAMLBuilder,
  timeline: CompressedTimeline
): YAMLBuilder => {
  if (timeline.labTrends.length === 0) {
    return builder;
  }

  builder.addBlankLine();
  builder.addLine("labTrends:");
  builder.indent();

  for (const trend of timeline.labTrends) {
    builder.addLine(`- name: ${escapeYAML(trend.name)}`);
    builder.indent();
    builder.addLine(`trend: ${trend.trend}`);
    builder.addLine("values:");
    builder.indent();
    for (const point of trend.values) {
      builder.addLine(`- date: ${formatDate(point.date)}`);
      builder.indent();
      builder.addLine(`value: ${point.value}`);
      if (point.abnormal !== undefined) {
        builder.addLine(`abnormal: ${point.abnormal}`);
      }
      if (point.flag) {
        builder.addLine(`flag: ${point.flag}`);
      }
      builder.outdent();
    }
    builder.outdent();
    builder.outdent();
  }

  builder.outdent();
  return builder;
};

/**
 * MAIN YAML GENERATOR
 *
 * Converts CompressedTimeline + errors to YAML string.
 */
export const generateYAML = (
  timeline: CompressedTimeline,
  errorCollector: ErrorCollector
): Effect.Effect<string, never, never> => {
  return Effect.sync(() => {
    const builder = new YAMLBuilder();

    // Header comment
    builder.addComment("=".repeat(70));
    builder.addComment("COMPRESSED MEDICAL TIMELINE");
    builder.addComment(
      "Generated by Scrubah.PII - Zero-trust medical data sanitizer"
    );
    builder.addComment("All PII has been redacted and replaced with placeholders");
    builder.addComment("=".repeat(70));
    builder.addBlankLine();

    // Metadata
    generateMetadataSection(builder, timeline);
    builder.addBlankLine();

    // Demographics
    generateDemographicsSection(builder, timeline);
    builder.addBlankLine();

    // Timeline events (main content)
    generateTimelineSection(builder, timeline.timeline as TimelineEntry[]);

    // Medications
    generateMedicationsSection(builder, timeline);

    // Lab trends
    generateLabTrendsSection(builder, timeline);

    // Errors/warnings (if any)
    generateErrorsSection(builder, errorCollector);

    return builder.build();
  });
};

/**
 * Helper: Generate YAML from compression result
 */
export const generateYAMLFromResult = async (
  timeline: CompressedTimeline,
  errors: ErrorCollector
): Promise<string> => {
  return Effect.runPromise(generateYAML(timeline, errors));
};

/**
 * Helper: Estimate YAML size (for UI previews)
 */
export const estimateYAMLSize = (timeline: CompressedTimeline): number => {
  // Rough estimate: 200 bytes per event + 1KB overhead
  return timeline.timeline.length * 200 + 1024;
};
