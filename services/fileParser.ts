import * as pdfjsLib from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

// Initialize PDF.js worker - use local worker from node_modules
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PDFAggregatedLine {
  y: number;
  text: string;
  lastX: number; // Track where the last character ended to determine spacing
}

export const parseFile = async (file: File): Promise<string> => {
  const fileType = file.type;

  try {
    if (fileType === 'application/pdf') {
      return await parsePDF(file);
    } else if (
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return await parseDocx(file);
    } else if (fileType.startsWith('image/')) {
      return await parseImage(file);
    } else if (
      fileType === 'text/plain' || 
      fileType === 'text/csv' || 
      fileType === 'text/markdown' ||
      fileType === 'application/json' ||
      file.name.endsWith('.md') ||
      file.name.endsWith('.csv')
    ) {
      return await file.text();
    } else {
      throw new Error(`Unsupported file type: ${fileType}`);
    }
  } catch (error: any) {
    console.error("Error parsing file:", error);
    throw new Error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * OCR Image Parsing
 * Uses Tesseract.js to extract text from images (PNG, JPG, WEBP).
 */
const parseImage = async (file: File): Promise<string> => {
  const result = await Tesseract.recognize(
    file,
    'eng',
    { logger: m => console.debug('OCR Progress:', m) }
  );
  return result.data.text;
};

/**
 * Hybrid PDF Parsing Logic
 * 1. Tries digital text extraction first.
 * 2. Checks for "Spacing Artifacts" (Glue vs Gaps).
 * 3. Fallback: If a page has < 50 chars of text, assumes it is a SCANNED page and runs OCR.
 */
const parsePDF = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const pages: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Heuristic: Is this page scanned?
    // If total text length is tiny (< 50 chars) but page exists, it's likely an image.
    const rawPageText = textContent.items.map((item: any) => item.str).join('');
    
    if (rawPageText.length < 50) {
        console.log(`Page ${i} appears to be scanned/image-only. Engaging OCR...`);
        const viewport = page.getViewport({ scale: 2.0 }); // High scale for better OCR
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        if (context) {
            // Fix: Cast to any to avoid type mismatch with pdfjs-dist RenderParameters which incorrectly requires 'canvas' in some versions
            await page.render({ canvasContext: context, viewport } as any).promise;
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve));
            if (blob) {
                const ocrResult = await Tesseract.recognize(blob, 'eng');
                pages.push(`[OCR_RECOVERED_PAGE_${i}]\n` + ocrResult.data.text);
                continue; // Skip standard parsing for this page
            }
        }
    }

    // Advanced Layout Analysis with Smart Spacing
    const lines: PDFAggregatedLine[] = [];
    
    for (const item of textContent.items) {
      if (!('str' in item)) continue;

      const textItem = item as TextItem;
      // transform[4] is x, transform[5] is y
      const x = textItem.transform[4];
      const y = Math.round(textItem.transform[5]); 
      const text = textItem.str;
      const width = textItem.width;

      if (!text.trim()) continue; // Skip purely empty items

      const existingLine = lines.find(l => Math.abs(l.y - y) < 5); // 5px vertical tolerance
      
      if (existingLine) {
        // Smart Spacing Logic
        // If the gap between last char and current char is significant (> 5px), add space.
        // Otherwise, assume it's part of the same word (fixing PDF split-word artifacts).
        const gap = x - existingLine.lastX;
        
        // Threshold: roughly 20% of font size (heuristic), hardcoded to 4px for general stability
        if (gap > 4) {
            existingLine.text += ' ' + text;
        } else {
            existingLine.text += text;
        }
        existingLine.lastX = x + width;
      } else {
        lines.push({ y, text, lastX: x + width });
      }
    }

    // Sort lines top-to-bottom
    lines.sort((a, b) => b.y - a.y);
    const pageText = lines.map(l => l.text).join('\n');
    pages.push(pageText);
  }
  
  return cleanPDFArtifacts(pages);
};

/**
 * Aggregates pages and carefully removes noise (Headers/Footers).
 * TUNED FOR SAFETY: Threshold increased to 75% to prevent deleting medical notes.
 */
const cleanPDFArtifacts = (pages: string[]): string => {
  if (pages.length <= 3) return pages.join('\n\n--- Page Break ---\n\n');

  const firstLines = pages.map(p => p.split('\n')[0]?.trim()).filter(Boolean);
  const lastLines = pages.map(p => {
      const lines = p.split('\n');
      return lines[lines.length - 1]?.trim();
  }).filter(Boolean);

  const commonHeader = getMode(firstLines);
  const commonFooter = getMode(lastLines);
  
  // SAFETY UPDATE: Require header/footer to appear on 75% of pages to be considered noise.
  const threshold = pages.length * 0.75;

  return pages.map(p => {
    let lines = p.split('\n');
    
    // SAFETY UPDATE: Only remove if line length is < 150 chars (headers are usually short).
    // If it's a long disclaimer or note, keep it even if it repeats.
    if (commonHeader && commonHeader.count > threshold && lines[0]?.trim() === commonHeader.value && commonHeader.value.length < 150) {
        lines.shift();
    }
    
    if (commonFooter && commonFooter.count > threshold && lines[lines.length - 1]?.trim() === commonFooter.value && commonFooter.value.length < 150) {
        lines.pop();
    }
    return lines.join('\n');
  }).join('\n\n--- Page Break ---\n\n');
};

const getMode = (arr: string[]): { value: string, count: number } | null => {
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
}

const parseDocx = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return convertHtmlToMarkdown(result.value);
};

const convertHtmlToMarkdown = (html: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  let markdown = '';

  const processNode = (node: Node, context: { inTable?: boolean } = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      markdown += node.textContent?.replace(/\s+/g, ' ') || '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tagName = el.tagName.toLowerCase();

    switch (tagName) {
      case 'h1': markdown += '\n# '; break;
      case 'h2': markdown += '\n## '; break;
      case 'h3': markdown += '\n### '; break;
      case 'h4': markdown += '\n#### '; break;
      case 'p': markdown += '\n\n'; break;
      case 'br': markdown += '\n'; break;
      case 'strong': case 'b': markdown += '**'; break;
      case 'em': case 'i': markdown += '_'; break;
      case 'table': markdown += '\n\n'; break;
      case 'ul': markdown += '\n'; break;
      case 'li': markdown += '\n- '; break;
      case 'img':
        // FIXED: Handle embedded images in DOCX files
        const alt = el.getAttribute('alt') || 'embedded image';
        markdown += `\n\n> 📷 **[IMAGE: ${alt}]** - Image-only content, manual review may be required for critical findings\n\n`;
        return; // Don't process children for img tags
    }

    if (tagName === 'table') {
        const tbody = el.querySelector('tbody') || el;
        Array.from(tbody.children).forEach((row, rowIndex) => {
            if (row.tagName.toLowerCase() !== 'tr') return;
            markdown += '|';
            let colIndex = 0;
            Array.from(row.children).forEach((cell) => {
                const cellEl = cell as HTMLTableCellElement;
                markdown += ' ';
                cellEl.childNodes.forEach(child => processNode(child, { inTable: true }));
                markdown += ' |';
                colIndex++;
                const colspan = cellEl.colSpan;
                if (colspan > 1) {
                    for (let i = 1; i < colspan; i++) {
                        markdown += ' <Merged> |';
                        colIndex++;
                    }
                }
            });
            markdown += '\n';
            if (rowIndex === 0) markdown += '|' + ' --- |'.repeat(colIndex) + '\n';
        });
    } else {
        el.childNodes.forEach(child => processNode(child, context));
    }

    switch (tagName) {
        case 'h1': case 'h2': case 'h3': case 'h4': markdown += '\n'; break;
        case 'strong': case 'b': markdown += '**'; break;
        case 'em': case 'i': markdown += '_'; break;
        case 'table': markdown += '\n'; break;
    }
  };

  doc.body.childNodes.forEach(node => processNode(node));
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
};