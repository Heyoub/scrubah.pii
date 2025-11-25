# TypeScript Strict Mode with Effect-TS

## Overview

This codebase uses Effect-TS for functional error handling and dependency injection.
Due to TypeScript's type inference limitations with Effect's complex generic types,
we cannot enable `noImplicitAny: true` globally without causing compiler stack overflow.

## The Problem

When TypeScript tries to infer types through Effect's deep generic composition:

- `Effect<R, E, A>` (three type parameters)
- Service interfaces with Effect-returning methods
- Layer composition (`Layer.Layer<Out, Error, In>`)
- Generator-based `Effect.gen(function* (_) {...})`

...TypeScript's inference engine can enter infinite recursion, causing:

```yaml
RangeError: Maximum call stack size exceeded
    at getContextualTypeForObjectLiteralMethod
    at checkThisExpression
```

## Our Solution: Layered Strictness

Instead of uniform strictness, we use **layered enforcement**:

### Layer 1: STRICT - Domain Modules (HIPAA-Critical)

- `schemas/*.ts` - Data schemas and PHI types
- `types.ts` - Core type definitions

These modules have:

- `@typescript-eslint/no-explicit-any: error`
- `@typescript-eslint/no-unsafe-*: error`
- Zero tolerance for `any` leakage

### Layer 2: MODERATE - Service Boundaries

- `services/markdownFormatter.ts` - Final output
- Other non-Effect services

These modules have:

- `@typescript-eslint/no-explicit-any: error`
- Warnings for unsafe operations

### Layer 3: RELAXED - Effect Integration

- `services/*.effect.ts` - Effect-TS code
- `services/compression/*.ts` - Complex pipelines

These modules:

- Allow `any` where Effect types are involved
- Safety enforced via branded types and runtime validation

## How Safety is Maintained

### 1. Branded PHI Types (`schemas/phi.ts`)

```typescript
type RawPHI = string & { __brand: 'RawPHI' };
type ScrubbedText = string & { __brand: 'ScrubbedText' };
```

Compile-time tracking of PHI flow without complex inference.

### 2. Type Constructors

```typescript
function markAsRawPHI(text: string): RawPHI
function markAsScrubbed(text: string): ScrubbedText
function assertScrubbed(text: string): ScrubbedText  // throws if PII detected
```

Centralized points where PHI state changes.

### 3. Runtime Validation

- Effect Schema validation at boundaries
- `mightContainPII()` runtime checks
- Multi-pass scrub verification

### 4. ESLint Enforcement

See `eslint.config.js` for layer-specific rules.

## TSConfig Settings

```json
{
  "strict": false,
  "strictNullChecks": true,
  "strictFunctionTypes": true,
  "strictBindCallApply": true,
  "strictPropertyInitialization": true,
  "noImplicitAny": false,      // REQUIRED for Effect-TS
  "noImplicitThis": true
}
```

## Known Workarounds

### Factory Pattern (Avoid `this` in Effect)

```typescript
// BAD: Class with this + Effect.gen causes inference explosion
class Service {
  method = () => Effect.gen(this, function* (_) {...})
}

// GOOD: Factory function captures state in closure
function createService(): Service {
  let state = null;
  return {
    method: () => Effect.gen(function* (_) {
      // use `state` directly, no `this`
    })
  };
}
```

### Explicit Type Annotations

```typescript
// Pin types at boundaries to stop inference recursion
const effect: Effect.Effect<Output, Error, Deps> = Effect.gen(function* (_) {
  // ...
});
```

### Chunked Pipelines

```typescript
// BAD: One giant pipe expression
return input.pipe(step1, step2, step3, step4, step5);

// GOOD: Break into named chunks
const afterStep1 = step1(input);
const afterStep2 = step2(afterStep1);
return step3(afterStep2);
```

## References

- [Effect-TS tsconfig](https://github.com/Effect-TS/effect/blob/main/tsconfig.base.json)
- [TypeScript Issue #34933](https://github.com/microsoft/TypeScript/issues/34933) - Deep generic inference
- Effect Discord discussions on strict mode

## Verification

Run `npm run lint:strict` to verify HIPAA-critical modules have no `any` leakage.
Run `npm run build` to verify the full project compiles.
