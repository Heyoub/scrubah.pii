# Architecture Documentation

**Scrubah.PII** - HIPAA-compliant medical document processing with Effect-TS

Last Updated: November 2025 (Compression Pipeline Complete - 229 tests)

---

## Table of Contents

1. [Philosophy & Design Principles](#philosophy--design-principles)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Type System & Validation](#type-system--validation)
5. [Error Handling](#error-handling)
6. [Service Layer Architecture](#service-layer-architecture)
7. [PHI Safety & Branded Types](#phi-safety--branded-types)
8. [Testing Strategy](#testing-strategy)
9. [Adding New Features](#adding-new-features)
10. [Migration Patterns](#migration-patterns)

---

## Philosophy & Design Principles

### 0. **Triple-Pipeline Architecture**

Scrubah.PII uses three complementary pipelines:

**Pipeline 1: Blacklist (PII Scrubbing)** - `services/piiScrubber.effect.ts`
- **Approach**: Detect and remove PII using patterns + ML
- **Method**: Regex (EMAIL, PHONE, SSN) + BERT NER (names, locations, orgs)
- **Output**: Scrubbed text with `[REDACTED]` placeholders
- **Risk**: Edge cases can slip through (e.g., concatenated text: "SMITH,JOHN01/15/1980")

**Pipeline 2: Whitelist (Clinical Extraction)** - `services/whitelist/`
- **Approach**: Extract only validated medical data
- **Method**: Structured parsing of lab values, diagnoses, medications, imaging findings
- **Output**: Clean JSON/markdown with only clinical terminology
- **Safety**: PII never enters extraction pipeline (safer by design)

**Pipeline 3: Compression (77% reduction)** - `services/compressionPipeline.effect.ts`
- **Approach**: Intelligent document compression for LLM context optimization
- **Stages**:
  1. OCR Quality Gate - Filter low-quality scans
  2. Template Detection - Strip boilerplate (81% compression)
  3. Semantic Deduplication - Remove similar documents
  4. Structured Extraction - Extract labs, meds, diagnoses, vitals
  5. Narrative Generation - Generate concise summaries (62% compression)
- **Output**: Compressed clinical narratives optimized for LLM consumption
- **Tests**: 229 comprehensive tests across all stages

**Why Three?**
- Blacklist: General-purpose scrubbing for unstructured text
- Whitelist: Safer for structured medical data where false negatives are unacceptable
- Compression: Context optimization for LLM workflows (77% token reduction)
- Combined: Defense-in-depth for HIPAA compliance + LLM efficiency

### 1. **Railway-Oriented Programming**

Errors are values, not exceptions. Every operation returns `Effect<Success, Error, Requirements>`.

```typescript
// ❌ OLD: Exceptions (hidden control flow)
function parseFile(path: string): string {
  if (!exists(path)) throw new Error("File not found");
  return readFile(path);
}

// ✅ NEW: Effect (explicit error types)
function parseFile(path: string): Effect<string, FileSystemError, never> {
  return Effect.gen(function* (_) {
    const exists = yield* _(checkFileExists(path));
    if (!exists) {
      return yield* _(Effect.fail(new FileSystemError({
        operation: "read",
        path,
        reason: "File not found",
        suggestion: "Check file path and permissions"
      })));
    }
    return yield* _(readFileEffect(path));
  });
}
```

### 2. **Single Source of Truth**

- **Types**: `schemas.ts` (Effect schemas with runtime validation)
- **Errors**: `services/errors.ts` (Data.TaggedError subclasses)
- **Runtime**: `services/runtime.ts` (Effect runtime configuration)

### 3. **Type Safety at Runtime**

Compile-time types + runtime validation = no invalid states.

```typescript
// Schema definition
export const ProcessedFileSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  size: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  stage: ProcessingStageSchema,
});

// Runtime validation
const file = decodeProcessedFile(untrustedData);
// Returns: Effect<ProcessedFile, ParseError, never>
```

### 4. **HIPAA Compliance by Design**

- **Branded Types**: `RawPHI` vs `ScrubbedText` (type-level safety)
- **Immutability**: All data structures are `readonly`
- **Audit Trail**: Every PII scrubbing operation is logged
- **Zero Trust**: All external data is validated before use

---

## Technology Stack

### Core Technologies

| Technology | Purpose | Why? |
| ---------- | ------- | ---- |
| **Effect-TS** | Functional effects system | Type-safe error handling, dependency injection |
| **Effect Schema** | Runtime validation | Prevents invalid states at runtime |
| **Transformers.js** | ML inference (BERT NER) | WASM-based PII detection, local processing |
| **TypeScript 5.x** | Type system | Compile-time safety + branded types |
| **Vitest** | Testing | Fast, modern test runner |
| **React 18** | UI framework | Component-based medical document viewer |

### WASM Components

- **ONNX Runtime**: 21MB `ort-wasm-simd-threaded.jsep.wasm`
- **BERT NER Model**: Xenova/bert-base-NER (local inference, no API calls)
- **SimHash**: Content fingerprinting for deduplication

---

## Project Structure

```shell
scrubah.pii/
├── schemas/
│   ├── index.ts                  # SINGLE SOURCE OF TRUTH - All types with runtime validation
│   ├── phi.ts                    # PHI branded types (RawPHI, ScrubbedText)
│   │
│   │   ┌──────────────────────────────────────────────────┐
│   │   │  PIPELINE 3: Compression Schemas                  │
│   │   └──────────────────────────────────────────────────┘
│   ├── ocrQuality.ts             # OCR quality gate schemas
│   ├── templateDetection.ts      # Template fingerprinting schemas
│   ├── semanticDedup.ts          # Semantic deduplication schemas
│   ├── structuredExtraction.ts   # Clinical data extraction schemas
│   ├── narrativeGeneration.ts    # Narrative output schemas
│   └── compressionPipeline.ts    # Unified pipeline schemas
│
├── services/
│   ├── errors.ts                 # All error types (Data.TaggedError)
│   ├── runtime.ts                # Effect runtime configuration
│   │
│   │   ┌──────────────────────────────────────────────────┐
│   │   │  PIPELINE 1: Blacklist (PII Scrubbing)           │
│   │   └──────────────────────────────────────────────────┘
│   ├── piiScrubber.effect.ts     # Regex + ML PII detection
│   ├── fileParser.effect.ts      # PDF/DOCX/Image parsing
│   ├── contentHasher.effect.ts   # Deduplication
│   ├── labExtractor.effect.ts    # Lab value extraction (legacy blacklist)
│   ├── markdownFormatter.effect.ts
│   ├── timelineOrganizer.effect.ts
│   │
│   │   ┌──────────────────────────────────────────────────┐
│   │   │  PIPELINE 2: Whitelist (Clinical Extraction)     │
│   │   └──────────────────────────────────────────────────┘
│   ├── whitelist/
│   │   ├── schemas/              # Whitelist-specific schemas
│   │   │   ├── medicalData.ts    # MedicalData, LabPanel, etc.
│   │   │   └── timeline.ts       # Timeline output schemas
│   │   └── services/
│   │       ├── medicalExtractor.effect.ts   # Extract structured medical data
│   │       ├── timelineFormatter.effect.ts  # Format PII-free timeline
│   │       └── extractionPipeline.effect.ts # Full whitelist pipeline
│   │
│   │   ┌──────────────────────────────────────────────────┐
│   │   │  PIPELINE 3: Compression Services (229 tests)    │
│   │   └──────────────────────────────────────────────────┘
│   ├── ocrQualityGate.effect.ts        # Filter low-quality scans (94 tests)
│   ├── templateDetection.effect.ts     # Strip boilerplate (49 tests)
│   ├── semanticDedup.effect.ts         # Remove similar docs (64 tests)
│   ├── structuredExtraction.effect.ts  # Extract clinical data (51 tests)
│   ├── narrativeGeneration.effect.ts   # Generate summaries (38 tests)
│   └── compressionPipeline.effect.ts   # Unified orchestration (27 tests)
│
├── components/                   # React UI components
├── test/
│   ├── schemas.test.ts           # Schema validation tests (51 tests)
│   ├── pii-leak.test.ts          # PII leak detection tests (36 tests)
│   ├── piiScrubber.integration.test.ts  # Blacklist integration tests
│   ├── whiteListExtractor.test.ts       # Whitelist extraction tests
│   │
│   │   ┌──────────────────────────────────────────────────┐
│   │   │  PIPELINE 3: Compression Tests (229 tests)       │
│   │   └──────────────────────────────────────────────────┘
│   ├── ocrQualityGate.test.ts          # OCR quality gate tests (94 tests)
│   ├── templateDetection.test.ts       # Template detection tests (49 tests)
│   ├── semanticDedup.test.ts           # Semantic dedup tests (64 tests)
│   ├── structuredExtraction.test.ts    # Extraction tests (51 tests)
│   ├── narrativeGeneration.test.ts     # Narrative tests (38 tests)
│   └── compressionPipeline.test.ts     # Unified pipeline tests (27 tests)
│
└── docs/
    ├── ARCHITECTURE.md           # This file
    ├── IMPLEMENTATION_PLAN.md    # Migration history
    ├── TYPES_DEPRECATED.md       # types.ts deprecation notice
    └── FUTURE_ENHANCEMENTS.md    # Potential improvements
```

---

## Type System & Validation

### Schemas.ts: The Contract

Every type in `schemas.ts` has three components:

1. **Schema Definition** (S.Struct)
2. **Type Export** (TypeScript type)
3. **Decoder/Encoder** (Runtime conversion)

```typescript
// 1. Schema with validation rules
export const LabResultSchema = S.Struct({
  testName: pipe(S.String, S.minLength(1)),
  value: S.String,
  status: S.optional(LabStatusSchema),
  referenceRange: S.optional(S.String),
  date: S.String,
});

// 2. TypeScript type (auto-generated)
export type LabResult = S.Schema.Type<typeof LabResultSchema>;

// 3. Decoder for runtime validation
export const decodeLabResult = (input: unknown): Effect<LabResult, ParseError, never> => {
  return S.decodeUnknown(LabResultSchema)(input);
};
```

### S.filter() - Business Logic Invariants

Effect schemas can enforce business rules at runtime:

```typescript
export const ScrubResultSchema = pipe(
  S.Struct({
    text: S.String,
    replacements: PIIMapSchema,
    count: S.Int,
  }),
  S.filter(
    (result) => result.count === Object.keys(result.replacements).length,
    {
      message: () => "Scrub count must match replacements map size",
    }
  )
);
```

**This prevents**:

- `count: 5` with only 2 replacements
- `count: 0` with non-empty replacements map
- Invalid audit trails

### Schema Testing

All schemas have comprehensive tests in `schemas.test.ts`:

```bash
pnpm test schemas.test.ts
# ✓ schemas.test.ts (51 tests) 41ms
```

Tests cover:

- Valid data passes
- Invalid data fails with correct error messages
- S.filter() invariants enforce business rules
- Decoders work correctly
- Edge cases (empty arrays, Unicode, very large numbers)

---

## Error Handling

### Error Types (services/errors.ts)

All errors extend `Data.TaggedError` for type-safe error handling:

```typescript
export class MLModelError extends Data.TaggedError("MLModelError")<{
  readonly modelName: string;
  readonly reason: string;
  readonly fallbackUsed: boolean;
  readonly suggestion: string;
}> {
  get message(): string {
    return `ML model ${this.modelName} failed: ${this.reason}`;
  }

  get recoverable(): boolean {
    return this.fallbackUsed; // Recoverable if regex fallback worked
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      modelName: this.modelName,
      reason: this.reason,
      fallbackUsed: this.fallbackUsed,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}
```

### Error Categories

| Error Type | Recoverable? | Use Case |
| ---------- | ------------ | -------- |
| `ValidationError` | ❌ No | Schema validation failed |
| `MLModelError` | ✅ Yes (if fallback used) | BERT NER inference failed |
| `PIIDetectionWarning` | ✅ Yes | Low confidence PII detection |
| `FingerprintError` | ✅ Yes | Content hashing failed (skip fingerprinting) |
| `LabExtractionError` | ✅ Yes | Lab parsing failed (show raw text) |
| `TimelineError` | ❌ No | Timeline generation failed (critical) |
| `PDFParseError` | ❌ No | PDF parsing failed (corrupt file) |
| `OCRError` | ✅ Yes | Low OCR confidence (manual review) |
| `FileSystemError` | ❌ No | File I/O failed |

### Error Handling Patterns

```typescript
// Pattern 1: Effect.catchAll (handle all errors)
const program = pipe(
  generateFingerprint(filename, text),
  Effect.catchAll((error) => {
    console.error("Fingerprinting failed:", error);
    return Effect.succeed(defaultFingerprint);
  })
);

// Pattern 2: Effect.catchTag (handle specific error)
const program = pipe(
  scrubPII(text),
  Effect.catchTag("MLModelError", (error) => {
    if (error.fallbackUsed) {
      console.warn("ML failed, using regex fallback");
      return Effect.succeed(error.fallbackResult);
    }
    return Effect.fail(error);
  })
);

// Pattern 3: ErrorCollector (accumulate non-fatal errors)
const errorCollector = new ErrorCollector();

for (const file of files) {
  const result = extractLabResults(file.text, file.date);
  if (result._tag === "Left") {
    errorCollector.add(result.left);
    // Continue processing other files
  }
}

if (errorCollector.hasUnrecoverableErrors()) {
  throw new Error("Fatal errors occurred");
}
```

---

## Service Layer Architecture

### Effect Services (.effect.ts)

New services follow Effect-TS patterns:

```typescript
/**
 * PII SCRUBBER - EFFECT VERSION
 *
 * Architecture:
 * - Effect<ScrubbedText, MLModelError | PIIDetectionWarning, never>
 * - Multi-pass validation (ML + regex)
 * - Confidence scoring (0-100)
 * - Audit trail logging
 */
export const scrubPII = (
  text: string
): Effect.Effect<ScrubResult, MLModelError | PIIDetectionWarning, never> => {
  return Effect.gen(function* (_) {
    // Pass 1: ML-based NER
    const mlResults = yield* _(runMLModel(text));

    // Pass 2: Regex patterns
    const regexResults = yield* _(runRegexPatterns(text));

    // Pass 3: Merge & deduplicate
    const merged = yield* _(mergeResults(mlResults, regexResults));

    // Pass 4: Confidence scoring
    const scored = yield* _(scoreConfidence(merged));

    // Pass 5: Generate audit trail
    yield* _(logAuditTrail(scored));

    return scored;
  });
};
```

### Legacy Services (.ts)

Legacy services are maintained for backward compatibility but should not be extended:

```typescript
// ❌ DO NOT: Add features to legacy services
export const scrubPII = async (text: string): Promise<ScrubResult> => {
  // Old promise-based code
};

// ✅ DO: Create .effect.ts version and use adapter
export const scrubPIISync = (text: string): ScrubResult => {
  return Effect.runSync(scrubPII(text));
};
```

### Service Dependencies

Services use **zero dependencies** - all logic is self-contained:

```typescript
// ✅ GOOD: Self-contained
export const generateFingerprint = (filename: string, text: string): Effect<...> => {
  const hash = createHash(text);
  const simhash = generateSimHash(text);
  const wordCount = text.split(/\s+/).length;
  // ...
};

// ❌ BAD: External service dependency
export const generateFingerprint = (
  filename: string,
  text: string,
  hashService: HashService  // Dependency injection adds complexity
): Effect<...> => {
  // ...
};
```

---

## PHI Safety & Branded Types

### The Problem

TypeScript can't prevent this at compile time:

```typescript
function sendToServer(data: string) { /* ... */ }

const patientName = "John Doe";  // Contains PHI!
sendToServer(patientName);       // ❌ HIPAA violation - no compile error
```

### The Solution: Branded Types

```typescript
// schemas/phi.ts
export type RawPHI = string & { readonly __brand: "RawPHI" };
export type ScrubbedText = string & { readonly __brand: "ScrubbedText" };

// Smart constructors
export const markAsPHI = (text: string): RawPHI => text as RawPHI;
export const markAsScrubbed = (text: string): ScrubbedText => text as ScrubbedText;

// Runtime check
export const mightContainPII = (text: string): boolean => {
  const piiPatterns = [
    /\b[A-Z][a-z]+ [A-Z][a-z]+\b/,  // Names
    /\d{3}-\d{2}-\d{4}/,             // SSN
    /\d{3}[-.]?\d{3}[-.]?\d{4}/,    // Phone
    // ...
  ];
  return piiPatterns.some(p => p.test(text));
};
```

### Usage

```typescript
// ✅ SAFE: Type system enforces scrubbing
function processFile(rawText: RawPHI): Effect<ProcessedFile, MLModelError, never> {
  return Effect.gen(function* (_) {
    const scrubbed = yield* _(scrubPII(rawText));  // Returns ScrubbedText
    const markdown = yield* _(formatToMarkdown(scrubbed));  // Requires ScrubbedText
    return { markdown };
  });
}

// ❌ UNSAFE: Won't compile
function sendToAPI(data: ScrubbedText) { /* ... */ }
const rawPHI: RawPHI = markAsPHI("John Doe, SSN: 123-45-6789");
sendToAPI(rawPHI);  // ❌ Type error: RawPHI is not assignable to ScrubbedText
```

### HIPAA Compliance Checklist

- [x] All PHI is marked with `RawPHI` type
- [x] All scrubbed text is marked with `ScrubbedText` type
- [x] Functions that handle PHI explicitly declare it in signature
- [x] No PHI can be sent to external APIs without scrubbing (type-checked)
- [x] Audit trail logs all PII scrubbing operations
- [x] Runtime validation prevents invalid scrub results (S.filter)

---

## Testing Strategy

### Test Hierarchy

```shell
├── Unit Tests                    # Pure function tests
│   ├── schemas.test.ts          # 51 tests - Schema validation
│   └── services/*.test.ts       # Service-specific tests
│
├── Integration Tests             # Effect pipeline tests
│   └── pii-leak.test.ts         # 36 tests - PII leak detection
│
└── E2E Tests                     # Full workflow tests
    └── app.e2e.test.ts          # (Future) Full document processing
```

### PII Leak Tests (CRITICAL)

36 comprehensive tests covering:

1. **Basic Patterns**: Names, SSN, phone, email, addresses, DOB, MRN
2. **Edge Cases**: Middle initials, hyphenated names, suffixes, international formats
3. **OCR Artifacts**: Scanning errors, character substitutions, extra spaces
4. **Multi-Pass Validation**: Idempotency, placeholder format
5. **False Negatives**: Lowercase names, partial SSN, account numbers
6. **Medical Context**: Keep medical terms, scrub patient/physician names
7. **Real-World Scenarios**: Discharge summaries, SOAP notes, lab reports
8. **Regression Tests**: Known past bugs

```bash
pnpm test pii-leak.test.ts
# Note: Requires browser environment for ML model
# In Node.js, tests document expected behavior but can't execute
```

### Running Tests

```bash
# All tests
pnpm test

# Specific test file
pnpm test schemas.test.ts

# Watch mode
pnpm run test:watch

# Coverage
pnpm run test:coverage
```

---

## Adding New Features

### Step-by-Step Guide

#### 1. Define Schema (schemas.ts)

```typescript
// Add to schemas.ts
export const NewFeatureSchema = pipe(
  S.Struct({
    id: pipe(S.String, S.minLength(1)),
    value: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  }),
  S.filter(
    (feature) => feature.value > 0 || feature.id.startsWith("optional-"),
    {
      message: () => "Value must be positive unless ID starts with 'optional-'",
    }
  )
);

export type NewFeature = S.Schema.Type<typeof NewFeatureSchema>;

export const decodeNewFeature = (input: unknown): Effect<NewFeature, ParseError, never> => {
  return S.decodeUnknown(NewFeatureSchema)(input);
};
```

#### 2. Define Errors (services/errors.ts)

```typescript
// Add to services/errors.ts
export class NewFeatureError extends Data.TaggedError("NewFeatureError")<{
  readonly reason: string;
  readonly suggestion: string;
}> {
  get message(): string {
    return `Feature failed: ${this.reason}`;
  }

  get recoverable(): boolean {
    return true;  // or false, depending on severity
  }

  toJSON() {
    return {
      _tag: this._tag,
      message: this.message,
      reason: this.reason,
      suggestion: this.suggestion,
      recoverable: this.recoverable,
      timestamp: new Date().toISOString(),
    };
  }
}

// Add to ServiceError union
export type ServiceError =
  | ValidationError
  | MLModelError
  // ... existing errors
  | NewFeatureError;  // Add here
```

#### 3. Create Effect Service (services/newFeature.effect.ts)

```typescript
/**
 * NEW FEATURE - EFFECT VERSION
 *
 * Purpose: [What this service does]
 *
 * Architecture:
 * - Effect<Result, NewFeatureError, never>
 * - [Key design decisions]
 *
 * OCaml equivalent:
 * module NewFeature : sig
 *   val process : input -> (result, error) result
 * end
 */

import { Effect, pipe } from "effect";
import { NewFeature, decodeNewFeature } from "../schemas";
import { NewFeatureError } from "./errors";

export const processNewFeature = (
  input: unknown
): Effect.Effect<NewFeature, NewFeatureError, never> => {
  return Effect.gen(function* (_) {
    // Step 1: Validate input
    const validated = yield* _(decodeNewFeature(input));

    // Step 2: Process
    const result = yield* _(doProcessing(validated));

    // Step 3: Return
    return result;
  });
};

// Helper functions (pure)
const doProcessing = (feature: NewFeature): Effect.Effect<NewFeature, NewFeatureError, never> => {
  // Implementation
  return Effect.succeed(feature);
};

// Sync wrapper for legacy code
export const processNewFeatureSync = (input: unknown): NewFeature => {
  return Effect.runSync(processNewFeature(input));
};
```

#### 4. Write Tests (services/newFeature.test.ts)

```typescript
import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { processNewFeature } from './newFeature.effect';

describe('NewFeature', () => {
  it('should process valid input', async () => {
    const input = { id: 'test-123', value: 42 };
    const result = await Effect.runPromise(processNewFeature(input));

    expect(result.id).toBe('test-123');
    expect(result.value).toBe(42);
  });

  it('should fail on invalid input', async () => {
    const input = { id: '', value: -1 };

    await expect(Effect.runPromise(processNewFeature(input))).rejects.toThrow();
  });
});
```

#### 5. Add to Runtime (if needed)

```typescript
// services/runtime.ts
export const NewFeatureLayer = Layer.succeed(
  NewFeatureService,
  NewFeatureService.Live
);
```

#### 6. Update ESLint Config (if needed)

```javascript
// eslint.config.js
{
  files: ['services/newFeature.effect.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',  // If needed for Effect types
  },
}
```

---

## Migration Patterns

### From Promise to Effect

```typescript
// ❌ OLD: Promise-based
async function scrubPII(text: string): Promise<ScrubResult> {
  try {
    const mlResults = await runMLModel(text);
    const regexResults = await runRegex(text);
    return merge(mlResults, regexResults);
  } catch (e) {
    throw new Error(`Scrubbing failed: ${e.message}`);
  }
}

// ✅ NEW: Effect-based
function scrubPII(text: string): Effect<ScrubResult, MLModelError, never> {
  return Effect.gen(function* (_) {
    const mlResults = yield* _(runMLModel(text));
    const regexResults = yield* _(runRegex(text));
    return yield* _(merge(mlResults, regexResults));
  });
}

// Backward compatibility wrapper
async function scrubPIILegacy(text: string): Promise<ScrubResult> {
  return Effect.runPromise(scrubPII(text));
}
```

### From Inline Types to Schemas

```typescript
// ❌ OLD: Inline interface
interface ProcessedFile {
  id: string;
  size: number;
  stage: string;
}

// ✅ NEW: Schema with validation
// In schemas.ts:
export const ProcessedFileSchema = S.Struct({
  id: pipe(S.String, S.minLength(1)),
  size: pipe(S.Int, S.greaterThanOrEqualTo(0)),
  stage: ProcessingStageSchema,
});
export type ProcessedFile = S.Schema.Type<typeof ProcessedFileSchema>;

// In service:
import { ProcessedFile, decodeProcessedFile } from '../schemas';
```

### From Throw to Effect.fail

```typescript
// ❌ OLD: Throw exceptions
function validateFile(file: File): void {
  if (file.size === 0) {
    throw new Error("File is empty");
  }
}

// ✅ NEW: Effect.fail with typed errors
function validateFile(file: File): Effect<void, ValidationError, never> {
  if (file.size === 0) {
    return Effect.fail(new ValidationError({
      message: "File is empty",
      context: { filename: file.name, size: file.size },
    }));
  }
  return Effect.succeed(undefined);
}
```

---

## Resources

### Official Documentation

- [Effect-TS](https://effect.website/) - Core library documentation
- [Effect Schema](https://effect.website/docs/schema/introduction) - Runtime validation
- [Transformers.js](https://huggingface.co/docs/transformers.js) - WASM ML inference

### Internal Documentation

- `IMPLEMENTATION_PLAN.md` - Full migration plan (Phases 1-5)
- `TYPES_DEPRECATED.md` - types.ts deprecation notice
- `FUTURE_ENHANCEMENTS.md` - Section-based PII scrubbing, other improvements

### Contact

For questions or contributions, see `README.md` for contribution guidelines.

---

**Last Updated**: November 2025 | **Architecture Version**: 3.0 (Compression Pipeline Complete - 229 tests)
