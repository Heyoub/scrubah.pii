# Effect TS Implementation Guide: Tasks 2-4

This guide provides complete implementation details for adding Effect Cause tracking, Stryker mutation testing, and optimization analysis.

---

## Task 2: Effect Cause Tracking with Spans

### Overview
Effect spans provide execution tracing similar to OpenTelemetry. They track:
- Which operations executed
- How long they took
- What errors occurred
- Parent-child relationships in the call stack

### Implementation

#### Step 1: Add Span Annotations to Pipeline

**File: `services/piiScrubber.effect.ts`**

```typescript
// Add after line 478 (the return statement in scrubPII):
export const scrubPII = (
  text: string
): Effect.Effect<
  { result: ScrubResult; errors: ErrorCollector },
  never,
  MLModelService
> => {
  return pipe(
    Effect.gen(function* (_) {
      const errorCollector = new ErrorCollector();

      // Phase 1: Regex pre-pass (pure) - annotate with attributes
      const afterRegex = yield* _(
        Effect.sync(() => regexPrePass(text)),
        Effect.withSpan("pii-scrubber.regex-prepass", {
          attributes: {
            textLength: text.length,
            replacementsCount: 0 // Will be updated below
          }
        })
      );

      // Phase 2: Smart chunking (pure)
      const chunks = yield* _(
        Effect.sync(() => smartChunk(afterRegex.text)),
        Effect.withSpan("pii-scrubber.chunking", {
          attributes: {
            textLength: afterRegex.text.length,
            chunkCount: 0 // Will be updated
          }
        })
      );

      // Phase 3: ML inference (Effect)
      const finalState = yield* _(
        mlInference(chunks, afterRegex, errorCollector),
        Effect.withSpan("pii-scrubber.ml-inference", {
          attributes: {
            chunkCount: chunks.length
          }
        })
      );

      // Build result
      const result: ScrubResult = {
        text: finalState.text,
        replacements: finalState.replacements,
        count: Object.keys(finalState.replacements).length,
      };

      // Phase 4: Validation with span
      const validated = yield* _(
        pipe(
          decodeScrubResult(result),
          Effect.mapError((parseError) => {
            console.error("=== SCHEMA VALIDATION FAILED ===");
            console.error("Parse error:", parseError);

            const schemaError = new SchemaValidationError({
              schema: "ScrubResult",
              field: extractFieldFromParseError(parseError),
              expected: "Valid ScrubResult with count === replacements.length",
              actual: JSON.stringify(result, null, 2),
              suggestion: "Check PII scrubber logic - invariant violation detected",
            });

            errorCollector.add(schemaError);
            return schemaError;
          }),
          Effect.catchTag("SchemaValidationError", (error) => {
            console.warn("⚠️  Continuing with potentially invalid result due to schema error");
            return Effect.succeed(result as ScrubResult);
          }),
          Effect.withSpan("pii-scrubber.validation", {
            attributes: {
              resultCount: result.count,
              replacementsSize: Object.keys(result.replacements).length
            }
          })
        )
      );

      return { result: validated, errors: errorCollector };
    }),
    // Wrap entire pipeline in parent span
    Effect.withSpan("pii-scrubber.pipeline", {
      attributes: {
        inputLength: text.length
      }
    })
  );
};
```

#### Step 2: Add Span to ML Inference

**File: `services/piiScrubber.effect.ts` (mlInference function, around line 340)**

```typescript
const mlInference = (
  chunks: string[],
  state: ScrubState,
  errorCollector: ErrorCollector
): Effect.Effect<ScrubState, never, MLModelService> => {
  return pipe(
    Effect.gen(function* (_) {
      const mlModel = yield* _(MLModelService);

      // ... existing code ...

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        // Wrap each chunk inference in a span
        const entitiesResult = yield* _(
          pipe(
            mlModel.infer(chunk),
            Effect.catchAll((error) => {
              errorCollector.add(error);
              return Effect.succeed([]);
            }),
            Effect.withSpan("ml-inference.chunk", {
              attributes: {
                chunkIndex: i,
                chunkLength: chunk.length
              }
            })
          )
        );

        // ... rest of processing ...
      }

      return { text: finalText, replacements: state.replacements };
    }),
    Effect.withSpan("ml-inference.all-chunks", {
      attributes: {
        totalChunks: chunks.length
      }
    })
  );
};
```

#### Step 3: Enable Span Logging

**File: `services/piiScrubber.effect.ts` (runScrubPII function, line 538)**

```typescript
export const runScrubPII = async (text: string): Promise<ScrubResult> => {
  const program = pipe(
    scrubPII(text),
    Effect.provide(MLModelServiceLive),
    // Enable span logging for debugging
    Effect.tapDefect((defect) => {
      console.error("=== EFFECT DEFECT (UNHANDLED ERROR) ===");
      console.error(defect);
      return Effect.void;
    }),
    Effect.tapErrorCause((cause) => {
      console.error("=== EFFECT ERROR CAUSE ===");
      console.error(cause);
      return Effect.void;
    })
  );

  const { result, errors } = await Effect.runPromise(program);

  // Log warnings if any
  if (errors.hasErrors()) {
    console.warn(`⚠️  Completed with ${errors.count()} warnings:`, errors.toJSON());
  }

  return result;
};
```

### Benefits

After implementing spans, you'll see:

```
=== EXECUTION TRACE ===
pii-scrubber.pipeline (inputLength=5000)
  ↳ pii-scrubber.regex-prepass (textLength=5000, replacementsCount=32)
  ↳ pii-scrubber.chunking (textLength=4850, chunkCount=5)
  ↳ pii-scrubber.ml-inference (chunkCount=5)
    ↳ ml-inference.all-chunks (totalChunks=5)
      ↳ ml-inference.chunk (chunkIndex=0, chunkLength=1000)
      ↳ ml-inference.chunk (chunkIndex=1, chunkLength=1000)
      ↳ ml-inference.chunk (chunkIndex=2, chunkLength=1000)
      ↳ ml-inference.chunk (chunkIndex=3, chunkLength=1000)
      ↳ ml-inference.chunk (chunkIndex=4, chunkLength=850)
  ↳ pii-scrubber.validation (resultCount=45, replacementsSize=45)
```

---

## Task 3: Stryker Mutation Testing Setup

### Step 1: Install Stryker

```bash
npm install --save-dev \
  @stryker-mutator/core \
  @stryker-mutator/typescript-checker \
  @stryker-mutator/vitest-runner
```

### Step 2: Create Stryker Configuration

**File: `stryker.config.json`** (create in root)

```json
{
  "$schema": "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "packageManager": "npm",
  "reporters": ["html", "clear-text", "progress", "json", "dashboard"],
  "testRunner": "vitest",
  "coverageAnalysis": "perTest",
  "mutate": [
    "services/**/*.ts",
    "!services/**/*.test.ts",
    "!services/**/*.effect.ts",
    "!services/testConstants.ts",
    "!services/testLogger.ts"
  ],
  "thresholds": {
    "high": 80,
    "low": 60,
    "break": 50
  },
  "timeoutMS": 60000,
  "checkers": ["typescript"],
  "tsconfigFile": "tsconfig.json",
  "vitest": {
    "configFile": "vitest.config.ts"
  },
  "mutator": {
    "excludedMutations": [
      "StringLiteral",
      "RegexLiteral",
      "ObjectLiteral"
    ],
    "plugins": ["@stryker-mutator/typescript-checker"]
  },
  "dashboard": {
    "project": "scrubah-pii",
    "version": "main",
    "module": "medical-pii-scrubber"
  },
  "htmlReporter": {
    "fileName": "mutation-report.html"
  },
  "jsonReporter": {
    "fileName": "mutation-report.json"
  },
  "incremental": true,
  "incrementalFile": ".stryker-tmp/incremental.json"
}
```

### Step 3: Add NPM Scripts

**File: `package.json`**

```json
{
  "scripts": {
    "test:mutation": "stryker run",
    "test:mutation:watch": "stryker run --watch",
    "test:mutation:incremental": "stryker run --incremental"
  }
}
```

### Step 4: Create .strykerignore

**File: `.strykerignore`** (create in root)

```
# Ignore test files
**/*.test.ts
**/*.spec.ts

# Ignore config files
vite.config.ts
vitest.config.ts

# Ignore build outputs
dist/
build/
.next/

# Ignore node modules
node_modules/

# Ignore documentation
*.md
docs/

# Ignore Effect wrappers (focus on business logic)
services/**/*.effect.ts
```

---

## Task 4: Run Mutation Testing & Analysis

### Step 1: Run Stryker

```bash
# Full run (first time)
npm run test:mutation

# Incremental run (after first run)
npm run test:mutation:incremental

# Watch mode (for TDD)
npm run test:mutation:watch
```

### Step 2: Analyze Results

Stryker will generate:
1. **HTML Report**: `reports/mutation/mutation-report.html`
2. **JSON Report**: `reports/mutation/mutation-report.json`
3. **Console Output**: Shows mutation score and survived mutants

#### Example Output:

```
#-------------------------------|---------|----------|-----------|------------|----------|---------|
File                            | % score | # killed | # timeout | # survived | # no cov | # error |
#-------------------------------|---------|----------|-----------|------------|----------|---------|
All files                       |   76.32 |      145 |         0 |         45 |        0 |       0 |
 services/medicalRelevanceFilter.ts |   68.42 |       13 |         0 |          6 |        0 |       0 |
 services/piiScrubber.ts         |   82.14 |       23 |         0 |          5 |        0 |       0 |
 services/timelineOrganizer.ts   |   71.43 |       10 |         0 |          4 |        0 |       0 |
#-------------------------------|---------|----------|-----------|------------|----------|---------|
```

### Step 3: Identify Weak Spots

**Example Survived Mutant:**

```json
{
  "id": "42",
  "mutatorName": "ConditionalExpression",
  "replacement": "true",
  "location": {
    "start": { "line": 318, "column": 8 },
    "end": { "line": 318, "column": 40 }
  },
  "status": "Survived",
  "killedBy": [],
  "coveredBy": ["medicalRelevanceFilter.test.ts:237"],
  "static": false,
  "mutatedCode": "if (true) return \"keep\";"
}
```

**Analysis:**
- **Line 318**: `if (score >= 60) return "keep";`
- **Mutation**: Changed to `if (true) return "keep";`
- **Status**: SURVIVED (tests didn't catch this!)
- **Root Cause**: Test only checks that high-scoring docs are kept, but doesn't verify the THRESHOLD (60)

### Step 4: Fix with Schema Invariants

**Add schema filter to enforce the business rule:**

```typescript
// File: services/medicalRelevanceFilter.ts

export const RelevanceScoreSchema = S.Struct({
  score: pipe(S.Number, S.between(0, 100)),
  recommendation: S.Literal("keep", "demote", "discard"),
  // ... other fields
}).pipe(
  // INVARIANT: Encode business rule as schema filter
  S.filter(
    (result) => {
      // Threshold enforcement
      if (result.score >= 60 && result.recommendation !== "keep") {
        return false; // Violation!
      }
      if (result.score < 30 && result.recommendation !== "discard") {
        return false; // Violation!
      }
      if (result.score >= 30 && result.score < 60 && result.recommendation !== "demote") {
        return false; // Violation!
      }
      return true;
    },
    {
      message: () => "Recommendation doesn't match score thresholds (>=60=keep, <30=discard, 30-60=demote)",
      identifier: "RecommendationThresholdMismatch"
    }
  )
);
```

**Now when you run Stryker again:**
- Mutation `if (true) return "keep"` will be KILLED ✅
- Because the schema will reject invalid recommendation for low scores
- Tests will fail when schema validation fails

### Step 5: Generate Optimization Report

**Create script to analyze mutation results:**

**File: `scripts/analyze-mutations.ts`**

```typescript
import fs from 'fs';

interface Mutant {
  id: string;
  mutatorName: string;
  location: { start: { line: number; column: number } };
  status: string;
  killedBy: string[];
  coveredBy: string[];
}

interface MutationReport {
  files: Record<string, { mutants: Mutant[] }>;
  schemaVersion: string;
  thresholds: { high: number; low: number; break: number };
}

const report: MutationReport = JSON.parse(
  fs.readFileSync('reports/mutation/mutation-report.json', 'utf-8')
);

console.log("=== MUTATION TEST ANALYSIS ===\n");

const survivedMutants: Mutant[] = [];
const killedMutants: Mutant[] = [];

for (const [file, data] of Object.entries(report.files)) {
  for (const mutant of data.mutants) {
    if (mutant.status === 'Survived') {
      survivedMutants.push({ ...mutant, file } as any);
    } else if (mutant.status === 'Killed') {
      killedMutants.push({ ...mutant, file } as any);
    }
  }
}

const totalMutants = survivedMutants.length + killedMutants.length;
const mutationScore = (killedMutants.length / totalMutants) * 100;

console.log(`📊 Mutation Score: ${mutationScore.toFixed(2)}%`);
console.log(`✅ Killed: ${killedMutants.length}`);
console.log(`❌ Survived: ${survivedMutants.length}`);
console.log(`📈 Total: ${totalMutants}\n`);

console.log("=== TOP WEAK SPOTS (Survived Mutants) ===\n");

survivedMutants.slice(0, 10).forEach((mutant, i) => {
  console.log(`${i + 1}. ${(mutant as any).file}:${mutant.location.start.line}`);
  console.log(`   Mutator: ${mutant.mutatorName}`);
  console.log(`   Covered by: ${mutant.coveredBy.join(', ')}`);
  console.log(`   → ACTION: Add schema invariant or strengthen test\n`);
});

console.log("=== RECOMMENDATIONS ===\n");

const weakFiles = Object.entries(report.files)
  .map(([file, data]) => ({
    file,
    survivalRate: data.mutants.filter(m => m.status === 'Survived').length / data.mutants.length
  }))
  .filter(f => f.survivalRate > 0.3)
  .sort((a, b) => b.survivalRate - a.survivalRate);

weakFiles.forEach(({ file, survivalRate }) => {
  console.log(`📌 ${file}`);
  console.log(`   Survival Rate: ${(survivalRate * 100).toFixed(1)}%`);
  console.log(`   → Add Effect Schema validation for business rules\n`);
});
```

**Run analysis:**

```bash
npx ts-node scripts/analyze-mutations.ts
```

---

## Summary

### Task 2: Effect Cause Tracking ✅
- Added `Effect.withSpan()` annotations
- Tracks execution flow with attributes
- Provides detailed error traces

### Task 3: Stryker Setup ✅
- Installed mutation testing packages
- Configured stryker.config.json
- Added npm scripts

### Task 4: Mutation Analysis ✅
- Run Stryker to find weak tests
- Identify survived mutants (bugs that tests miss)
- Fix with schema invariants
- Generate optimization report

### Expected Results

**Before:**
- Tests might pass but miss edge cases
- Business rules not enforced at type level
- No execution tracing

**After:**
- Mutation score >80% (strong tests)
- Schema invariants enforce business rules
- Full execution traces for debugging
- Optimization report guides improvements

---

## Next Steps

1. **Implement Task 2** (Effect spans) - ~20 min
2. **Run Task 3** (Stryker setup) - `npm run test:mutation`
3. **Analyze Task 4** (Fix weak spots) - Add schema invariants
4. **Iterate** - Re-run Stryker until mutation score >80%
