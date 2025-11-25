# Full Architecture Fix - Implementation Plan
**Goal:** Complete Effect-TS migration with schemas.ts as single source of truth
**Duration:** 2-3 weeks
**Status:** STARTING

---

## Why This Matters

> "problems with pii still leaking even with the good regular ts impl"

**Root Cause:** Plain TypeScript interfaces have no runtime validation. Invalid states can be constructed, PII can slip through.

**Effect-TS Solution:**
- Runtime validation at boundaries
- Impossible states made unrepresentable
- Type-safe error handling
- Algebraic effects for composition

---

## Phase 1: Consolidate Types into schemas.ts (Week 1, Days 1-3)

### Goal
Move ALL type definitions into schemas.ts as Effect schemas with runtime validation.

### Current State
- schemas.ts has: `ProcessedFile`, `ScrubResult`, `ProcessingStage`, `PIIMap`
- types.ts has: Duplicate definitions of above
- 15+ inline interfaces scattered across services

### Tasks

#### 1.1 Document Structure & Timeline Types → schemas.ts
**Files affected:**
- services/contentHasher.ts
- services/timelineOrganizer.ts
- services/timelineOrganizer.effect.ts

**New schemas to add:**
```typescript
// Document fingerprinting
export const DocumentTypeSchema = S.Literal(
  "lab_report", "imaging", "progress_note",
  "pathology", "medication", "discharge",
  "correspondence", "unknown"
);

export const DocumentFingerprintSchema = S.Struct({
  contentHash: S.String,
  simHash: S.String,
  wordCount: S.Int,
  dateReferences: S.Array(S.String),
  documentType: DocumentTypeSchema,
});

export const DuplicateAnalysisSchema = S.Struct({
  isDuplicate: S.Boolean,
  duplicateOf: S.optional(S.String),
  similarity: S.Number, // 0-1
  differenceType: S.Literal("exact", "near-duplicate", "same-event", "unique"),
});

// Timeline documents
export const TimelineDocumentSchema = S.Struct({
  id: S.String,
  filename: S.String,
  date: S.Date, // Will need custom codec
  displayDate: S.String,
  content: S.String,
  fingerprint: DocumentFingerprintSchema,
  duplicationInfo: S.optional(DuplicateAnalysisSchema),
  labData: S.optional(LabPanelSchema), // Define below
  documentNumber: S.Int,
});

export const TimelineSummarySchema = S.Struct({
  totalDocuments: S.Int,
  uniqueDocuments: S.Int,
  duplicates: S.Int,
  dateRange: S.Struct({
    earliest: S.String,
    latest: S.String,
  }),
  documentTypes: S.Record({ key: DocumentTypeSchema, value: S.Int }),
});

export const MasterTimelineSchema = S.Struct({
  documents: S.Array(TimelineDocumentSchema),
  summary: TimelineSummarySchema,
  markdown: S.String,
});
```

#### 1.2 Lab Extraction Types → schemas.ts
**Files affected:**
- services/labExtractor.ts

**New schemas:**
```typescript
export const LabResultSchema = S.Struct({
  test: S.String,
  value: S.String,
  unit: S.optional(S.String),
  referenceRange: S.optional(S.String),
  flag: S.optional(S.Literal("H", "L", "N", "A")), // High, Low, Normal, Abnormal
});

export const LabPanelSchema = S.Struct({
  panelName: S.String,
  date: S.optional(S.String),
  results: S.Array(LabResultSchema),
  rawText: S.String,
});
```

#### 1.3 Audit Types → schemas.ts
**Files affected:**
- services/auditCollector.ts

**New schemas:**
```typescript
export const AuditEntrySchema = S.Struct({
  timestamp: S.Number,
  phase: S.Literal("regex", "ml", "validation"),
  category: S.String,
  original: S.String,
  placeholder: S.String,
  confidence: S.Number,
  context: S.optional(S.String),
});

export const AuditSummarySchema = S.Struct({
  totalDetections: S.Int,
  byCategory: S.Record({ key: S.String, value: S.Int }),
  totalDurationMs: S.Number,
  confidenceScore: S.Number,
  startedAt: S.Number,
  completedAt: S.Number,
  piiDensityPercent: S.Number,
  piiCharactersRemoved: S.Int,
  sizeChangeBytes: S.Int,
  averagePiiLength: S.Number,
});

export const DocumentMetadataSchema = S.Struct({
  filename: S.optional(S.String),
  originalSizeBytes: S.Int,
  scrubbedSizeBytes: S.Int,
});

export const AuditReportSchema = S.Struct({
  summary: AuditSummarySchema,
  entries: S.Array(AuditEntrySchema),
  document: DocumentMetadataSchema,
});
```

#### 1.4 Document Structure Types → schemas.ts
**Files affected:**
- services/documentStructureParser.ts (will be deleted/rewritten)

**New schemas:**
```typescript
export const SectionTypeSchema = S.Literal(
  "demographics", "chief_complaint", "history",
  "social_history", "family_history", "physical_exam",
  "review_of_systems", "vitals", "lab_results",
  "medications", "assessment", "diagnoses", "unknown"
);

export const ScrubIntensitySchema = S.Literal("high", "medium", "low");

export const DocumentSectionSchema = S.Struct({
  type: SectionTypeSchema,
  startIndex: S.Int,
  endIndex: S.Int,
  content: S.String,
  scrubIntensity: ScrubIntensitySchema,
});

export const DocumentFormatSchema = S.Literal(
  "soap_note", "lab_report", "imaging_report",
  "discharge_summary", "unknown"
);

export const StructuredDocumentSchema = S.Struct({
  sections: S.Array(DocumentSectionSchema),
  documentType: DocumentFormatSchema,
});
```

#### 1.5 Worker Types → schemas.ts
**Files affected:**
- services/scrubberWorker.ts
- services/scrubber.worker.ts

**New schemas:**
```typescript
export const WorkerScrubOptionsSchema = S.Struct({
  filename: S.optional(S.String),
});

export const WorkerScrubResultSchema = S.Struct({
  text: S.String,
  replacements: PIIMapSchema,
  count: S.Int,
  auditReport: AuditReportSchema,
});
```

#### 1.6 Update schemas.ts Exports
Add decoders/encoders for all new schemas:
```typescript
export const decodeTimelineDocument = S.decodeUnknown(TimelineDocumentSchema);
export const decodeMasterTimeline = S.decodeUnknown(MasterTimelineSchema);
export const decodeLabPanel = S.decodeUnknown(LabPanelSchema);
export const decodeAuditReport = S.decodeUnknown(AuditReportSchema);
export const decodeDocumentSection = S.decodeUnknown(DocumentSectionSchema);
// ... etc
```

#### 1.7 Deprecate types.ts
Add deprecation notice:
```typescript
/**
 * @deprecated This file is deprecated. All types have been moved to schemas.ts
 *
 * Migration guide:
 * - import { ProcessedFile } from './types' → import { ProcessedFile } from './schemas'
 * - import { ScrubResult } from './types' → import { ScrubResult } from './schemas'
 *
 * This file will be deleted in Phase 4.
 */
```

---

## Phase 2: Create Missing Effect-TS Services (Week 1-2, Days 4-10)

### 2.1 contentHasher.effect.ts
**Dependencies:** None (pure functions + crypto API)
**Priority:** HIGH (used by timeline)

**Service interface:**
```typescript
export interface ContentHasherService {
  generateFingerprint(
    filename: string,
    text: string
  ): Effect.Effect<DocumentFingerprint, HashError, never>;

  analyzeDuplication(
    fp1: DocumentFingerprint,
    fp2: DocumentFingerprint,
    date1?: Date,
    date2?: Date
  ): Effect.Effect<DuplicateAnalysis, never, never>;
}
```

**Implementation notes:**
- Wrap crypto.subtle.digest in Effect
- Make SimHash generation pure Effect
- Add proper error types for hash failures

### 2.2 labExtractor.effect.ts
**Dependencies:** None (regex pattern matching)
**Priority:** MEDIUM

**Service interface:**
```typescript
export interface LabExtractorService {
  extractLabResults(text: string): Effect.Effect<LabPanel[], LabExtractionError, never>;
  formatLabTable(panel: LabPanel): Effect.Effect<string, never, never>;
  generateTrendAnalysis(
    current: LabPanel,
    previous: LabPanel
  ): Effect.Effect<string, never, never>;
}
```

### 2.3 markdownFormatter.effect.ts
**Dependencies:** schemas.ts (ProcessedFile, ScrubResult)
**Priority:** LOW (pure string formatting)

**Service interface:**
```typescript
export interface MarkdownFormatterService {
  formatToMarkdown(
    file: ProcessedFile,
    scrubResult: ScrubResult,
    processingTimeMs: number
  ): Effect.Effect<string, never, never>;
}
```

### 2.4 documentStructureParser.effect.ts
**Dependencies:** schemas.ts (DocumentSection, StructuredDocument)
**Priority:** HIGH (improves PII detection)

**Service interface:**
```typescript
export interface DocumentStructureService {
  parseStructure(text: string): Effect.Effect<StructuredDocument, ParseError, never>;
  getScrubConfig(section: DocumentSection): ScrubConfig;
}
```

**Integration with piiScrubber.effect.ts:**
```typescript
// Enhanced scrubPII with section awareness
export const scrubPII = (
  text: string,
  options?: { structured?: boolean }
): Effect.Effect<ScrubResult, AppError, MLModelService | DocumentStructureService> => {
  return Effect.gen(function* (_) {
    if (options?.structured) {
      const docStructure = yield* _(DocumentStructureService);
      const structured = yield* _(docStructure.parseStructure(text));

      // Scrub each section with appropriate intensity
      const scrubbedSections: string[] = [];
      for (const section of structured.sections) {
        const config = docStructure.getScrubConfig(section);
        const result = yield* _(
          scrubSection(section.content, config)
        );
        scrubbedSections.push(result.text);
      }

      return { text: scrubbedSections.join('\n'), /* ... */ };
    }

    // Original full scrubbing logic
    // ...
  });
};
```

### 2.5 auditCollector.effect.ts (Optional)
**Priority:** LOW (already works well)

Can stay as plain TypeScript for now, but use schemas from schemas.ts.

---

## Phase 3: Migrate Services to Use Schemas (Week 2, Days 7-10)

### 3.1 Update Existing Effect Services
**Files:**
- services/fileParser.effect.ts
- services/piiScrubber.effect.ts
- services/timelineOrganizer.effect.ts

**Changes:**
- Import all types from schemas.ts
- Remove duplicate interface definitions
- Add runtime validation at boundaries
- Use decoders for untrusted input

**Example (piiScrubber.effect.ts):**
```typescript
// Before
interface ScrubState {
  readonly text: string;
  readonly replacements: PIIMap;
  readonly counters: Record<string, number>;
}

// After - use schema
import { ScrubResultSchema, PIIMapSchema } from "../schemas";

// Remove inline interface, use schema validation
const validateScrubResult = (result: unknown) =>
  pipe(
    decodeScrubResult(result),
    Effect.mapError(error => new ValidationError({ /* ... */ }))
  );
```

### 3.2 Update Plain Services to Import from schemas.ts
**Files:**
- services/contentHasher.ts
- services/labExtractor.ts
- services/markdownFormatter.ts
- services/timelineOrganizer.ts (until Effect version ready)

**Changes:**
```typescript
// Before
export interface LabResult {
  test: string;
  value: string;
  // ...
}

// After
import { LabResult } from "../schemas";

// Remove duplicate definition
// Use schema type
```

### 3.3 Delete documentStructureParser.ts
Once documentStructureParser.effect.ts is complete:
```bash
git rm services/documentStructureParser.ts
```

---

## Phase 4: App.tsx Migration & CI Enforcement (Week 2-3, Days 11-15)

### 4.1 Create Effect Runtime Layer
**New file:** services/runtime.ts

```typescript
import { Layer } from "effect";
import { FileParserServiceLive } from "./fileParser.effect";
import { MLModelServiceLive } from "./piiScrubber.effect";
import { ContentHasherServiceLive } from "./contentHasher.effect";
import { LabExtractorServiceLive } from "./labExtractor.effect";
import { DocumentStructureServiceLive } from "./documentStructureParser.effect";

/**
 * Main application runtime layer
 * Provides all services needed for document processing
 */
export const AppLayer = Layer.mergeAll(
  FileParserServiceLive,
  MLModelServiceLive,
  ContentHasherServiceLive,
  LabExtractorServiceLive,
  DocumentStructureServiceLive
);

/**
 * Run an Effect program with full app context
 */
export const runApp = <A, E>(
  program: Effect.Effect<A, E, /* services */>
): Promise<A> => {
  return pipe(
    program,
    Effect.provide(AppLayer),
    Effect.runPromise
  );
};
```

### 4.2 Update App.tsx to Use Effect Services
**File:** App.tsx

**Before:**
```typescript
import { parseFile } from './services/fileParser';
import { piiScrubber } from './services/piiScrubber';

const rawText = await parseFile(rawFile);
const scrubResult = await piiScrubber.scrub(rawText);
```

**After:**
```typescript
import { Effect } from 'effect';
import { parseFile } from './services/fileParser.effect';
import { scrubPII } from './services/piiScrubber.effect';
import { runApp } from './services/runtime';

const program = Effect.gen(function* (_) {
  const parsed = yield* _(parseFile(rawFile));
  const scrubbed = yield* _(scrubPII(parsed.text, { structured: true }));
  return scrubbed;
});

const scrubResult = await runApp(program);
```

### 4.3 Add ESLint Rules
**New file:** .eslintrc.cjs (or update existing)

```javascript
module.exports = {
  rules: {
    // Enforce imports from schemas.ts
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['*/types'],
            message: 'Import from schemas.ts instead of types.ts'
          }
        ]
      }
    ],

    // No inline interfaces in services/
    '@typescript-eslint/no-restricted-syntax': [
      'error',
      {
        selector: 'TSInterfaceDeclaration[id.name!=/^Internal/]',
        message: 'Define types in schemas.ts, not inline. Use Effect schemas for runtime validation.'
      }
    ]
  }
};
```

### 4.4 Add Pre-commit Hook
**New file:** .husky/pre-commit (or update existing)

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Type check
npm run build --noEmit

# Ensure no imports from types.ts
if git diff --cached --name-only | grep -q '\.ts$'; then
  if git grep -l "from ['\"].*types['\"]" -- '*.ts' ':(exclude)types.ts'; then
    echo "ERROR: Found imports from types.ts. Use schemas.ts instead."
    exit 1
  fi
fi

# Lint schemas/
npm run lint:strict
```

### 4.5 Delete types.ts
After all migrations complete:
```bash
git rm types.ts
git commit -m "Delete deprecated types.ts - all types now in schemas.ts"
```

---

## Phase 5: Testing & Validation (Week 3, Days 11-15)

### 5.1 Schema Validation Tests
**New file:** services/schemas.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { decodeProcessedFile, decodeScrubResult, /* ... */ } from '../schemas';

describe('Schema Validation', () => {
  it('should reject invalid ProcessedFile', () => {
    const invalid = { id: '', originalName: 'test.pdf' }; // id too short
    expect(() => decodeProcessedFile(invalid)).toThrow();
  });

  it('should reject ScrubResult with mismatched count', () => {
    const invalid = {
      text: 'test',
      replacements: { 'foo': '[PER_1]', 'bar': '[PER_2]' },
      count: 5 // Should be 2!
    };
    expect(() => decodeScrubResult(invalid)).toThrow();
  });

  // Add tests for ALL schemas
});
```

### 5.2 Effect Service Integration Tests
Test that Effect services work together:

```typescript
import { Effect, pipe } from 'effect';
import { parseFile } from '../services/fileParser.effect';
import { scrubPII } from '../services/piiScrubber.effect';
import { buildMasterTimeline } from '../services/timelineOrganizer.effect';
import { AppLayer } from '../services/runtime';

describe('Effect Service Integration', () => {
  it('should process document end-to-end', async () => {
    const program = Effect.gen(function* (_) {
      const file = new File(['Patient: John Doe'], 'test.txt');
      const parsed = yield* _(parseFile(file));
      const scrubbed = yield* _(scrubPII(parsed.text));

      expect(scrubbed.text).toContain('[PER_');
      expect(scrubbed.text).not.toContain('John Doe');
    });

    await pipe(program, Effect.provide(AppLayer), Effect.runPromise);
  });
});
```

### 5.3 PII Leak Tests
**Critical:** Ensure PII doesn't leak with new runtime validation

```typescript
describe('PII Leak Prevention', () => {
  it('should reject scrubbed text that still contains PII', () => {
    const leaked = "Patient phone: 555-123-4567";

    // Schema validation should catch this
    expect(() => {
      const result = {
        text: markAsScrubbed(leaked), // This should fail
        replacements: {},
        count: 0
      };
      decodeScrubResult(result); // Runtime validation catches leak
    }).toThrow(/PII/);
  });

  it('should validate all placeholders are well-formed', () => {
    const invalid = "Patient: [PER_1] called [INVALID]";
    expect(() => assertScrubbed(invalid)).toThrow();
  });
});
```

### 5.4 Regression Tests
Run all existing tests to ensure nothing broke:
```bash
npm test
npm run test:coverage
```

### 5.5 Manual E2E Testing
1. Upload test document with known PII
2. Verify all PII is scrubbed
3. Download scrubbed version
4. Manually search for leaks (Ctrl+F for test names, dates, etc.)
5. Generate timeline from multiple documents
6. Verify deduplication works
7. Check audit reports for accuracy

---

## Success Criteria

### Code Quality
- [ ] All types in schemas.ts with Effect schemas
- [ ] No duplicate interface definitions
- [ ] types.ts deleted
- [ ] All services have .effect.ts versions
- [ ] App.tsx uses Effect runtime
- [ ] ESLint enforces schema imports
- [ ] Pre-commit hooks prevent violations

### Functionality
- [ ] All existing features work
- [ ] No PII leaks (manual + automated tests)
- [ ] Runtime validation catches invalid states
- [ ] Error messages are helpful
- [ ] Performance is acceptable (within 20% of original)

### Testing
- [ ] 100% schema coverage (all schemas tested)
- [ ] Integration tests pass
- [ ] PII leak tests pass
- [ ] Regression tests pass
- [ ] E2E testing complete

### Documentation
- [ ] ARCHITECTURE.md created
- [ ] Migration guide for future developers
- [ ] Inline comments explain Effect patterns
- [ ] README updated with new architecture

---

## Timeline

### Week 1
- **Day 1-2:** Phase 1 (schemas consolidation)
- **Day 3:** Testing schemas, update existing services
- **Day 4-5:** Start Phase 2 (contentHasher.effect.ts, labExtractor.effect.ts)

### Week 2
- **Day 6-8:** Continue Phase 2 (documentStructureParser.effect.ts)
- **Day 9-10:** Phase 3 (migrate services to use schemas)
- **Day 11-12:** Phase 4 (App.tsx migration, CI setup)

### Week 3
- **Day 13-14:** Phase 5 (testing, validation)
- **Day 15:** Documentation, cleanup, final review

---

## Risk Mitigation

### Risk: Breaking changes during migration
**Mitigation:**
- Keep both plain and Effect versions during transition
- Feature flags for Effect services
- Gradual rollout (test → prod)

### Risk: Performance regression
**Mitigation:**
- Benchmark before/after
- Profile hot paths
- Optimize if >20% slower

### Risk: PII still leaks
**Mitigation:**
- Comprehensive PII leak test suite
- Manual review of scrubbed output
- Schema validation at ALL boundaries
- Runtime assertions in dev mode

### Risk: Effect-TS learning curve
**Mitigation:**
- Document patterns clearly
- Add inline comments
- Link to Effect-TS docs
- Pair programming if needed

---

## Next Steps

1. **Review this plan** - Any changes needed?
2. **Start Phase 1** - I'll begin consolidating types into schemas.ts
3. **Daily check-ins** - Review progress, adjust as needed
4. **Testing checkpoints** - Test after each phase

**Ready to start? I'll begin with Phase 1.1 - moving Timeline and Document types into schemas.ts.**
