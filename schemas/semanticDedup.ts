/**
 * SEMANTIC DEDUPLICATION SCHEMA
 *
 * Uses sentence embeddings to identify semantically similar documents
 * and deduplicate based on content meaning rather than exact text.
 *
 * Use Cases:
 * - 20 progress notes saying "Patient stable, continue current plan"
 * - Multiple lab reports with same abnormal findings
 * - Duplicate imaging reports from different systems
 *
 * Algorithm:
 * 1. Generate embeddings for each document (or chunks)
 * 2. Compute pairwise cosine similarity
 * 3. Cluster similar documents (hierarchical or DBSCAN-like)
 * 4. Select representative from each cluster (most complete/recent)
 * 5. Output: Representatives + references to duplicates
 */

import { Schema as S } from "effect";

// ============================================================================
// EMBEDDING CONFIGURATION
// ============================================================================

export const EmbeddingConfigSchema = S.Struct({
  // Model settings
  modelId: S.String, // e.g., "Xenova/all-MiniLM-L6-v2"
  maxSequenceLength: S.Int, // default 256 tokens
  poolingStrategy: S.Union(S.Literal("mean"), S.Literal("cls")),

  // Chunking (for long documents)
  chunkSize: S.Int, // characters per chunk
  chunkOverlap: S.Int, // overlap between chunks
  aggregateChunks: S.Union(
    S.Literal("mean"), // average all chunk embeddings
    S.Literal("first"), // use first chunk only
    S.Literal("max_pool") // max across dimensions
  ),

  // Similarity thresholds
  similarityThreshold: S.Number, // default 0.85 - docs above this are "similar"
  nearDuplicateThreshold: S.Number, // default 0.95 - docs above this are "duplicates"

  // Clustering
  minClusterSize: S.Int, // minimum docs to form a cluster
  maxClusterDistance: S.Number, // max distance within cluster
});
export type EmbeddingConfig = S.Schema.Type<typeof EmbeddingConfigSchema>;

export const defaultEmbeddingConfig: EmbeddingConfig = {
  modelId: "Xenova/all-MiniLM-L6-v2",
  maxSequenceLength: 256,
  poolingStrategy: "mean",
  chunkSize: 512,
  chunkOverlap: 50,
  aggregateChunks: "mean",
  similarityThreshold: 0.85,
  nearDuplicateThreshold: 0.95,
  minClusterSize: 2,
  maxClusterDistance: 0.15, // 1 - 0.85 similarity
};

// ============================================================================
// DOCUMENT EMBEDDING
// ============================================================================

export const DocumentEmbeddingSchema = S.Struct({
  documentId: S.String,
  embedding: S.Array(S.Number), // 384-dim for MiniLM
  embeddingDim: S.Int,

  // Chunk info (if document was chunked)
  chunkCount: S.Int,
  chunkEmbeddings: S.optional(S.Array(S.Array(S.Number))),

  // Metadata
  textLength: S.Int,
  processingTimeMs: S.Int,
});
export type DocumentEmbedding = S.Schema.Type<typeof DocumentEmbeddingSchema>;

// ============================================================================
// SIMILARITY PAIR
// ============================================================================

export const SimilarityPairSchema = S.Struct({
  docId1: S.String,
  docId2: S.String,
  similarity: S.Number, // 0-1 cosine similarity
  relationship: S.Union(
    S.Literal("DUPLICATE"), // >= nearDuplicateThreshold
    S.Literal("SIMILAR"), // >= similarityThreshold
    S.Literal("RELATED") // moderate similarity (0.7-0.85)
  ),
});
export type SimilarityPair = S.Schema.Type<typeof SimilarityPairSchema>;

// ============================================================================
// DOCUMENT CLUSTER
// ============================================================================

export const ClusterTypeSchema = S.Union(
  S.Literal("DUPLICATE_GROUP"), // near-identical documents
  S.Literal("SIMILAR_GROUP"), // semantically similar
  S.Literal("TOPIC_GROUP"), // same topic/category
  S.Literal("SINGLETON") // no similar documents
);
export type ClusterType = S.Schema.Type<typeof ClusterTypeSchema>;

export const DocumentClusterSchema = S.Struct({
  clusterId: S.String,
  type: ClusterTypeSchema,

  // Documents in this cluster
  documentIds: S.Array(S.String),
  documentCount: S.Int,

  // Representative (best document from cluster)
  representativeId: S.String,
  representativeScore: S.Number, // why this doc was chosen

  // Cluster statistics
  avgInternalSimilarity: S.Number,
  minInternalSimilarity: S.Number,
  centroid: S.optional(S.Array(S.Number)), // cluster center embedding

  // Metadata
  suggestedLabel: S.optional(S.String), // auto-generated cluster label
});
export type DocumentCluster = S.Schema.Type<typeof DocumentClusterSchema>;

// ============================================================================
// REPRESENTATIVE SELECTION CRITERIA
// ============================================================================

export const SelectionCriteriaSchema = S.Struct({
  // Weight factors (0-1, should sum to ~1)
  lengthWeight: S.Number, // prefer longer/more complete docs
  recencyWeight: S.Number, // prefer more recent docs
  qualityWeight: S.Number, // prefer higher OCR quality
  medicalDensityWeight: S.Number, // prefer docs with more medical terms

  // Tiebreakers
  preferOriginalOrder: S.Boolean, // on tie, prefer earlier doc
});
export type SelectionCriteria = S.Schema.Type<typeof SelectionCriteriaSchema>;

export const defaultSelectionCriteria: SelectionCriteria = {
  lengthWeight: 0.3,
  recencyWeight: 0.2,
  qualityWeight: 0.3,
  medicalDensityWeight: 0.2,
  preferOriginalOrder: true,
};

// ============================================================================
// DEDUPLICATION RESULT
// ============================================================================

export const DeduplicationResultSchema = S.Struct({
  // Clusters found
  clusters: S.Array(DocumentClusterSchema),
  totalClusters: S.Int,
  singletonCount: S.Int, // docs with no similar matches

  // Dedup statistics
  originalDocCount: S.Int,
  uniqueDocCount: S.Int, // representatives only
  duplicatesRemoved: S.Int,
  reductionRatio: S.Number, // 1 - (unique/original)

  // Similarity matrix (optional, for visualization)
  similarityPairs: S.optional(S.Array(SimilarityPairSchema)),

  // Processing metadata
  configUsed: EmbeddingConfigSchema,
  processingTimeMs: S.Int,
});
export type DeduplicationResult = S.Schema.Type<typeof DeduplicationResultSchema>;

// ============================================================================
// DOCUMENT METADATA (for representative selection)
// ============================================================================

export const DocumentMetadataSchema = S.Struct({
  documentId: S.String,
  charCount: S.Int,
  wordCount: S.Int,
  dateExtracted: S.optional(S.String), // ISO date if found
  ocrQualityScore: S.optional(S.Number), // from OCR quality gate
  medicalTermCount: S.Int,
  medicalTermDensity: S.Number, // terms per 100 words
});
export type DocumentMetadata = S.Schema.Type<typeof DocumentMetadataSchema>;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Cosine similarity between two vectors
 */
export const cosineSimilarity = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
};

/**
 * Euclidean distance between two vectors
 */
export const euclideanDistance = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
};

/**
 * Mean pooling of embeddings
 */
export const meanPool = (embeddings: readonly (readonly number[])[]): number[] => {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return [...embeddings[0]];

  const dim = embeddings[0].length;
  const result: number[] = new Array<number>(dim).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] += emb[i];
    }
  }

  for (let i = 0; i < dim; i++) {
    result[i] /= embeddings.length;
  }

  return result;
};

/**
 * Max pooling of embeddings
 */
export const maxPool = (embeddings: readonly (readonly number[])[]): number[] => {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return [...embeddings[0]];

  const dim = embeddings[0].length;
  const result: number[] = new Array<number>(dim).fill(-Infinity);

  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      result[i] = Math.max(result[i], emb[i]);
    }
  }

  return result;
};

/**
 * Normalize vector to unit length
 */
export const normalizeVector = (v: readonly number[]): number[] => {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return [...v];
  return v.map((x) => x / norm);
};

/**
 * Chunk text into overlapping segments
 */
export const chunkText = (
  text: string,
  chunkSize: number,
  overlap: number
): string[] => {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));

    if (end >= text.length) break;
    start = end - overlap;
  }

  return chunks;
};

// ============================================================================
// MEDICAL TERM PATTERNS (for density calculation)
// ============================================================================

export const MEDICAL_TERM_PATTERNS = [
  // Lab tests
  /\b(WBC|RBC|HGB|HCT|PLT|BUN|creatinine|glucose|sodium|potassium)\b/gi,
  // Vitals
  /\b(BP|HR|RR|SpO2|temperature|pulse|blood\s*pressure)\b/gi,
  // Medications
  /\b(mg|mcg|mL|tablet|capsule|injection|IV|PO|BID|TID|QID|PRN)\b/gi,
  // Diagnoses
  /\b(diagnosis|dx|impression|assessment|findings)\b/gi,
  // Procedures
  /\b(CT|MRI|X-ray|ultrasound|biopsy|surgery|procedure)\b/gi,
  // Anatomy
  /\b(chest|abdomen|lung|heart|liver|kidney|brain|spine)\b/gi,
] as const;

/**
 * Count medical terms in text
 */
export const countMedicalTerms = (text: string): number => {
  let count = 0;
  for (const pattern of MEDICAL_TERM_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
};

/**
 * Calculate medical term density (terms per 100 words)
 */
export const calculateMedicalDensity = (text: string): number => {
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount === 0) return 0;

  const termCount = countMedicalTerms(text);
  return (termCount / wordCount) * 100;
};
