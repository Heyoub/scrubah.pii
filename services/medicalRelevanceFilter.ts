/**
 * MEDICAL RELEVANCE FILTER - GARBAGE COLLECTION FOR DOCUMENTS
 *
 * Treats low-value documents like memory garbage:
 * - Reference counting for clinical value
 * - Mark-and-sweep for placeholder spam
 * - Generational GC (recent docs prioritized)
 * - Deterministic, testable, functional
 *
 * Uses Effect-TS for:
 * - Schema validation
 * - Error handling as values
 * - Composable pipelines
 * - Testability
 */

import { Effect, Schema as S, pipe } from "effect";
import { ProcessedFile } from "../types";

/**
 * RELEVANCE SCORE SCHEMA
 *
 * Like a memory block descriptor in GC
 */
export const RelevanceScoreSchema = S.Struct({
  score: pipe(S.Number, S.between(0, 100)),
  placeholderDensity: pipe(S.Number, S.between(0, 1)),
  medicalContentDensity: pipe(S.Number, S.between(0, 1)),
  clinicalReferences: S.Int, // Reference count (like GC!)
  hasOutcomes: S.Boolean,
  hasDiagnoses: S.Boolean,
  hasProcedures: S.Boolean,
  hasLabData: S.Boolean,
  hasMedications: S.Boolean,
  generation: pipe(S.Number, S.int(), S.greaterThanOrEqualTo(0)), // Like generational GC
  recommendation: S.Literal("keep", "demote", "discard"),
  reason: S.String,
});

export type RelevanceScore = S.Schema.Type<typeof RelevanceScoreSchema>;

/**
 * CLINICAL REFERENCE TABLE
 *
 * Medical terms that indicate actual clinical value.
 * Each category has a "weight" (like reference strength).
 */
const CLINICAL_REFERENCES = {
  // High-value references (weight: 3)
  DIAGNOSES: new Set([
    'diagnosis', 'diagnosed', 'condition', 'disease', 'syndrome',
    'disorder', 'infection', 'cancer', 'tumor', 'carcinoma',
    'hypertension', 'diabetes', 'asthma', 'copd', 'pneumonia',
    'fracture', 'stroke', 'infarction', 'failure', 'insufficiency',
    'sepsis', 'embolism', 'thrombosis', 'hemorrhage', 'ischemia'
  ]),

  // High-value references (weight: 3)
  PROCEDURES: new Set([
    'surgery', 'procedure', 'operation', 'biopsy', 'resection',
    'repair', 'replacement', 'transplant', 'catheterization',
    'endoscopy', 'colonoscopy', 'laparoscopy', 'arthroscopy',
    'imaging', 'scan', 'xray', 'mri', 'ct', 'ultrasound', 'pet'
  ]),

  // Critical references (weight: 5) - outcomes are most valuable!
  OUTCOMES: new Set([
    'improved', 'worsened', 'deteriorated', 'stable', 'resolved',
    'recovered', 'discharged', 'admitted', 'transferred',
    'deceased', 'expired', 'died', 'response', 'remission',
    'progression', 'relapse', 'recurrence', 'cure', 'palliation'
  ]),

  // Medium-value references (weight: 2)
  TREATMENTS: new Set([
    'treatment', 'therapy', 'medication', 'prescription', 'dose',
    'administered', 'infusion', 'injection', 'prescribed',
    'chemotherapy', 'radiation', 'immunotherapy', 'antibiotic',
    'antiviral', 'analgesic', 'steroid', 'insulin', 'warfarin'
  ]),

  // Medium-value references (weight: 2)
  LAB_VITALS: new Set([
    'hemoglobin', 'hematocrit', 'glucose', 'creatinine', 'bun',
    'sodium', 'potassium', 'chloride', 'calcium', 'magnesium',
    'blood pressure', 'heart rate', 'temperature', 'oxygen',
    'saturation', 'white blood cell', 'wbc', 'platelet', 'inr',
    'abnormal', 'elevated', 'decreased', 'low', 'high', 'critical'
  ]),

  // Medium-value references (weight: 2)
  CLINICAL_FINDINGS: new Set([
    'pain', 'symptom', 'complaint', 'finding', 'examination',
    'physical exam', 'auscultation', 'palpation', 'percussion',
    'edema', 'swelling', 'rash', 'lesion', 'mass', 'tenderness',
    'nausea', 'vomiting', 'diarrhea', 'constipation', 'dyspnea',
    'chest pain', 'abdominal pain', 'headache', 'fever', 'chills'
  ]),
};

/**
 * GARBAGE COLLECTION TARGETS
 *
 * Document types that are "garbage" (mostly PII, no clinical value)
 */
const GARBAGE_INDICATORS = new Set([
  // Pure PII documents
  'insurance card', 'insurance information', 'billing statement',
  'payment', 'invoice', 'receipt', 'claim form',

  // Administrative fluff
  'contact information', 'emergency contact', 'address',
  'registration form', 'consent form', 'authorization',
  'privacy notice', 'hipaa', 'patient rights',

  // Scheduling (no clinical value)
  'appointment reminder', 'missed appointment', 'cancellation',
  'reschedule', 'confirmation', 'appointment card',

  // Duplicates/copies
  'copy of', 'duplicate', 'fax cover', 'blank page'
]);

/**
 * REFERENCE COUNTING WEIGHTS
 *
 * Like GC reference strength - how much does each term matter?
 */
const REFERENCE_WEIGHTS = {
  DIAGNOSES: 3,
  PROCEDURES: 3,
  OUTCOMES: 5,      // Outcomes are most valuable!
  TREATMENTS: 2,
  LAB_VITALS: 2,
  CLINICAL_FINDINGS: 2
};

/**
 * PHASE 1: CALCULATE REFERENCE COUNT
 *
 * Count clinical references (like GC reference counting)
 */
const calculateReferenceCount = (text: string): Effect.Effect<number, never, never> => {
  return Effect.sync(() => {
    const lowerText = text.toLowerCase();
    let refCount = 0;

    // Count references by category with weights
    for (const [category, terms] of Object.entries(CLINICAL_REFERENCES)) {
      const weight = REFERENCE_WEIGHTS[category as keyof typeof REFERENCE_WEIGHTS];
      const matches = Array.from(terms).filter(term => lowerText.includes(term));
      refCount += matches.length * weight;
    }

    return refCount;
  });
};

/**
 * PHASE 2: MARK GARBAGE
 *
 * Identify documents that are garbage (low/no clinical value)
 */
const isGarbage = (
  text: string,
  filename: string
): Effect.Effect<boolean, never, never> => {
  return Effect.sync(() => {
    const lowerFilename = filename.toLowerCase();
    const lowerText = text.toLowerCase();

    // Check filename first (fast path)
    for (const indicator of GARBAGE_INDICATORS) {
      if (lowerFilename.includes(indicator)) {
        return true;
      }
    }

    // Check content (slower path)
    for (const indicator of GARBAGE_INDICATORS) {
      if (lowerText.includes(indicator)) {
        return true;
      }
    }

    return false;
  });
};

/**
 * PHASE 3: CALCULATE PLACEHOLDER DENSITY
 *
 * Like memory fragmentation - too many placeholders = fragmented content
 */
const calculatePlaceholderDensity = (text: string): Effect.Effect<number, never, never> => {
  return Effect.sync(() => {
    if (text.length === 0) return 1.0; // Empty = 100% garbage

    const placeholders = text.match(/\[[A-Z_]+_\d+\]/g) || [];
    const placeholderChars = placeholders.reduce((sum, p) => sum + p.length, 0);

    return placeholderChars / text.length;
  });
};

/**
 * PHASE 4: CALCULATE MEDICAL CONTENT DENSITY
 *
 * Percentage of text that is actual medical content
 */
const calculateMedicalDensity = (
  text: string,
  refCount: number
): Effect.Effect<number, never, never> => {
  return Effect.sync(() => {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return 0;

    // Use reference count as proxy for medical word count
    // Each reference approximately equals 1-2 medical words
    const estimatedMedicalWords = refCount * 1.5;
    return Math.min(1.0, estimatedMedicalWords / words.length);
  });
};

/**
 * PHASE 5: DETECT SPECIFIC CLINICAL CONTENT
 *
 * Binary flags for key content types
 */
const detectClinicalContent = (text: string): Effect.Effect<{
  hasDiagnoses: boolean;
  hasProcedures: boolean;
  hasOutcomes: boolean;
  hasLabData: boolean;
  hasMedications: boolean;
}, never, never> => {
  return Effect.sync(() => {
    const lower = text.toLowerCase();

    return {
      hasDiagnoses: Array.from(CLINICAL_REFERENCES.DIAGNOSES).some(term => lower.includes(term)),
      hasProcedures: Array.from(CLINICAL_REFERENCES.PROCEDURES).some(term => lower.includes(term)),
      hasOutcomes: Array.from(CLINICAL_REFERENCES.OUTCOMES).some(term => lower.includes(term)),
      hasLabData: Array.from(CLINICAL_REFERENCES.LAB_VITALS).some(term => lower.includes(term)),
      hasMedications: Array.from(CLINICAL_REFERENCES.TREATMENTS).some(term => lower.includes(term))
    };
  });
};

/**
 * PHASE 6: GENERATIONAL CLASSIFICATION
 *
 * Like generational GC - recent docs in "young generation"
 * Recent docs are more likely to be relevant (recency bias)
 */
const calculateGeneration = (
  filename: string,
  text: string
): Effect.Effect<number, never, never> => {
  return Effect.sync(() => {
    // Try to extract date from filename
    const datePattern = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/;
    const match = filename.match(datePattern);

    if (match) {
      try {
        const dateStr = match[1];
        const parts = dateStr.split(/[-\/]/);
        const year = parts[2].length === 2 ? 2000 + parseInt(parts[2]) : parseInt(parts[2]);
        const currentYear = new Date().getFullYear();

        // Generation = years old
        // 0 = this year (young generation)
        // 1 = last year
        // 2+ = old generation
        return Math.max(0, currentYear - year);
      } catch {
        return 2; // Unknown = old generation
      }
    }

    return 2; // No date = old generation
  });
};

/**
 * MAIN SCORING FUNCTION - EFFECT PIPELINE
 *
 * Composes all phases using Effect
 */
export const calculateRelevanceScore = (
  scrubbedText: string,
  filename: string
): Effect.Effect<RelevanceScore, never, never> => {
  return Effect.gen(function* (_) {
    // Phase 1: Reference counting
    const refCount = yield* _(calculateReferenceCount(scrubbedText));

    // Phase 2: Garbage detection
    const garbage = yield* _(isGarbage(scrubbedText, filename));

    // Phase 3: Placeholder density (fragmentation)
    const placeholderDensity = yield* _(calculatePlaceholderDensity(scrubbedText));

    // Phase 4: Medical content density
    const medicalContentDensity = yield* _(calculateMedicalDensity(scrubbedText, refCount));

    // Phase 5: Clinical content flags
    const clinicalContent = yield* _(detectClinicalContent(scrubbedText));

    // Phase 6: Generation (recency)
    const generation = yield* _(calculateGeneration(filename, scrubbedText));

    // SCORING ALGORITHM (like GC marking)
    let score = 50; // Start at middle

    // Penalty: High placeholder density (fragmented = bad)
    if (placeholderDensity > 0.6) score -= 40;
    else if (placeholderDensity > 0.4) score -= 25;
    else if (placeholderDensity > 0.2) score -= 10;

    // Bonus: Medical content density
    score += medicalContentDensity * 50;

    // Bonus: Reference count (more references = more valuable)
    score += Math.min(30, refCount * 2); // Cap at 30 bonus points

    // Bonus: Specific content types
    if (clinicalContent.hasDiagnoses) score += 10;
    if (clinicalContent.hasProcedures) score += 10;
    if (clinicalContent.hasOutcomes) score += 15; // Outcomes most valuable!
    if (clinicalContent.hasLabData) score += 8;
    if (clinicalContent.hasMedications) score += 7;

    // Penalty: Garbage document
    if (garbage) score -= 50;

    // Bonus: Young generation (recent docs)
    if (generation === 0) score += 10;
    else if (generation === 1) score += 5;
    // Old generation (2+) gets no bonus

    // Normalize to 0-100
    score = Math.max(0, Math.min(100, score));

    // Recommendation based on score
    let recommendation: "keep" | "demote" | "discard";
    let reason: string;

    if (garbage) {
      recommendation = "discard";
      reason = "Document identified as administrative/billing (no clinical value)";
    } else if (score >= 60) {
      recommendation = "keep";
      reason = `High clinical value (score: ${score.toFixed(0)}/100)`;
    } else if (score >= 30) {
      recommendation = "demote";
      reason = `Moderate clinical value (score: ${score.toFixed(0)}/100)`;
    } else {
      recommendation = "discard";
      reason = `Low clinical value (score: ${score.toFixed(0)}/100, ${(placeholderDensity * 100).toFixed(0)}% placeholders)`;
    }

    return {
      score,
      placeholderDensity,
      medicalContentDensity,
      clinicalReferences: refCount,
      hasOutcomes: clinicalContent.hasOutcomes,
      hasDiagnoses: clinicalContent.hasDiagnoses,
      hasProcedures: clinicalContent.hasProcedures,
      hasLabData: clinicalContent.hasLabData,
      hasMedications: clinicalContent.hasMedications,
      generation,
      recommendation,
      reason
    };
  });
};

/**
 * GARBAGE COLLECTION - SWEEP PHASE
 *
 * Filter documents by relevance (like GC sweep)
 */
export const collectGarbage = (
  documents: ProcessedFile[],
  minScore: number = 30
): Effect.Effect<{
  kept: ProcessedFile[];
  demoted: ProcessedFile[];
  discarded: ProcessedFile[];
}, never, never> => {
  return Effect.gen(function* (_) {
    console.log('🗑️  Running garbage collection on documents...');

    const kept: ProcessedFile[] = [];
    const demoted: ProcessedFile[] = [];
    const discarded: ProcessedFile[] = [];

    for (const doc of documents) {
      if (!doc.scrubbedText) {
        discarded.push(doc);
        continue;
      }

      // Calculate relevance
      const relevance = yield* _(calculateRelevanceScore(doc.scrubbedText, doc.originalName));

      // Attach metadata
      (doc as any).relevanceScore = relevance;

      // Log details
      console.log(`📄 ${doc.originalName}:`);
      console.log(`   Score: ${relevance.score.toFixed(0)}/100`);
      console.log(`   Placeholders: ${(relevance.placeholderDensity * 100).toFixed(0)}%`);
      console.log(`   Medical: ${(relevance.medicalContentDensity * 100).toFixed(0)}%`);
      console.log(`   Refs: ${relevance.clinicalReferences} | Gen: ${relevance.generation}`);
      console.log(`   → ${relevance.recommendation.toUpperCase()}: ${relevance.reason}`);

      // Sort into buckets
      if (relevance.recommendation === 'keep') {
        kept.push(doc);
      } else if (relevance.recommendation === 'demote') {
        demoted.push(doc);
      } else {
        discarded.push(doc);
      }
    }

    console.log(`\n✅ GC Results:`);
    console.log(`   Kept: ${kept.length} (high value)`);
    console.log(`   Demoted: ${demoted.length} (low priority)`);
    console.log(`   Discarded: ${discarded.length} (garbage)`);
    console.log(`   Memory saved: ${discarded.length}/${documents.length} documents (${((discarded.length / documents.length) * 100).toFixed(0)}%)\n`);

    return { kept, demoted, discarded };
  });
};

/**
 * HELPER: Run GC synchronously
 */
export const runGarbageCollection = async (
  documents: ProcessedFile[],
  minScore: number = 30
) => {
  return Effect.runPromise(collectGarbage(documents, minScore));
};

/**
 * HELPER: Filter only high-value documents
 */
export const filterRelevantDocuments = async (
  documents: ProcessedFile[],
  minScore: number = 30
): Promise<ProcessedFile[]> => {
  const result = await runGarbageCollection(documents, minScore);
  return [...result.kept, ...result.demoted]; // Keep both high and medium value
};

/**
 * HELPER: Get only high-priority documents
 */
export const filterHighPriorityDocuments = async (
  documents: ProcessedFile[]
): Promise<ProcessedFile[]> => {
  const result = await runGarbageCollection(documents, 60); // Higher threshold
  return result.kept; // Only the best
};
