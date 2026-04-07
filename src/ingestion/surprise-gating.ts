import { db } from "../db/index.js";
import { sql } from "drizzle-orm";

/**
 * Surprise-Gated Ingestion — Engram Memory Theory
 *
 * Computes novelty of a new memory chunk by comparing its embedding
 * to the 5 most recent memories (last 24h). Adjusts resonance and
 * priority based on how "surprising" the content is.
 *
 * - High similarity (>= 0.85): redundant → reduce resonance by 30%
 * - Low similarity (<= 0.40): highly novel → boost resonance by 50%, set priority to 1
 * - novelty_score = 1 - max_similarity (dissimilarity)
 */
export async function computeSurpriseGating(
  agentId: number,
  embedding: number[],
  basePriority: number
): Promise<{ resonanceScore: number; priority: number; noveltyScore: number }> {
  const BASE_RESONANCE = 5.0;
  const embeddingStr = `[${embedding.join(",")}]`;

  // Find 5 most recent memories from last 24h with embeddings
  const recentResult = await db.execute(sql`
    SELECT id, 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM memory_nodes
    WHERE agent_id = ${agentId}
      AND status = 'active'
      AND embedding IS NOT NULL
      AND created_at > NOW() - INTERVAL '24 hours'
    ORDER BY created_at DESC
    LIMIT 5
  `);

  const rows = recentResult.rows as Array<{ id: number; similarity: number }>;

  // No recent memories to compare against — treat as moderately novel
  if (rows.length === 0) {
    return {
      resonanceScore: BASE_RESONANCE,
      priority: basePriority,
      noveltyScore: 0.5,
    };
  }

  const maxSimilarity = Math.max(...rows.map((r) => Number(r.similarity)));
  const noveltyScore = 1 - maxSimilarity;

  let resonanceScore = BASE_RESONANCE;
  let priority = basePriority;

  if (maxSimilarity >= 0.85) {
    // Redundant — reduce resonance by 30%
    resonanceScore = BASE_RESONANCE * 0.7;
  } else if (maxSimilarity <= 0.40) {
    // Highly novel — boost resonance by 50% and elevate priority
    resonanceScore = BASE_RESONANCE * 1.5;
    priority = 1;
  }

  return { resonanceScore, priority, noveltyScore };
}
