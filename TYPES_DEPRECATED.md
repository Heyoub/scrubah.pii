# types.ts Has Been Deprecated

**As of Phase 4.1 (November 2025)**, the `types.ts` file has been deleted.

## Why?

- **Single Source of Truth**: All types are now in `schemas.ts` with runtime validation via Effect Schema
- **Type Safety**: Effect schemas prevent invalid states at runtime, not just compile-time
- **Duplication**: `types.ts` duplicated types that were already defined in `schemas.ts`

## Migration Guide

### Old (types.ts)
```typescript
import { ProcessedFile, ProcessingStage, ScrubResult, PIIMap } from './types';
```

### New (schemas.ts)
```typescript
import { ProcessedFile, ProcessingStage, ScrubResult, PIIMap } from './schemas';
```

## Available Types in schemas.ts

All 30+ types are exported from `schemas.ts`:
- `ProcessedFile` - File processing state with validation
- `ProcessingStage` - Enum for processing pipeline stages
- `ScrubResult` - PII scrubbing results with ScrubbedText branding
- `PIIMap` - Original → Replacement mapping
- `DocumentFingerprint` - Content hashing for deduplication
- `LabPanel`, `LabResult` - Lab result extraction
- `TimelineDocument`, `MasterTimeline` - Timeline organization
- `AuditEntry`, `AuditReport` - Audit trail
- And 20+ more...

## Runtime Validation

Unlike `types.ts`, `schemas.ts` provides **runtime validation**:

```typescript
import { ProcessedFileSchema, decodeProcessedFile } from './schemas';

// Runtime validation with Effect
const validatedFile = decodeProcessedFile(untrustedData);
// Returns Effect<ProcessedFile, ParseError, never>
```

## See Also

- `schemas.ts` - All type definitions with runtime validation
- `ARCHITECTURE.md` - Effect-TS architecture documentation
- `IMPLEMENTATION_PLAN.md` - Migration history
