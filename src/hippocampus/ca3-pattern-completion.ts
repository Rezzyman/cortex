/**
 * CA3 — Pattern Completion / Autoassociative Recall
 *
 * Biological CA3 is a recurrent autoassociative network. Given a partial
 * or degraded cue, it reconstructs the full memory by iteratively activating
 * a network of memories through their synaptic connections.
 *
 * Unlike cosine similarity search (nearest neighbor in vector space), CA3:
 *   1. Activates memories via sparse overlap (DG codes)
 *   2. Spreads activation through the synapse graph (recurrent connections)
 *   3. Converges on a coherent recalled pattern in 2 iterations
 *
 * Example: A query "that meeting about the roof thing with Ron" might not
 * be close in dense vector space to the detailed memory. But CA3 traverses:
 *   "Ron" entity → Ron-related memories
 *   "roof" → Best Roof memories
 *   Recurrent connections between those nodes → the specific meeting memory
 *
 * References:
 *   - Ramsauer et al. (2020) "Hopfield Networks is All You Need"
 *   - Rolls (2013) CA3 autoassociative recall model
 */

import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { dgEncode, sparseOverlap } from "./dentate-gyrus.js";
import type { SparseCode, CompletionResult } from "./types.js";

const RECURRENT_BETA = 0.3; // Synapse influence weight
const ITERATIONS = 2; // Convergence iterations (biological CA3 converges fast)
const INITIAL_TOP_N = 20; // Initial activation set size
const MIN_SYNAPSE_STRENGTH = 0.15; // Minimum synapse to propagate through

/**
 * Run CA3 pattern completion given a query.
 *
 * @param agentId - Agent whose memory graph to search
 * @param queryEmbedding - Dense 1024-dim embedding of the query
 * @param limit - Max results to return
 * @returns Ranked memories by CA3 activation score
 */
export async function patternComplete(
  agentId: number,
  queryEmbedding: number[],
  limit: number = 10
): Promise<CompletionResult[]> {
  // Step 1: Encode query through DG
  const querySparse = dgEncode(queryEmbedding);

  // Step 2: Find initial activation set via sparse overlap
  const initialActivation = await findSparseOverlapMatches(
    agentId,
    querySparse,
    INITIAL_TOP_N
  );

  if (initialActivation.length === 0) {
    return [];
  }

  // Step 3: Load synapse graph for activated memories
  const memoryIds = initialActivation.map((m) => m.memoryId);
  const synapseGraph = await loadSynapseGraph(memoryIds);

  // Step 4: Recurrent activation spreading (2 iterations)
  let activationScores = new Map<number, number>();
  for (const m of initialActivation) {
    activationScores.set(m.memoryId, m.overlapScore);
  }

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const newScores = new Map<number, number>();

    for (const [memId, score] of activationScores) {
      // Base activation from sparse overlap
      let activation = score;

      // Add recurrent synaptic input
      const connections = synapseGraph.get(memId) || [];
      for (const conn of connections) {
        const neighborScore = activationScores.get(conn.neighborId) || 0;
        activation += RECURRENT_BETA * conn.strength * neighborScore;
      }

      newScores.set(memId, activation);
    }

    // Check for new memories pulled in through strong synapses
    // (memories not in initial set but strongly connected to activated ones)
    if (iter === 0) {
      const expandedIds = new Set(memoryIds);
      for (const [memId] of activationScores) {
        const connections = synapseGraph.get(memId) || [];
        for (const conn of connections) {
          if (!expandedIds.has(conn.neighborId) && conn.strength > 0.5) {
            // Pull in strongly connected neighbor
            const neighborOverlap = await computeSingleOverlap(
              conn.neighborId,
              querySparse
            );
            newScores.set(
              conn.neighborId,
              neighborOverlap + RECURRENT_BETA * conn.strength * (activationScores.get(memId) || 0)
            );
            expandedIds.add(conn.neighborId);
          }
        }
      }
    }

    activationScores = newScores;
  }

  // Step 5: Rank by final activation score
  const results: CompletionResult[] = [];
  for (const [memId, score] of activationScores) {
    const initial = initialActivation.find((m) => m.memoryId === memId);
    results.push({
      memoryId: memId,
      activationScore: score,
      sparseOverlap: initial?.overlapScore || 0,
      synapticBoost: score - (initial?.overlapScore || 0),
    });
  }

  results.sort((a, b) => b.activationScore - a.activationScore);
  return results.slice(0, limit);
}

/**
 * Find memories with highest sparse overlap using GIN-indexed array intersection.
 */
async function findSparseOverlapMatches(
  agentId: number,
  querySparse: SparseCode,
  topN: number
): Promise<Array<{ memoryId: number; overlapScore: number }>> {
  // Use GIN index on sparse_indices for fast pre-filtering,
  // then compute overlap score in SQL
  const queryIndices = querySparse.indices;
  const queryValues = querySparse.values;

  const result = await db.execute(sql`
    WITH query_entries AS (
      SELECT
        unnest(${queryIndices}::int[]) AS idx,
        unnest(${queryValues}::real[]) AS val
    ),
    candidates AS (
      SELECT hc.memory_id, hc.sparse_indices, hc.sparse_values
      FROM hippocampal_codes hc
      WHERE hc.agent_id = ${agentId}
        AND hc.sparse_indices && ${queryIndices}::int[]
    ),
    expanded AS (
      SELECT
        c.memory_id,
        unnest(c.sparse_indices) AS idx,
        unnest(c.sparse_values) AS val
      FROM candidates c
    ),
    overlaps AS (
      SELECT
        e.memory_id,
        SUM(LEAST(q.val, e.val)) AS overlap_score
      FROM expanded e
      JOIN query_entries q ON q.idx = e.idx
      GROUP BY e.memory_id
    )
    SELECT memory_id, overlap_score
    FROM overlaps
    ORDER BY overlap_score DESC
    LIMIT ${topN}
  `);

  return (result.rows as Array<{ memory_id: number; overlap_score: number }>).map(
    (r) => ({
      memoryId: Number(r.memory_id),
      overlapScore: Number(r.overlap_score),
    })
  );
}

/**
 * Compute sparse overlap for a single stored memory against a query.
 * Used for pulling in neighbors during recurrent activation.
 */
async function computeSingleOverlap(
  memoryId: number,
  querySparse: SparseCode
): Promise<number> {
  const result = await db.execute(sql`
    SELECT sparse_indices, sparse_values
    FROM hippocampal_codes
    WHERE memory_id = ${memoryId}
    LIMIT 1
  `);

  const rows = result.rows as Array<{
    sparse_indices: number[];
    sparse_values: number[];
  }>;

  if (rows.length === 0) return 0;

  const stored: SparseCode = {
    indices: rows[0].sparse_indices,
    values: rows[0].sparse_values,
    dim: querySparse.dim,
  };

  return sparseOverlap(querySparse, stored);
}

/**
 * Load synapse graph for a set of memory IDs.
 * Returns adjacency list: memoryId → [{neighborId, strength}]
 */
async function loadSynapseGraph(
  memoryIds: number[]
): Promise<Map<number, Array<{ neighborId: number; strength: number }>>> {
  const graph = new Map<number, Array<{ neighborId: number; strength: number }>>();

  if (memoryIds.length === 0) return graph;

  const result = await db.execute(sql`
    SELECT memory_a, memory_b, connection_strength
    FROM memory_synapses
    WHERE (memory_a = ANY(${memoryIds}::int[]) OR memory_b = ANY(${memoryIds}::int[]))
      AND connection_strength >= ${MIN_SYNAPSE_STRENGTH}
  `);

  for (const row of result.rows as Array<{
    memory_a: number;
    memory_b: number;
    connection_strength: number;
  }>) {
    const a = Number(row.memory_a);
    const b = Number(row.memory_b);
    const strength = Number(row.connection_strength);

    if (!graph.has(a)) graph.set(a, []);
    if (!graph.has(b)) graph.set(b, []);
    graph.get(a)!.push({ neighborId: b, strength });
    graph.get(b)!.push({ neighborId: a, strength });
  }

  return graph;
}
