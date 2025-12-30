# Deep Research: Medical Document Compression Pipeline

## Context

I'm building a **local-first medical records sanitizer** that processes 100-1000+ documents (PDFs, images via OCR) and generates LLM-optimized output. Currently outputting ~310KB markdown for 175 docs, but most of it is artifact noise.

### Current Stack

- **Runtime**: Browser (Vite + React)
- **ML**: `@huggingface/transformers` v3 (transformers.js)
- **Current model**: `Xenova/bert-base-NER` for PII detection
- **Architecture**: Effect-TS for functional error handling
- **Storage**: IndexedDB (Dexie) for local persistence

### The Problem

My output contains massive redundancy:

1. **Repeated headers** (patient name, DOB, MRN on every document)
2. **Hospital footers** (CLIA numbers, lab director names - same on every lab)
3. **Medication lists** (duplicated across 20+ progress notes verbatim)
4. **Empty template fields** (`T:----()HR:---RR:--BP:/`)
5. **Low-value documents** (malnutrition screenings, scheduling forms)

I want to combine two approaches:

|**Approach B: Two-Pass Structured Extraction**

- Pass 1: Extract structured data (labs, meds, diagnoses, imaging findings, vitals)
- Pass 2: Generate narrative summary from structured data
- Output: Small structured JSON + concise narrative

|**Approach C: Template Stripping + Delta Compression**

- Identify repeating templates (headers, footers, med lists)
- Store templates ONCE
- Each document stores only DELTA from template

---

## Questions for Research

### 1. Few-Shot Learning for Medical Extraction

I want to provide examples to guide extraction without over-correction. What's the best approach for:

a) **In-context learning with transformers.js**: Can I use few-shot prompting with models like `Xenova/flan-t5-base` or similar? What's the token limit constraint in browser?

b) **Example format**: What's the optimal format for medical extraction examples?

```shell
Example input: "WBC 12.6 H 3.5 - 11.0 x10E3/uL"
Example output: {"test": "WBC", "value": 12.6, "status": "high", "range": "3.5-11.0", "unit": "x10E3/uL"}
```

c) **Avoiding over-extraction vs under-extraction**: How do I balance catching all lab values without hallucinating data that isn't there?

### 2. Template Detection Algorithms

For identifying repeated boilerplate across documents:

a) **N-gram fingerprinting**: What's the optimal n-gram size for detecting hospital headers/footers (typically 3-10 lines)?

b) **MinHash / LSH**: Is this overkill for ~1000 docs, or is it necessary for performance?

c) **Adaptive template learning**: Can I detect templates dynamically without hardcoding patterns? (e.g., "if this exact text appears in >50% of documents, it's probably a template")

### 3. Semantic Similarity for Deduplication

Currently using SimHash (bag-of-words). Want to upgrade to semantic:

a) **Best embedding model for browser**: `all-MiniLM-L6-v2` vs `bge-small-en-v1.5` vs others? Need small size + medical domain awareness.

b) **Clustering algorithm**: For grouping similar documents (e.g., all Day 7 progress notes), is HDBSCAN feasible in browser, or should I use simpler k-means?

c) **Representative selection**: After clustering, how do I pick the "best" document from each cluster? Longest? Most complete? Highest medical content density?

### 4. Structured Data Schema Design

For the extracted structured data:

a) **Temporal normalization**: Lab values from same encounter should be grouped. What's the right granularity? (same hour? same day? same admission?)

b) **Trend detection**: For labs across multiple dates, what algorithm detects clinically meaningful trends vs noise?

c) **Medication reconciliation**: How do I merge 20 copies of the same med list while detecting actual changes (new med added, dose changed)?

### 5. Narrative Generation (Local)

For generating the summary from structured data:

a) **Best small model for summarization in browser**: Can `Xenova/flan-t5-small` or `Xenova/LaMini-Flan-T5-248M` run in browser with acceptable latency?

b) **Structured-to-narrative prompting**: What prompt template works best for converting JSON medical data to readable narrative?

c) **Chunking strategy**: If I have 50 extracted lab panels, how do I chunk them for summarization without losing continuity?

### 6. Quality Assurance

How do I ensure I'm not losing critical information?

a) **Completeness validation**: After compression, how do I verify all abnormal labs, all diagnoses, all procedures are preserved?

b) **Diff visualization**: Should I show user what was removed so they can verify?

c) **Confidence scoring**: How do I assign confidence to extracted data so user knows what might need manual review?

### 7. Performance Constraints

Running in browser with transformers.js:

a) **Memory limits**: What's the practical limit for model size + document processing in browser tab? (assuming 8GB RAM machine)

b) **WebGPU vs WASM**: Which backend should I prioritize? Is WebGPU reliable enough in 2025?

c) **Progressive processing**: For 1000 docs, should I process in batches with UI progress, or use Web Workers for background processing?

### 8. Architecture Questions

a) **Pipeline order**: Should I template-strip BEFORE or AFTER ML extraction?

b) **Caching strategy**: How do I cache extracted data so re-processing only handles new/changed documents?

c) **Fallback chain**: If ML extraction fails, what's the right fallback? (regex → ML → LLM summarization)

---

## Current Extraction Patterns (for reference)

Here's what I'm already extracting with regex:

### Labs

```typescript
const LAB_PATTERNS = {
  WBC: /WBC[:\s]*(\d+\.?\d*)/i,
  RBC: /RBC[:\s]*(\d+\.?\d*)/i,
  HGB: /(?:HGB|Hemoglobin)[:\s]*(\d+\.?\d*)/i,
  // ... 40+ more patterns
};
```

### Medications

```typescript
// Detecting: "gabapentin, 200 MG= 2 CAP, PO, BID"
// Output: {name: "gabapentin", dose: "200 MG", route: "PO", frequency: "BID"}
```

### Imaging Findings

```typescript
// Detecting: "IMPRESSION: Bilateral lower lobe atelectasis"
// Output: {modality: "CT", bodyPart: "chest", impression: "Bilateral lower lobe atelectasis"}
```

---

## Desired Output Format

**Input**: 175 medical documents (310KB total text)

**Output**:

```yaml
patient:
  id: "[REDACTED]"
  dob: "1994-12-03"

encounters:
  - date: "2025-10-23"
    type: "admission"
    duration_days: 14
    diagnoses:
      - "Metastatic adenopathy of unknown primary"
      - "Compression fracture T12"
      - "Intractable back pain"

labs:
  trends:
    - test: "WBC"
      values: [{date: "10/22", value: 12.6, status: "high"}, {date: "10/30", value: 10.2, status: "normal"}]
      trend: "decreasing"

medications:
  current:
    - name: "gabapentin"
      dose: "200 MG"
      frequency: "BID"
      started: "2025-10-23"
      indication: "neuropathic pain"

imaging:
  - date: "2025-10-23"
    type: "CT Chest"
    key_findings:
      - "Enlarged left supraclavicular lymph node"
      - "Bulky mediastinal adenopathy"

narrative: |
  30-year-old female admitted 10/23/2025 for evaluation of severe back pain
  and workup of diffuse adenopathy. CT imaging revealed extensive lymphadenopathy
  above and below diaphragm with concern for metastatic disease. Breast biopsy
  performed 10/30. Pain managed with hydromorphone and gabapentin.
  Discharged with oncology follow-up.
```

Target: **<50KB output** from 310KB input (85%+ reduction)

---

## Constraints

1. **Must run 100% locally** - no API calls, no cloud
2. **Browser-based** - must work in Chrome/Firefox/Edge
3. **No HIPAA violations** - all PII must be scrubbed before any output
4. **Graceful degradation** - if ML fails, fall back to regex
5. **User must be able to verify** - need some way to audit what was kept/removed

---

## What I Need

1. **Recommended architecture** for combining template stripping + structured extraction + narrative generation
2. **Specific model recommendations** that run well in browser via transformers.js
3. **Algorithm recommendations** for template detection and semantic clustering
4. **Example prompts/templates** for few-shot medical extraction
5. **Quality assurance strategy** to prevent losing critical clinical data
6. **Performance optimization tips** for processing 1000+ documents in browser

Please provide concrete, implementable recommendations rather than general guidance.
