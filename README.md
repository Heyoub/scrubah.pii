# Scrubah.PII - Forensic Medical Data Sanitizer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.2-blue)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7.2-purple)](https://vitejs.dev/)
[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-scrubah--pii.heyoub.dev-brightgreen)](https://scrubah-pii.heyoub.dev)

|**Zero-Trust PII Scrubbing + Temporal Medical Record Compilation**

Sanitize medical documents locally in your browser. Generate LLM-optimized timelines with content-based deduplication, structured lab extraction, and chronological organization.

**🚀 [Try it Live](https://scrubah-pii.heyoub.dev)** • [Features](#-features) • [Quick Start](#-quick-start) • [Documentation](#-documentation)

---

## 🎯 What It Does

Scrubah.PII transforms messy medical records into clean, LLM-ready datasets:

1. **PII Scrubbing**: Removes names, dates, IDs, contact info using hybrid regex + ML approach
2. **Document Parsing**: Handles PDFs (including scanned/OCR), DOCX, images, text files
3. **Deduplication**: Content-based detection (not filename) with 95% similarity threshold
4. **Lab Extraction**: Converts prose lab reports → token-efficient markdown tables
5. **Timeline Generation**: Chronologically sorted medical history with cross-references
6. **100% Local**: All processing happens in-browser using WebAssembly ML models

**Perfect for**: Healthcare researchers, clinical data analysts, AI medical applications, HIPAA-compliant workflows

---

## ✨ Features

### 🔒 Privacy-First Architecture

- **No server uploads** - Everything runs locally via WASM
- **No API calls** - NER model runs in-browser
- **IndexedDB storage** - Data never leaves your machine
- **Open source** - Audit the code yourself

### 🧠 Hybrid PII Detection

- **Regex patterns**: Email, phone, SSN, credit cards, MRN (with context awareness)
- **ML entity recognition**: Names (PER), locations (LOC), organizations (ORG)
- **Confidence scoring**: 85%+ threshold to reduce false positives
- **Placeholder consistency**: Same entity → same placeholder across documents

### 📊 Intelligent Timeline Compilation

- **Content-based deduplication**: SHA-256 + SimHash for fuzzy matching
- **Date extraction**: From filenames and document content (date-fns)
- **Document classification**: Labs, imaging, progress notes, pathology, etc.
- **Structured lab data**: 30+ common tests extracted into tables
- **Trend analysis**: Automatic comparison of sequential lab values
- **Cross-referencing**: Links between related documents

### 🚀 Performance Optimized

- **Chunked processing**: 2000-char chunks for optimal ML inference
- **Progress logging**: Real-time console feedback
- **Background processing**: Non-blocking UI updates
- **Efficient tokenization**: 40% token reduction via table formatting

---

## 🏗️ Architecture

```shell
┌─────────────────────────────────────────────────────┐
│                   Browser (Client)                   │
├─────────────────────────────────────────────────────┤
│  React UI  →  File Upload  →  Processing Pipeline   │
│     ↓              ↓                    ↓            │
│  Parser    →  PII Scrubber  →  Timeline Generator   │
│  (PDF.js)     (Transformers.js)   (Content Hasher)  │
│     ↓              ↓                    ↓            │
│  Dexie     →   IndexedDB    →    Markdown Export    │
└─────────────────────────────────────────────────────┘
```

**Stack:**

- **Frontend**: React 18 + TypeScript 5.9 + Vite 7.2
- **Parsing**: PDF.js (digital + OCR), Mammoth (DOCX), Tesseract.js (images)
- **ML**: Hugging Face Transformers.js (Xenova/bert-base-NER, quantized)
- **Storage**: Dexie (IndexedDB wrapper)
- **Utilities**: date-fns, clsx, tailwind-merge, JSZip
- **Testing**: Vitest + React Testing Library

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (for dev server)
- **Modern browser** with WASM support (Chrome 91+, Firefox 89+, Safari 15+)

### Installation

```bash
# Clone the repository
git clone https://github.com/Heyoub/scrubah-pii.git
cd scrubah-pii

# Install dependencies
npm install

# Start development server
npm start
```

Open <http://localhost:3501/> (or check console for port)

### Basic Usage

1. **Upload Documents**: Drag & drop PDFs, DOCX, or images
2. **Wait for Processing**: PII detection runs automatically
3. **Download Options**:
   - **Individual Files**: Click download icon per file
   - **Zip Bundle**: Download all processed files
   - **Master Timeline**: Generate chronological medical record

### Timeline Generation

```mermaid
Upload 142 medical PDFs
  ↓
Wait for green checkmarks (all processed)
  ↓
Click "Generate Timeline" button
  ↓
Downloads: Medical_Timeline_YYYY-MM-DD.md
  ↓
Feed to Claude/GPT-4 for analysis
```

**Example Timeline Output:**

```markdown
# 🏥 Medical Record Timeline

## 📊 Summary
- Date Range: 2018-07-19 → 2025-11-20
- Total: 142 files (89 unique, 53 duplicates)
- Labs: 45 | Imaging: 18 | Progress Notes: 26

---

### 🧪 2025-10-22 | Lab Results
**Document #87** | Hash: `a3f9c2d1`

| Test | Value | Reference | Status |
|------|-------|-----------|--------|
| WBC  | 8.5   | 4.0-11.0  | ✅ Normal |
| HGB  | 13.2  | 13.5-17.5 | ⬇️ Low |

#### Trends vs Previous
- HGB: 14.1 → 13.2 (↓ -6.4%)

---

### [DUPLICATE] 2025-10-22 | Lab Results (1).pdf
⚠️ Exact duplicate of document #87. Content omitted.
```

---

## 📚 Documentation

- **[Timeline Usage Guide](TIMELINE_USAGE.md)** - How to use the timeline feature
- **[Timeline Implementation Guide](TIMELINE_IMPLEMENTATION_GUIDE.md)** - Technical deep dive
- **[API Documentation](#-api-documentation)** - Service interfaces (below)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Type checking
npm run build  # Runs tsc + vite build
```

**Test Coverage:**

- File Parser: PDF (digital + OCR), DOCX, images
- PII Scrubber: Regex patterns, ML inference, placeholder consistency
- Markdown Formatter: YAML frontmatter, artifact removal

---

## 🔧 Configuration

### Environment Variables

No environment variables required! Everything runs locally.

### Customization

**Add Custom Lab Tests** (`services/labExtractor.ts`):

```typescript
const LAB_TEST_PATTERNS = {
  CUSTOM_TEST: /(?:Test Name).*?(\d+\.?\d*)\s*(?:unit)/i,
  // Add your patterns here
};
```

**Adjust Duplicate Threshold** (`services/contentHasher.ts`):

```typescript
if (similarity >= 0.95) {  // Change threshold here
  return { isDuplicate: true, ... };
}
```

**Modify ML Confidence** (`services/piiScrubber.ts`):

```typescript
const entities = output.filter(e => e.score > 0.85);  // Adjust here
```

---

## 📖 API Documentation

### Core Services

#### `parseFile(file: File): Promise<string>`

Parses various file formats into plain text.

**Supported Formats:**

- PDF (digital text + OCR for scanned pages)
- DOCX (with table support)
- Images (PNG, JPG, WEBP via Tesseract OCR)
- Text (TXT, CSV, MD, JSON)

#### `piiScrubber.scrub(text: string): Promise<ScrubResult>`

Removes PII using hybrid regex + ML approach.

**Returns:**

```typescript
interface ScrubResult {
  text: string;              // Scrubbed content
  replacements: PIIMap;      // Original → Placeholder mapping
  count: number;             // Total entities replaced
}
```

#### `buildMasterTimeline(files: ProcessedFile[]): Promise<MasterTimeline>`

Generates chronological medical timeline with deduplication.

**Returns:**

```typescript
interface MasterTimeline {
  documents: TimelineDocument[];
  summary: TimelineSummary;
  markdown: string;
}
```

---

## 🎨 Tech Stack Details

### Why This Stack?

**React + TypeScript**: Type-safe UI development with excellent developer experience

**Vite**: Lightning-fast HMR, optimized production builds, native ESM support

**Transformers.js**: Run Hugging Face models in-browser via WASM (no server needed)

**PDF.js**: Mozilla's battle-tested PDF renderer, handles both digital and scanned PDFs

**Dexie**: Best-in-class IndexedDB wrapper with TypeScript support

**date-fns**: Lightweight (13KB gzipped), tree-shakeable, comprehensive date utilities

---

## 🤝 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style (TypeScript strict mode)
- Add tests for new features
- Update documentation
- Run `npm run build` before committing (type checks)

---

## 📊 Performance

**Timeline Generation** (tested on i7 + 3GB VRAM):

- 10 documents: ~100-200ms
- 50 documents: ~300-500ms
- 100 documents: ~500-800ms
- 200+ documents: ~1-2s

**PII Scrubbing** (per document):

- Small (< 5 pages): ~2-5s
- Medium (5-20 pages): ~5-15s
- Large (20+ pages): ~15-30s

**Token Efficiency:**

- Individual files: ~213,000 tokens (142 files)
- Master timeline: ~130,000 tokens (40% reduction!)

---

## 🛡️ Security & Privacy

### Local-First Architecture

- **No server uploads**: All processing happens in-browser
- **No external APIs**: ML models run via WASM
- **No telemetry**: Zero tracking or analytics
- **Open source**: Fully auditable code

### HIPAA Considerations

While Scrubah.PII runs locally and maintains privacy, it is provided **as-is** without warranty. Healthcare organizations must:

- Conduct their own security audit
- Implement appropriate safeguards per HIPAA requirements
- Test thoroughly before production use
- Consult legal counsel for compliance

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

Built by [@Heyoub](https://github.com/Heyoub) for [@forgestack](https://forgestack.app)

**Libraries:**

- [Transformers.js](https://github.com/xenova/transformers.js) - Hugging Face models in browser
- [PDF.js](https://github.com/mozilla/pdf.js) - Mozilla PDF renderer
- [Tesseract.js](https://github.com/naptha/tesseract.js) - OCR engine
- [date-fns](https://github.com/date-fns/date-fns) - Modern date utilities
- [Dexie](https://github.com/dfahlander/Dexie.js) - IndexedDB wrapper

---

## 📞 Contact

- **Author**: [@Heyoub](https://github.com/Heyoub)
- **Email**: <hello@forgestack.app>
- **Issues**: [GitHub Issues](https://github.com/Heyoub/scrubah-pii/issues)

---

|**Built with 🧠 for optimal LLM consumption**|

© 2024 Forgestack.app
