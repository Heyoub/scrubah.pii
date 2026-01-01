/**
 * SEMANTIC DEDUPLICATION SERVICE - EFFECT-TS
 *
 * Uses sentence embeddings (MiniLM) to identify and deduplicate
 * semantically similar documents in a corpus.
 *
 * Flow:
 * 1. generateEmbeddings() - Embed all documents
 * 2. findSimilarPairs() - Compute pairwise similarities
 * 3. clusterDocuments() - Group similar docs together
 * 4. selectRepresentatives() - Pick best doc from each cluster
 * 5. deduplicate() - Full pipeline
 *
 * Performance:
 * - Embedding: O(n) with batching
 * - Similarity: O(n²) but optimized with early termination
 * - Clustering: O(n²) worst case, O(n log n) typical
 */

import { Effect, Context, Layer, pipe } from "effect";
import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import { appLogger } from "./appLogger";
import {
  EmbeddingConfig,
  defaultEmbeddingConfig,
  DocumentEmbedding,
  SimilarityPair,
  DocumentCluster,
  DeduplicationResult,
  SelectionCriteria,
  defaultSelectionCriteria,
  cosineSimilarity,
  meanPool,
  maxPool,
  chunkText,
  calculateMedicalDensity,
} from "../schemas/semanticDedup";

// ============================================================================
// SERVICE ERROR TYPE
// ============================================================================

export class SemanticDedupError extends Error {
  readonly _tag = "SemanticDedupError";
  constructor(
    readonly message: string,
    readonly phase?: "embedding" | "similarity" | "clustering" | "selection"
  ) {
    super(message);
  }
}

// ============================================================================
// DOCUMENT INPUT TYPE
// ============================================================================

export interface DedupDocumentInput {
  id: string;
  content: string;
  metadata?: {
    date?: string;
    type?: string;
    ocrQualityScore?: number;
  };
}

// ============================================================================
// EMBEDDING MODEL (lazy loaded)
// ============================================================================

let embeddingPipeline: FeatureExtractionPipeline | null = null;

const loadEmbeddingModel = async (
  modelId: string
): Promise<FeatureExtractionPipeline> => {
  if (embeddingPipeline) return embeddingPipeline;

  appLogger.info('semantic_dedup_model_loading', { modelId });
  embeddingPipeline = (await pipeline("feature-extraction", modelId, {
    dtype: "q8", // quantized for browser
  })) as unknown as FeatureExtractionPipeline;
  appLogger.info('semantic_dedup_model_loaded', { modelId });

  return embeddingPipeline;
};

// ============================================================================
// SERVICE INTERFACE
// ============================================================================

export interface SemanticDedupService {
  /**
   * Generate embeddings for documents
   */
  readonly generateEmbeddings: (
    documents: DedupDocumentInput[],
    config?: Partial<EmbeddingConfig>
  ) => Effect.Effect<DocumentEmbedding[], SemanticDedupError, never>;

  /**
   * Find similar document pairs from embeddings
   */
  readonly findSimilarPairs: (
    embeddings: DocumentEmbedding[],
    config?: Partial<EmbeddingConfig>
  ) => Effect.Effect<SimilarityPair[], SemanticDedupError, never>;

  /**
   * Cluster documents by similarity
   */
  readonly clusterDocuments: (
    embeddings: DocumentEmbedding[],
    pairs: SimilarityPair[],
    config?: Partial<EmbeddingConfig>
  ) => Effect.Effect<DocumentCluster[], SemanticDedupError, never>;

  /**
   * Select representative from each cluster
   */
  readonly selectRepresentatives: (
    clusters: DocumentCluster[],
    documents: DedupDocumentInput[],
    criteria?: SelectionCriteria
  ) => Effect.Effect<DocumentCluster[], SemanticDedupError, never>;

  /**
   * Full deduplication pipeline
   */
  readonly deduplicate: (
    documents: DedupDocumentInput[],
    config?: Partial<EmbeddingConfig>,
    criteria?: SelectionCriteria
  ) => Effect.Effect<DeduplicationResult, SemanticDedupError, never>;
}

export const SemanticDedupService =
  Context.GenericTag<SemanticDedupService>("SemanticDedupService");

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

class SemanticDedupServiceImpl implements SemanticDedupService {
  /**
   * Generate embeddings for all documents
   */
  readonly generateEmbeddings = (
    documents: DedupDocumentInput[],
    configOverrides?: Partial<EmbeddingConfig>
  ) => {
    return Effect.tryPromise({
      try: async () => {
        const config = { ...defaultEmbeddingConfig, ...configOverrides };
        const model = await loadEmbeddingModel(config.modelId);
        const embeddings: DocumentEmbedding[] = [];

        for (const doc of documents) {
          const startTime = performance.now();

          // Chunk if document is long
          const chunks = chunkText(
            doc.content,
            config.chunkSize,
            config.chunkOverlap
          );

          // Generate embeddings for each chunk
          const chunkEmbeddings: number[][] = [];

          for (const chunk of chunks) {
            if (chunk.trim().length === 0) continue;

            // Run embedding model
            const output = await model(chunk, {
              pooling: config.poolingStrategy,
              normalize: true,
            });

            // Extract embedding array from tensor
            const embedding = Array.from(output.data as Float32Array);
            chunkEmbeddings.push(embedding);
          }

          // Aggregate chunk embeddings
          let finalEmbedding: number[];
          if (chunkEmbeddings.length === 0) {
            // Empty document - use zero vector
            finalEmbedding = new Array(384).fill(0); // MiniLM dim
          } else if (chunkEmbeddings.length === 1) {
            finalEmbedding = chunkEmbeddings[0];
          } else {
            switch (config.aggregateChunks) {
              case "first":
                finalEmbedding = chunkEmbeddings[0];
                break;
              case "max_pool":
                finalEmbedding = maxPool(chunkEmbeddings);
                break;
              case "mean":
              default:
                finalEmbedding = meanPool(chunkEmbeddings);
                break;
            }
          }

          embeddings.push({
            documentId: doc.id,
            embedding: finalEmbedding,
            embeddingDim: finalEmbedding.length,
            chunkCount: chunks.length,
            chunkEmbeddings:
              chunks.length > 1 ? chunkEmbeddings : undefined,
            textLength: doc.content.length,
            processingTimeMs: Math.round(performance.now() - startTime),
          });
        }

        return embeddings;
      },
      catch: (error) =>
        new SemanticDedupError(
          `Embedding generation failed: ${error}`,
          "embedding"
        ),
    });
  };

  /**
   * Find all similar document pairs
   */
  readonly findSimilarPairs = (
    embeddings: DocumentEmbedding[],
    configOverrides?: Partial<EmbeddingConfig>
  ) => {
    return Effect.sync(() => {
      const config = { ...defaultEmbeddingConfig, ...configOverrides };
      const pairs: SimilarityPair[] = [];

      // Compute pairwise similarities
      for (let i = 0; i < embeddings.length; i++) {
        for (let j = i + 1; j < embeddings.length; j++) {
          const similarity = cosineSimilarity(
            embeddings[i].embedding,
            embeddings[j].embedding
          );

          // Only keep pairs above a minimum threshold (0.5)
          if (similarity >= 0.5) {
            let relationship: SimilarityPair["relationship"];
            if (similarity >= config.nearDuplicateThreshold) {
              relationship = "DUPLICATE";
            } else if (similarity >= config.similarityThreshold) {
              relationship = "SIMILAR";
            } else {
              relationship = "RELATED";
            }

            pairs.push({
              docId1: embeddings[i].documentId,
              docId2: embeddings[j].documentId,
              similarity,
              relationship,
            });
          }
        }
      }

      // Sort by similarity descending
      pairs.sort((a, b) => b.similarity - a.similarity);

      return pairs;
    });
  };

  /**
   * Cluster documents using Union-Find with similarity threshold
   */
  readonly clusterDocuments = (
    embeddings: DocumentEmbedding[],
    pairs: SimilarityPair[],
    configOverrides?: Partial<EmbeddingConfig>
  ) => {
    return Effect.sync(() => {
      const config = { ...defaultEmbeddingConfig, ...configOverrides };

      // Union-Find data structure
      const parent = new Map<string, string>();
      const rank = new Map<string, number>();

      // Initialize each doc as its own cluster
      for (const emb of embeddings) {
        parent.set(emb.documentId, emb.documentId);
        rank.set(emb.documentId, 0);
      }

      const find = (x: string): string => {
        if (parent.get(x) !== x) {
          parent.set(x, find(parent.get(x)!));
        }
        return parent.get(x)!;
      };

      const union = (x: string, y: string): void => {
        const rootX = find(x);
        const rootY = find(y);
        if (rootX === rootY) return;

        const rankX = rank.get(rootX)!;
        const rankY = rank.get(rootY)!;

        if (rankX < rankY) {
          parent.set(rootX, rootY);
        } else if (rankX > rankY) {
          parent.set(rootY, rootX);
        } else {
          parent.set(rootY, rootX);
          rank.set(rootX, rankX + 1);
        }
      };

      // Union similar documents
      for (const pair of pairs) {
        if (pair.similarity >= config.similarityThreshold) {
          union(pair.docId1, pair.docId2);
        }
      }

      // Group documents by cluster root
      const clusterMap = new Map<string, string[]>();
      for (const emb of embeddings) {
        const root = find(emb.documentId);
        if (!clusterMap.has(root)) {
          clusterMap.set(root, []);
        }
        clusterMap.get(root)!.push(emb.documentId);
      }

      // Build cluster objects
      const embeddingMap = new Map(embeddings.map((e) => [e.documentId, e]));
      const clusters: DocumentCluster[] = [];
      let clusterIndex = 0;

      for (const [_root, docIds] of clusterMap) {
        // Determine cluster type
        let type: DocumentCluster["type"];
        if (docIds.length === 1) {
          type = "SINGLETON";
        } else {
          // Check average similarity within cluster
          let totalSim = 0;
          let pairCount = 0;
          let minSim = 1;

          for (let i = 0; i < docIds.length; i++) {
            for (let j = i + 1; j < docIds.length; j++) {
              const sim = cosineSimilarity(
                embeddingMap.get(docIds[i])!.embedding,
                embeddingMap.get(docIds[j])!.embedding
              );
              totalSim += sim;
              pairCount++;
              minSim = Math.min(minSim, sim);
            }
          }

          const avgSim = pairCount > 0 ? totalSim / pairCount : 0;
          if (avgSim >= config.nearDuplicateThreshold) {
            type = "DUPLICATE_GROUP";
          } else if (avgSim >= config.similarityThreshold) {
            type = "SIMILAR_GROUP";
          } else {
            type = "TOPIC_GROUP";
          }
        }

        // Compute centroid
        const clusterEmbeddings = docIds.map(
          (id) => embeddingMap.get(id)!.embedding
        );
        const centroid = meanPool(clusterEmbeddings);

        // Compute internal similarities
        let totalInternalSim = 0;
        let minInternalSim = 1;
        let internalPairCount = 0;

        for (let i = 0; i < docIds.length; i++) {
          for (let j = i + 1; j < docIds.length; j++) {
            const sim = cosineSimilarity(
              embeddingMap.get(docIds[i])!.embedding,
              embeddingMap.get(docIds[j])!.embedding
            );
            totalInternalSim += sim;
            minInternalSim = Math.min(minInternalSim, sim);
            internalPairCount++;
          }
        }

        const avgInternalSim =
          internalPairCount > 0 ? totalInternalSim / internalPairCount : 1;

        clusters.push({
          clusterId: `cluster_${clusterIndex++}`,
          type,
          documentIds: docIds,
          documentCount: docIds.length,
          representativeId: docIds[0], // Temporary, will be updated
          representativeScore: 0,
          avgInternalSimilarity: avgInternalSim,
          minInternalSimilarity: docIds.length > 1 ? minInternalSim : 1,
          centroid,
        });
      }

      return clusters;
    });
  };

  /**
   * Select representative from each cluster
   */
  readonly selectRepresentatives = (
    clusters: DocumentCluster[],
    documents: DedupDocumentInput[],
    criteria?: SelectionCriteria
  ) => {
    return Effect.sync(() => {
      const selectionCriteria = criteria || defaultSelectionCriteria;
      const docMap = new Map(documents.map((d) => [d.id, d]));

      return clusters.map((cluster) => {
        if (cluster.documentCount === 1) {
          // Singleton - just use the only doc
          return {
            ...cluster,
            representativeId: cluster.documentIds[0],
            representativeScore: 1,
          };
        }

        // Score each document in the cluster
        const scores: Array<{ docId: string; score: number }> = [];

        for (const docId of cluster.documentIds) {
          const doc = docMap.get(docId);
          if (!doc) continue;

          let score = 0;

          // Length score (normalized)
          const maxLen = Math.max(
            ...cluster.documentIds.map(
              (id) => docMap.get(id)?.content.length || 0
            )
          );
          const lengthScore =
            maxLen > 0 ? doc.content.length / maxLen : 0;
          score += lengthScore * selectionCriteria.lengthWeight;

          // Recency score (if date available)
          if (doc.metadata?.date) {
            // More recent = higher score (simple approach)
            // Could be improved with actual date parsing
            const recencyScore = 0.5; // Default if date exists
            score += recencyScore * selectionCriteria.recencyWeight;
          }

          // Quality score (from OCR)
          if (doc.metadata?.ocrQualityScore !== undefined) {
            score +=
              doc.metadata.ocrQualityScore * selectionCriteria.qualityWeight;
          } else {
            // Assume good quality if no OCR
            score += 0.8 * selectionCriteria.qualityWeight;
          }

          // Medical density score
          const medicalDensity = calculateMedicalDensity(doc.content);
          const normalizedDensity = Math.min(medicalDensity / 20, 1); // Cap at 20%
          score += normalizedDensity * selectionCriteria.medicalDensityWeight;

          scores.push({ docId, score });
        }

        // Sort by score descending
        scores.sort((a, b) => b.score - a.score);

        const bestDoc = scores[0];

        return {
          ...cluster,
          representativeId: bestDoc?.docId || cluster.documentIds[0],
          representativeScore: bestDoc?.score || 0,
        };
      });
    });
  };

  /**
   * Full deduplication pipeline
   */
  readonly deduplicate = (
    documents: DedupDocumentInput[],
    configOverrides?: Partial<EmbeddingConfig>,
    criteria?: SelectionCriteria
  ) => {
    return Effect.gen(this, function* (_) {
      const startTime = performance.now();
      const config = { ...defaultEmbeddingConfig, ...configOverrides };

      // Step 1: Generate embeddings
      appLogger.info('semantic_dedup_embeddings_start', { documentCount: documents.length });
      const embeddings = yield* _(
        this.generateEmbeddings(documents, config)
      );

      // Step 2: Find similar pairs
      appLogger.info('semantic_dedup_similarity_start');
      const pairs = yield* _(this.findSimilarPairs(embeddings, config));
      appLogger.info('semantic_dedup_similarity_done', { pairCount: pairs.length });

      // Step 3: Cluster documents
      appLogger.info('semantic_dedup_clustering_start');
      const rawClusters = yield* _(
        this.clusterDocuments(embeddings, pairs, config)
      );

      // Step 4: Select representatives
      appLogger.info('semantic_dedup_selection_start');
      const clusters = yield* _(
        this.selectRepresentatives(rawClusters, documents, criteria)
      );

      // Compute statistics
      const singletonCount = clusters.filter(
        (c) => c.type === "SINGLETON"
      ).length;
      const uniqueDocCount = clusters.length;
      const duplicatesRemoved = documents.length - uniqueDocCount;
      const reductionRatio =
        documents.length > 0 ? duplicatesRemoved / documents.length : 0;

      const processingTimeMs = Math.round(performance.now() - startTime);

      appLogger.info('semantic_dedup_complete', {
        totalDocuments: documents.length,
        uniqueDocuments: uniqueDocCount,
        reductionPercent: Number((reductionRatio * 100).toFixed(1)),
        processingTimeMs,
      });

      return {
        clusters,
        totalClusters: clusters.length,
        singletonCount,
        originalDocCount: documents.length,
        uniqueDocCount,
        duplicatesRemoved,
        reductionRatio,
        similarityPairs: pairs.filter(
          (p) => p.relationship !== "RELATED"
        ), // Only significant pairs
        configUsed: config,
        processingTimeMs,
      } satisfies DeduplicationResult;
    });
  };
}

// ============================================================================
// SERVICE LAYER
// ============================================================================

export const SemanticDedupServiceLive = Layer.succeed(
  SemanticDedupService,
  new SemanticDedupServiceImpl()
);

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Run full deduplication (convenience wrapper)
 */
export const deduplicateDocuments = (
  documents: DedupDocumentInput[],
  config?: Partial<EmbeddingConfig>,
  criteria?: SelectionCriteria
): Effect.Effect<DeduplicationResult, SemanticDedupError, SemanticDedupService> => {
  return Effect.gen(function* (_) {
    const service = yield* _(SemanticDedupService);
    return yield* _(service.deduplicate(documents, config, criteria));
  });
};

/**
 * Run deduplication standalone
 */
export const runDeduplication = async (
  documents: DedupDocumentInput[],
  config?: Partial<EmbeddingConfig>,
  criteria?: SelectionCriteria
) => {
  const program = pipe(
    deduplicateDocuments(documents, config, criteria),
    Effect.provide(SemanticDedupServiceLive)
  );

  return Effect.runPromise(program);
};

/**
 * Get deduplication summary
 */
export const getDedupSummary = (result: DeduplicationResult) => {
  const duplicateGroups = result.clusters.filter(
    (c) => c.type === "DUPLICATE_GROUP"
  );
  const similarGroups = result.clusters.filter(
    (c) => c.type === "SIMILAR_GROUP"
  );

  return {
    originalCount: result.originalDocCount,
    uniqueCount: result.uniqueDocCount,
    reductionPercent: (result.reductionRatio * 100).toFixed(1) + "%",
    duplicateGroups: duplicateGroups.length,
    similarGroups: similarGroups.length,
    singletons: result.singletonCount,
    processingTime: result.processingTimeMs + "ms",
    representatives: result.clusters.map((c) => ({
      clusterId: c.clusterId,
      type: c.type,
      representative: c.representativeId,
      memberCount: c.documentCount,
      avgSimilarity: c.avgInternalSimilarity.toFixed(3),
    })),
  };
};
