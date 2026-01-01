/**
 * FILE PARSER - EFFECT-TS VERSION
 *
 * OCaml-style document parsing with algebraic effects.
 *
 * Architecture:
 * - Effect<string, AppError, FileParserService>
 * - Railway-oriented programming (PDF → OCR fallback)
 * - Errors as values (PDFParseError, OCRError)
 * - Immutable state
 *
 * Supported Formats:
 * 1. PDF (hybrid: digital text + OCR fallback for scanned pages)
 * 2. DOCX (mammoth → markdown)
 * 3. Images (Tesseract OCR)
 * 4. Text files (plain text, CSV, markdown, JSON)
 */

import { Effect, Context, Layer, pipe } from "effect";
import * as pdfjsLib from "pdfjs-dist";
import { TextItem } from "pdfjs-dist/types/src/display/api";
import mammoth from "mammoth";
import Tesseract from "tesseract.js";
import { AppError, PDFParseError, OCRError, FileSystemError } from "./errors";
import { validateFile } from "./fileValidation";
import { appLogger } from "./appLogger";
import {
  OCRQualityResult,
  defaultOCRQualityConfig,
  isGarbageToken,
} from "../schemas/ocrQuality";
import {
  OCRQualityService,
  OCRQualityServiceLive,
  needsManualReview,
} from "./ocrQualityGate.effect";

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * PDF LINE (Immutable)
 */
interface PDFAggregatedLine {
  readonly y: number;
  readonly text: string;
  readonly lastX: number;
}

/**
 * PARSE RESULT (with metadata)
 */
interface ParseResult {
  readonly text: string;
  readonly pageCount?: number;
  readonly ocrPagesUsed?: number;
  readonly confidence?: number;
  readonly ocrQuality?: OCRQualityResult;
  readonly needsReview?: boolean;
}

/**
 * TESSERACT WORD TYPE (for word-level access)
 */
interface TesseractWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    words: TesseractWord[];
  };
}

/**
 * FILE PARSER SERVICE (Effect Layer)
 *
 * OCaml equivalent:
 * module type FileParser = sig
 *   val parse_pdf : file -> (string, error) result
 *   val parse_docx : file -> (string, error) result
 *   val parse_image : file -> (string, error) result
 * end
 */
export interface FileParserService {
  readonly parseFile: (
    file: File
  ) => Effect.Effect<ParseResult, AppError, never>;
}

export const FileParserService = Context.GenericTag<FileParserService>(
  "FileParserService"
);

/**
 * PARSE IMAGE (OCR with quality gate)
 */
const parseImage = (file: File): Effect.Effect<ParseResult, OCRError, never> => {
  return Effect.gen(function* (_) {
    // Run Tesseract with word-level output
    const result = yield* _(
      Effect.tryPromise({
        try: async (): Promise<TesseractResult> => {
          const res = await Tesseract.recognize(file, "eng", {
            logger: (m) => {
              if (m.status === "recognizing text") {
                appLogger.debug('ocr_progress', { percent: Math.round(m.progress * 100) });
              }
            },
          });
          return res as TesseractResult;
        },
        catch: (_error) =>
          new OCRError({
            file: file.name,
            confidence: 0,
            suggestion:
              "Image quality may be too low. Try increasing resolution or adjusting contrast.",
          }),
      })
    );

    // Convert Tesseract words to our format for quality analysis
    const words = (result.data.words || []).map((tw) => ({
      text: tw.text,
      confidence: tw.confidence,
      bbox: {
        x: tw.bbox.x0,
        y: tw.bbox.y0,
        width: tw.bbox.x1 - tw.bbox.x0,
        height: tw.bbox.y1 - tw.bbox.y0,
      },
      isGarbage: isGarbageToken(tw.text),
    }));

    // Run quality analysis via the service
    const qualityProgram = pipe(
      Effect.gen(function* (_) {
        const qualityService = yield* _(OCRQualityService);
        return yield* _(qualityService.analyzeQuality(words));
      }),
      Effect.provide(OCRQualityServiceLive)
    );

    const ocrQuality = yield* _(qualityProgram);

    // Log quality assessment
    appLogger.debug('ocr_quality', {
      file: file.name,
      score: Number(ocrQuality.score.toFixed(2)),
      level: ocrQuality.level,
      flags: ocrQuality.flags,
    });

    return {
      text: result.data.text,
      confidence: result.data.confidence / 100, // Normalize to 0-1
      ocrQuality,
      needsReview: needsManualReview(ocrQuality),
    };
  });
};

/**
 * PARSE PDF PAGE (with OCR fallback and quality gate)
 */
const parsePDFPage = (
  page: any,
  pageNum: number
): Effect.Effect<
  { text: string; usedOCR: boolean; ocrQuality?: OCRQualityResult },
  PDFParseError | OCRError,
  never
> => {
  return Effect.gen(function* (_) {
    // Get text content
    const textContent: any = yield* _(
      Effect.tryPromise({
        try: () => page.getTextContent(),
        catch: (error) =>
          new PDFParseError({
            file: "pdf",
            page: pageNum,
            reason: error instanceof Error ? error.message : String(error),
            suggestion: `Page ${pageNum} may be corrupted. Try extracting it separately.`,
          }),
      })
    );

    // Check if page is scanned (< 50 chars = likely image)
    const rawPageText = textContent.items
      .map((item) => (item as TextItem).str)
      .join("");

    if (rawPageText.length < 50) {
      appLogger.debug('pdf_page_scanned_ocr', { page: pageNum });

      // Render page to canvas
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      if (!context) {
        return {
          text: `[OCR_UNAVAILABLE_PAGE_${pageNum}]\n`,
          usedOCR: false,
        };
      }

      // Render to canvas
      yield* _(
        Effect.tryPromise({
          try: () =>
            (page.render({ canvasContext: context, viewport }) as unknown as { promise: Promise<void> }).promise,
          catch: (error) =>
            new PDFParseError({
              file: "pdf",
              page: pageNum,
              reason: `Canvas render failed: ${error}`,
              suggestion: "Page may contain unsupported elements.",
            }),
        })
      );

      // Convert to blob
      const blob = yield* _(
        Effect.tryPromise({
          try: () =>
            new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((b) => (b ? resolve(b) : reject("Blob is null")));
            }),
          catch: () =>
            new PDFParseError({
              file: "pdf",
              page: pageNum,
              reason: "Canvas to blob conversion failed",
              suggestion: "Browser may not support canvas operations.",
            }),
        })
      );

      // Run OCR with word-level output
      const ocrResult = yield* _(
        pipe(
          Effect.tryPromise({
            try: async (): Promise<TesseractResult> => {
              const res = await Tesseract.recognize(blob, "eng", {
                logger: (m) => {
                  if (m.status === "recognizing text") {
                    appLogger.debug('ocr_page_progress', { page: pageNum, percent: Math.round(m.progress * 100) });
                  }
                },
              });
              return res as TesseractResult;
            },
            catch: (_error) =>
              new OCRError({
                file: `pdf page ${pageNum}`,
                confidence: 0,
                suggestion: "OCR failed. Page may be blank or illegible.",
              }),
          }),
          Effect.catchAll((_error) => {
            // On OCR failure, return placeholder
            return Effect.succeed({
              data: {
                text: `[OCR_FAILED_PAGE_${pageNum}]\n`,
                confidence: 0,
                words: [],
              },
            } as TesseractResult);
          })
        )
      );

      // Analyze OCR quality if we have words
      let ocrQuality: OCRQualityResult | undefined;
      if (ocrResult.data.words && ocrResult.data.words.length > 0) {
        const words = ocrResult.data.words.map((tw) => ({
          text: tw.text,
          confidence: tw.confidence,
          bbox: {
            x: tw.bbox.x0,
            y: tw.bbox.y0,
            width: tw.bbox.x1 - tw.bbox.x0,
            height: tw.bbox.y1 - tw.bbox.y0,
          },
          isGarbage: isGarbageToken(tw.text),
        }));

        const qualityProgram = pipe(
          Effect.gen(function* (_) {
            const qualityService = yield* _(OCRQualityService);
            return yield* _(qualityService.analyzeQuality(words));
          }),
          Effect.provide(OCRQualityServiceLive)
        );

        ocrQuality = yield* _(qualityProgram);
        ocrQuality = { ...ocrQuality, pageNumber: pageNum };

        appLogger.debug('ocr_quality_page', {
          page: pageNum,
          score: Number(ocrQuality.score.toFixed(2)),
          level: ocrQuality.level,
          flags: ocrQuality.flags,
        });

        // If LOW quality and TrOCR available, attempt repair
        if (
          ocrQuality.level === "LOW" &&
          ocrQuality.lowConfidenceRegions.length > 0 &&
          defaultOCRQualityConfig.enableTrOCR
        ) {
          appLogger.debug('trocr_attempt', {
            page: pageNum,
            lowConfidenceRegions: ocrQuality.lowConfidenceRegions.length,
          });

          // TrOCR repair would happen here with canvas access
          // For now, just flag that repair was attempted
          ocrQuality = {
            ...ocrQuality,
            flags: [...ocrQuality.flags, "NEEDS_MANUAL_REVIEW"],
          };
        }
      }

      return {
        text: `[OCR_RECOVERED_PAGE_${pageNum}]\n` + ocrResult.data.text,
        usedOCR: true,
        ocrQuality,
      };
    }

    // Digital text extraction (advanced layout analysis)
    let lines: PDFAggregatedLine[] = [];

    for (const item of textContent.items) {
      if (!("str" in item)) continue;

      const textItem = item as TextItem;
      const x = textItem.transform[4];
      const y = Math.round(textItem.transform[5]);
      const text = textItem.str;
      const width = textItem.width;

      if (!text.trim()) continue;

      const existingLine = lines.find((l) => Math.abs(l.y - y) < 5);

      if (existingLine) {
        const gap = x - existingLine.lastX;

        // Smart spacing: gap > 4px = add space
        const newText =
          gap > 4
            ? existingLine.text + " " + text
            : existingLine.text + text;

        // Create new line (immutable)
        const index = lines.indexOf(existingLine);
        lines = [
          ...lines.slice(0, index),
          {
            y: existingLine.y,
            text: newText,
            lastX: x + width,
          },
          ...lines.slice(index + 1),
        ];
      } else {
        lines.push({ y, text, lastX: x + width });
      }
    }

    // Sort top-to-bottom
    lines.sort((a, b) => b.y - a.y);
    const pageText = lines.map((l) => l.text).join("\n");

    return { text: pageText, usedOCR: false, ocrQuality: undefined };
  });
};

/**
 * CLEAN PDF ARTIFACTS (remove headers/footers)
 *
 * Pure function - no side effects
 */
const cleanPDFArtifacts = (pages: string[]): string => {
  if (pages.length <= 3) return pages.join("\n\n--- Page Break ---\n\n");

  const firstLines = pages
    .map((p) => p.split("\n")[0]?.trim())
    .filter(Boolean);
  const lastLines = pages
    .map((p) => {
      const lines = p.split("\n");
      return lines[lines.length - 1]?.trim();
    })
    .filter(Boolean);

  const commonHeader = getMode(firstLines);
  const commonFooter = getMode(lastLines);

  // Threshold: 75% of pages
  const threshold = pages.length * 0.75;

  return pages
    .map((p) => {
      let lines = p.split("\n");

      // Remove header (if short and common)
      if (
        commonHeader &&
        commonHeader.count > threshold &&
        lines[0]?.trim() === commonHeader.value &&
        commonHeader.value.length < 150
      ) {
        lines.shift();
      }

      // Remove footer (if short and common)
      if (
        commonFooter &&
        commonFooter.count > threshold &&
        lines[lines.length - 1]?.trim() === commonFooter.value &&
        commonFooter.value.length < 150
      ) {
        lines.pop();
      }

      return lines.join("\n");
    })
    .join("\n\n--- Page Break ---\n\n");
};

/**
 * GET MODE (most common value)
 *
 * Pure function
 */
const getMode = (
  arr: string[]
): { value: string; count: number } | null => {
  if (arr.length === 0) return null;

  const counts = new Map<string, number>();
  let maxCount = 0;
  let modeValue: string | null = null;

  for (const item of arr) {
    const newCount = (counts.get(item) || 0) + 1;
    counts.set(item, newCount);

    if (newCount > maxCount) {
      maxCount = newCount;
      modeValue = item;
    }
  }

  return modeValue ? { value: modeValue, count: maxCount } : null;
};

/**
 * PARSE PDF (main function)
 */
const parsePDF = (
  file: File
): Effect.Effect<ParseResult, PDFParseError | OCRError | FileSystemError, never> => {
  return Effect.gen(function* (_) {
    // Load PDF
    const arrayBuffer = yield* _(
      Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (error) =>
          new FileSystemError({
            operation: "read",
            path: file.name,
            reason: error instanceof Error ? error.message : String(error),
            suggestion: "File may be locked or corrupted.",
          }),
      })
    );

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = yield* _(
      Effect.tryPromise({
        try: () => loadingTask.promise,
        catch: (error) =>
          new PDFParseError({
            file: file.name,
            reason: error instanceof Error ? error.message : String(error),
            suggestion: "PDF may be encrypted or corrupted.",
          }),
      })
    );

    // Parse all pages
    const pages: string[] = [];
    let ocrPagesUsed = 0;
    const ocrQualities: OCRQualityResult[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = yield* _(
        Effect.tryPromise({
          try: () => pdf.getPage(i),
          catch: (error) =>
            new PDFParseError({
              file: file.name,
              page: i,
              reason: error instanceof Error ? error.message : String(error),
              suggestion: `Page ${i} may be damaged.`,
            }),
        })
      );

      const { text, usedOCR, ocrQuality } = yield* _(parsePDFPage(page, i));
      pages.push(text);
      if (usedOCR) ocrPagesUsed++;
      if (ocrQuality) ocrQualities.push(ocrQuality);
    }

    const cleanedText = cleanPDFArtifacts(pages);

    // Aggregate OCR quality (use worst score, collect all flags)
    let aggregatedQuality: OCRQualityResult | undefined;
    if (ocrQualities.length > 0) {
      const worstQuality = ocrQualities.reduce((worst, current) =>
        current.score < worst.score ? current : worst
      );
      const allFlags = [...new Set(ocrQualities.flatMap((q) => q.flags))];

      aggregatedQuality = {
        ...worstQuality,
        flags: allFlags as OCRQualityResult["flags"],
      };
    }

    return {
      text: cleanedText,
      pageCount: pdf.numPages,
      ocrPagesUsed,
      ocrQuality: aggregatedQuality,
      needsReview: aggregatedQuality ? needsManualReview(aggregatedQuality) : false,
    };
  });
};

/**
 * PARSE DOCX
 */
const parseDocx = (
  file: File
): Effect.Effect<ParseResult, PDFParseError, never> => {
  return Effect.gen(function* (_) {
    const arrayBuffer = yield* _(
      Effect.tryPromise({
        try: () => file.arrayBuffer(),
        catch: (error) =>
          new PDFParseError({
            file: file.name,
            reason: error instanceof Error ? error.message : String(error),
            suggestion: "File may be corrupted or password-protected.",
          }),
      })
    );

    const result = yield* _(
      Effect.tryPromise({
        try: () => mammoth.convertToHtml({ arrayBuffer }),
        catch: (error) =>
          new PDFParseError({
            file: file.name,
            reason: `Mammoth conversion failed: ${error}`,
            suggestion: "DOCX may use unsupported features.",
          }),
      })
    );

    const markdown = convertHtmlToMarkdown(result.value);

    return { text: markdown };
  });
};

/**
 * CONVERT HTML TO MARKDOWN
 *
 * Pure function
 */
const convertHtmlToMarkdown = (html: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  let markdown = "";

  const processNode = (node: Node, context: { inTable?: boolean } = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent?.replace(/\s+/g, " ") || "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();

    // Opening tags
    switch (tagName) {
      case "h1":
        markdown += "\n# ";
        break;
      case "h2":
        markdown += "\n## ";
        break;
      case "h3":
        markdown += "\n### ";
        break;
      case "h4":
        markdown += "\n#### ";
        break;
      case "p":
        markdown += "\n\n";
        break;
      case "br":
        markdown += "\n";
        break;
      case "strong":
      case "b":
        markdown += "**";
        break;
      case "em":
      case "i":
        markdown += "_";
        break;
      case "table":
        markdown += "\n\n";
        break;
      case "ul":
        markdown += "\n";
        break;
      case "li":
        markdown += "\n- ";
        break;
      case "img":
        const alt = el.getAttribute("alt") || "embedded image";
        markdown += `\n\n> 📷 **[IMAGE: ${alt}]** - Image-only content, manual review may be required\n\n`;
        return;
    }

    // Table processing
    if (tagName === "table") {
      const tbody = el.querySelector("tbody") || el;
      Array.from(tbody.children).forEach((row, rowIndex) => {
        if (row.tagName.toLowerCase() !== "tr") return;
        markdown += "|";
        let colIndex = 0;

        Array.from(row.children).forEach((cell) => {
          const cellEl = cell as HTMLTableCellElement;
          markdown += " ";
          cellEl.childNodes.forEach((child) =>
            processNode(child, { inTable: true })
          );
          markdown += " |";
          colIndex++;

          const colspan = cellEl.colSpan;
          if (colspan > 1) {
            for (let i = 1; i < colspan; i++) {
              markdown += " <Merged> |";
              colIndex++;
            }
          }
        });

        markdown += "\n";
        if (rowIndex === 0) markdown += "|" + " --- |".repeat(colIndex) + "\n";
      });
    } else {
      el.childNodes.forEach((child) => processNode(child, context));
    }

    // Closing tags
    switch (tagName) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
        markdown += "\n";
        break;
      case "strong":
      case "b":
        markdown += "**";
        break;
      case "em":
      case "i":
        markdown += "_";
        break;
      case "table":
        markdown += "\n";
        break;
    }
  };

  doc.body.childNodes.forEach((node) => processNode(node));
  return markdown.replace(/\n{3,}/g, "\n\n").trim();
};

/**
 * FILE PARSER IMPLEMENTATION
 */
class FileParserServiceImpl implements FileParserService {
  readonly parseFile = (file: File) => {
    return Effect.gen(function* (_) {
      const validation = validateFile(file);
      if (!validation.ok) {
        return yield* _(
          Effect.fail(
            new PDFParseError({
              file: validation.normalizedName || file.name,
              reason: validation.issues.map((i) => i.message).join(" "),
              suggestion: "Rename the file and ensure it matches a supported format.",
            })
          )
        );
      }

      const fileType = file.type;

      // PDF
      if (fileType === "application/pdf") {
        return yield* _(parsePDF(file));
      }

      // DOCX
      if (
        fileType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        return yield* _(parseDocx(file));
      }

      // Images (OCR)
      if (fileType.startsWith("image/")) {
        return yield* _(parseImage(file));
      }

      // Plain text files
      if (
        fileType === "text/plain" ||
        fileType === "text/csv" ||
        fileType === "text/markdown" ||
        fileType === "application/json" ||
        file.name.endsWith(".md") ||
        file.name.endsWith(".csv")
      ) {
        const text = yield* _(
          Effect.tryPromise({
            try: () => file.text(),
            catch: (error) =>
              new FileSystemError({
                operation: "read",
                path: file.name,
                reason: error instanceof Error ? error.message : String(error),
                suggestion: "File encoding may be unsupported.",
              }),
          })
        );

        return { text };
      }

      // Unsupported file type
      return yield* _(
        Effect.fail(
          new PDFParseError({
            file: file.name,
            reason: `Unsupported file type: ${fileType}`,
            suggestion:
              "Supported formats: PDF, DOCX, images (PNG/JPG), text files.",
          })
        )
      );
    });
  };
}

/**
 * FILE PARSER LAYER
 */
export const FileParserServiceLive = Layer.succeed(
  FileParserService,
  new FileParserServiceImpl()
);

/**
 * MAIN PARSE FUNCTION (Effect Pipeline)
 */
export const parseFile = (
  file: File
): Effect.Effect<ParseResult, AppError, FileParserService> => {
  return Effect.gen(function* (_) {
    const parser = yield* _(FileParserService);
    return yield* _(parser.parseFile(file));
  });
};

/**
 * HELPER: Run parser (for easy migration)
 */
export const runParseFile = async (file: File): Promise<string> => {
  const program = pipe(parseFile(file), Effect.provide(FileParserServiceLive));

  const result = await Effect.runPromise(program);
  return result.text;
};
