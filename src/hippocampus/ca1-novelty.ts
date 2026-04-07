/**
 * CA1 — Novelty Detection / Predictive Coding Comparator
 *
 * Biological CA1 receives:
 *   - Direct input from EC Layer III (raw incoming signal)
 *   - Processed input from CA3 (what the memory network "predicts")
 *
 * The mismatch between these two signals is the novelty signal.
 *
 * Implementation:
 *   1. Find top-5 most similar existing memories (dense cosine)
 *   2. Compute weighted centroid = the network's "prediction"
 *   3. Measure mismatch in both dense and sparse space
 *   4. Output graded novelty signal that modulates storage priority
 *
 * This replaces the simpler computeSurpriseGating which only compared
 * against recent memories with a binary threshold.
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { dgEncode, sparseOverlap } from "./dentate-gyrus.js";
import type { SparseCode, NoveltyResult } from "./types.js";

const BASE_RESONANCE = 5.0;
const DENSE_WEIGHT = 0.6;
const SPARSE_WEIGHT = 0.4;

// Novelty thresholds
const NOVEL_HIGH = 0.7; // Highly novel: boost resonance 60%
const NOVEL_LOW = 0.3; // Redundant: reduce resonance 40%

/**
 * Compute novelty of an incoming memory by comparing what arrived
 * against what the existing memory network predicts/expects.
 *
 * @param agentId - Agent whose memory network to compare against
 * @param denseEmbedding - 1024-dim Voyage embedding of the new chunk
 * @param sparseCode - DG sparse code of the new chunk
 * @param basePriority - Starting priority level (0-4)
 * @returns NoveltyResult with graded novelty and adjusted resonance/priority
 */
export async function computeNovelty(
  agentId: number,
  denseEmbedding: number[],
  sparseCode: SparseCode,
  basePriority: number
): Promise<NoveltyResult> {
  const embeddingStr = `[${denseEmbedding.join(",")}]`;

  // Find top-5 most similar memories across ALL time (not just 24h)
  // This is the full network prediction, not just recency-biased
  const neighborsResult = await db.execute(sql`
    SELECT
      id,
      embedding,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM memory_nodes
    WHERE agent_id = ${agentId}
      AND status = 'active'
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${embeddingStr}::vector ASC
    LIMIT 5
  `);

  const neighbors = neighborsResult.rows as Array<{
    id: number;
    embedding: string;
    similarity: number;
  }>;

  // No existing memories — everything is novel
  if (neighbors.length === 0) {
    return {
      noveltyScore: 0.8,
      resonanceScore: BASE_RESONANCE * 1.3,
      adjustedPriority: Math.min(basePriority, 1),
      predictedSimilarity: 0,
      sparseMismatch: 1.0,
    };
  }

  // ── Dense-space prediction ──
  // Compute weighted centroid of neighbor embeddings = what the network "expects"
  const totalSim = neighbors.reduce(
    (sum, n) => sum + Math.max(Number(n.similarity), 0),
    0
  );

  const predictedEmbedding = new Float64Array(denseEmbedding.length);
  for (const neighbor of neighbors) {
    const sim = Math.max(Number(neighbor.similarity), 0);
    const weight = totalSim > 0 ? sim / totalSim : 1.0 / neighbors.length;

    // Parse the embedding from pg format [x,y,z,...]
    const emb = neighbor.embedding as unknown as string;
    const parsed = emb
      .slice(1, -1)
      .split(",")
      .map(Number);

    for (let i = 0; i < parsed.length; i++) {
      predictedEmbedding[i] += parsed[i] * weight;
    }
  }

  // Dense mismatch: 1 - cosine(incoming, predicted)
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < denseEmbedding.length; i++) {
    dotProduct += denseEmbedding[i] * predictedEmbedding[i];
    normA += denseEmbedding[i] * denseEmbedding[i];
    normB += predictedEmbedding[i] * predictedEmbedding[i];
  }
  const cosineSim =
    dotProduct / (Math.sqrt(normA) * Math.sqrt(normB) || 1e-10);
  const denseMismatch = 1 - Math.max(cosineSim, 0);

  // ── Sparse-space prediction ──
  // Encode the predicted centroid through DG and measure sparse mismatch
  const predictedDense = Array.from(predictedEmbedding);
  const predictedSparse = dgEncode(predictedDense);
  const sparseMatch = sparseOverlap(sparseCode, predictedSparse);
  const sparseMismatch = 1 - sparseMatch;

  // ── Combined novelty signal with sparse gating ──
  // Key insight: when dense mismatch is moderate but sparse overlap is HIGH,
  // it means the incoming memory is a coherent pattern reactivation (the DG
  // encoded it similarly to existing memories). This is NOT a novelty event,
  // it's pattern completion working correctly. Suppress the novelty signal.
  let noveltyScore =
    DENSE_WEIGHT * denseMismatch + SPARSE_WEIGHT * sparseMismatch;

  // Sparse gating: if sparse codes overlap significantly (>0.5),
  // the hippocampus recognizes this pattern. Dampen novelty.
  if (sparseMatch > 0.5 && denseMismatch > 0.3 && denseMismatch < 0.7) {
    // Pattern recognized in sparse space despite moderate dense distance.
    // This is incremental variation, not genuine novelty.
    const dampingFactor = 0.4 + 0.6 * (1 - sparseMatch); // 0.4-1.0
    noveltyScore *= dampingFactor;
  }

  // Contradiction detection: high dense mismatch AND low sparse overlap
  // means content that is structurally different AND semantically distant.
  // This is genuinely novel or contradictory — boost the signal.
  if (denseMismatch > 0.7 && sparseMatch < 0.1) {
    noveltyScore = Math.min(noveltyScore * 1.3, 1.0);
  }

  // ── Modulate resonance and priority ──
  let resonanceScore = BASE_RESONANCE;
  let adjustedPriority = basePriority;

  if (noveltyScore > NOVEL_HIGH) {
    // Highly novel: boost significantly
    resonanceScore = BASE_RESONANCE * 1.6;
    adjustedPriority = Math.max(0, basePriority - 1); // elevate priority
  } else if (noveltyScore <= NOVEL_LOW) {
    // Redundant/expected: reduce
    resonanceScore = BASE_RESONANCE * 0.6;
    // Don't change priority for redundant content
  }
  // Normal range (0.3 - 0.7): use base resonance

  return {
    noveltyScore,
    resonanceScore,
    adjustedPriority,
    predictedSimilarity: cosineSim,
    sparseMismatch,
  };
}
