# Future Enhancements

This document tracks potential improvements and features that were considered but not yet implemented.

## 🔬 Section-Based PII Scrubbing (Deleted: Phase 4.4)

**Original file**: `services/documentStructureParser.ts` (removed as unused)

**Concept**: Variable scrubbing intensity based on document section type.

### The Idea

Medical documents have different PII density by section:
- **HIGH PII**: Demographics, Chief Complaint, History (patient narratives)
- **MEDIUM PII**: Physical Exam, Review of Systems (names/dates only)
- **LOW PII**: Vitals, Lab Results, Medications (structured data)

### Proposed Architecture (Effect-TS)

```typescript
// schemas.ts additions
export enum ScrubIntensity {
  HIGH = "high",    // Full ML + aggressive regex (confidence 0.75)
  MEDIUM = "medium", // Full ML + standard regex (confidence 0.85)
  LOW = "low"       // Regex only, skip ML (confidence 0.95)
}

export const DocumentSectionSchema = S.Struct({
  type: S.Literal(
    "demographics", "chief_complaint", "history",
    "physical_exam", "vitals", "lab_results",
    "medications", "assessment", "unknown"
  ),
  startIndex: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  endIndex: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  content: S.String,
  scrubIntensity: S.Enums(ScrubIntensity),
});

// services/documentStructureParser.effect.ts (NEW)
export const parseDocumentStructure = (
  text: string
): Effect.Effect<StructuredDocument, ParseError, never> => {
  // Regex-based section detection with fuzzy matching
  // Returns sections with appropriate scrubbing intensity
};

// services/piiScrubber.effect.ts (ENHANCED)
export const scrubWithContext = (
  structured: StructuredDocument
): Effect.Effect<ScrubResult, MLModelError, never> => {
  // Process each section with appropriate intensity
  // HIGH: Full BERT NER + aggressive patterns
  // MEDIUM: BERT NER + standard patterns
  // LOW: Regex only (performance optimization)
};
```

### Benefits

1. **Performance**: Skip ML inference on low-risk sections (vitals, labs)
2. **Accuracy**: Aggressive scrubbing in high-risk sections (narratives)
3. **Cost**: Reduce WASM inference calls by ~40% (most docs are 60% structured data)
4. **HIPAA**: Context-aware scrubbing = fewer leaks

### Why Not Implemented Yet?

- **Phase Priority**: Focused on core Effect-TS migration first
- **Testing Required**: Needs extensive validation against real medical records
- **PII Leak Fix**: Current leak investigation may reveal simpler root cause

### Pattern Matching Logic (Preserved from deleted file)

```typescript
const SECTION_PATTERNS = [
  // HIGH PII
  { pattern: /(?:PATIENT|PT\.?)\s+(?:NAME|INFORMATION)/i, intensity: 'high' },
  { pattern: /(?:CHIEF\s+COMPLAINT|CC)/i, intensity: 'high' },
  { pattern: /(?:HISTORY\s+OF\s+PRESENT\s+ILLNESS|HPI)/i, intensity: 'high' },

  // MEDIUM PII
  { pattern: /(?:PHYSICAL\s+EXAM|PE)/i, intensity: 'medium' },
  { pattern: /(?:REVIEW\s+OF\s+SYSTEMS|ROS)/i, intensity: 'medium' },

  // LOW PII
  { pattern: /(?:VITAL\s+SIGNS?|VITALS)/i, intensity: 'low' },
  { pattern: /(?:LAB\s+RESULTS?|LABS)/i, intensity: 'low' },
  { pattern: /(?:MEDICATIONS?)/i, intensity: 'low' },
];
```

### Implementation Checklist (When Ready)

- [ ] Add ScrubIntensity enum to schemas.ts
- [ ] Add DocumentSection schema with runtime validation
- [ ] Create services/documentStructureParser.effect.ts
- [ ] Enhance piiScrubber.effect.ts with section-aware scrubbing
- [ ] Write tests for section detection (fuzzy matching, OCR tolerance)
- [ ] Write tests for intensity-based scrubbing
- [ ] Benchmark performance improvement
- [ ] Validate HIPAA compliance with section-based approach
- [ ] Update ARCHITECTURE.md with pattern

---

## 📊 Other Potential Enhancements

### 1. WASM Performance Monitoring
Track BERT NER inference time per document for optimization.

### 2. Deduplication Tuning
Adjust SimHash similarity threshold based on document type.

### 3. Lab Result Trend Visualization
Generate charts from lab timeline data.

### 4. OCR Quality Scoring
Detect low-confidence OCR and flag for manual review.

### 5. Timeline Gap Analysis
Identify missing dates/documents in medical timeline.
