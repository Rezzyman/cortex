/**
 * CogBench — Extended CORTEX Client
 *
 * Builds on the base benchmark client with access to cognitive subsystems:
 * reconsolidation, procedural memory, valence analysis, hippocampal encoding,
 * dream cycles, and cross-agent operations.
 */
import { db, schema, initDatabase } from "../../src/db/index.js";
import { sql, eq, and } from "drizzle-orm";
import { embedTexts, embedQuery } from "../../src/ingestion/embeddings.js";
import { chunkText } from "../../src/ingestion/chunker.js";
import { extractEntitiesSync, extractSemanticTags } from "../../src/ingestion/entities.js";
import { hippocampalEncode, dgEncode, computeNovelty, sparseOverlap } from "../../src/hippocampus/index.js";
import { formSynapses } from "../../src/ingestion/synapse-formation.js";
import { markLabile, reconsolidate, isLabile } from "../../src/reconsolidation/index.js";
import { storeProcedural, retrieveProcedural, recordExecution } from "../../src/procedural/index.js";
import { analyzeValence } from "../../src/valence/analyzer.js";
import { runDreamCycle } from "../../src/dream/dream-cycle.js";
import type { MemoryFixture } from "./types.js";
import "dotenv/config";

export interface IngestedMemory {
  fixtureId: string;
  nodeIds: number[];
}

export interface SearchResult {
  id: number;
  content: string;
  source: string | null;
  score: number;
  resonanceScore?: number;
}

// ─── Agent Management ──────────────────────────────────

export async function initCogBench(): Promise<void> {
  await initDatabase();
}

export async function createAgent(tag: string): Promise<number> {
  const externalId = `cogbench-${tag}`;
  let [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.externalId, externalId))
    .limit(1);

  if (!agent) {
    [agent] = await db
      .insert(schema.agents)
      .values({
        externalId,
        name: `CogBench: ${tag}`,
        ownerId: "cogbench",
      })
      .returning();
  }

  return agent.id;
}

export async function clearAgent(agentId: number): Promise<void> {
  // Cascade deletes hippocampal_codes, emotional_valence, memory_synapses
  await db.execute(sql`DELETE FROM memory_nodes WHERE agent_id = ${agentId}`);
  await db.execute(sql`DELETE FROM procedural_memories WHERE agent_id = ${agentId}`);
  await db.execute(sql`DELETE FROM cognitive_artifacts WHERE agent_id = ${agentId}`);
  await db.execute(sql`DELETE FROM dream_cycle_logs WHERE agent_id = ${agentId}`);
}

// ─── Memory Ingestion ──────────────────────────────────

/**
 * Ingest a memory fixture into CORTEX with full cognitive pipeline.
 * Unlike the base client's fast mode, this runs hippocampal encoding
 * and synapse formation for cognitive fidelity.
 */
export async function ingestMemory(
  agentId: number,
  fixture: MemoryFixture,
  fullPipeline: boolean = true
): Promise<IngestedMemory> {
  const chunks = chunkText(fixture.content);
  if (chunks.length === 0) {
    return { fixtureId: fixture.id, nodeIds: [] };
  }

  const embeddings = await embedTexts(chunks.map((c) => c.text));

  const values = chunks.map((chunk, i) => ({
    agentId,
    content: chunk.text,
    source: `cogbench/${fixture.source}/${fixture.id}`,
    sourceType: "benchmark" as const,
    chunkIndex: i,
    embedding: embeddings[i],
    entities: extractEntitiesSync(chunk.text),
    semanticTags: extractSemanticTags(chunk.text),
    priority: fixture.priority ?? 2,
    resonanceScore: 5.0,
    noveltyScore: 0.5,
    status: "active" as const,
    ...(fixture.validFrom ? { validFrom: new Date(fixture.validFrom) } : {}),
    ...(fixture.validUntil ? { validUntil: new Date(fixture.validUntil) } : {}),
  }));

  const inserted = await db
    .insert(schema.memoryNodes)
    .values(values)
    .returning({ id: schema.memoryNodes.id });

  const nodeIds = inserted.map((r) => r.id);

  if (fullPipeline) {
    // Hippocampal encoding
    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const encoding = await hippocampalEncode(agentId, embeddings[i], fixture.priority ?? 2);
        // Store hippocampal code
        await db.insert(schema.hippocampalCodes).values({
          memoryId: nodeIds[i],
          agentId,
          sparseIndices: encoding.sparseCode.indices,
          sparseValues: encoding.sparseCode.values,
          sparseDim: encoding.sparseCode.dim,
          noveltyScore: encoding.noveltyResult.noveltyScore,
        });
        // Update node with novelty-adjusted resonance
        await db.execute(sql`
          UPDATE memory_nodes
          SET resonance_score = ${encoding.noveltyResult.resonanceScore},
              priority = ${encoding.noveltyResult.adjustedPriority}
          WHERE id = ${nodeIds[i]}
        `);
      } catch {
        // Non-critical — skip encoding errors
      }
    }

    // Valence analysis
    for (let i = 0; i < nodeIds.length; i++) {
      try {
        const valence = analyzeValence(chunks[i].text);
        await db.insert(schema.emotionalValence).values({
          memoryId: nodeIds[i],
          agentId,
          valence: valence.vector.valence,
          arousal: valence.vector.arousal,
          dominance: valence.vector.dominance,
          certainty: valence.vector.certainty,
          relevance: valence.vector.relevance,
          urgency: valence.vector.urgency,
          intensity: valence.salience.intensity,
          decayResistance: valence.salience.decayResistance,
          recallBoost: valence.salience.recallBoost,
          dominantDimension: valence.salience.dominantDimension,
        });
      } catch {
        // Non-critical
      }
    }

    // Synapse formation
    if (nodeIds.length > 1) {
      try {
        await formSynapses(agentId, nodeIds);
      } catch {
        // Non-critical
      }
    }
  }

  return { fixtureId: fixture.id, nodeIds };
}

/**
 * Batch ingest all fixtures for a scenario.
 */
export async function ingestScenario(
  agentId: number,
  fixtures: MemoryFixture[],
  fullPipeline: boolean = true
): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  for (const fixture of fixtures) {
    const result = await ingestMemory(agentId, fixture, fullPipeline);
    map.set(result.fixtureId, result.nodeIds);
  }

  // Cross-memory synapse formation (between different fixtures)
  if (fullPipeline) {
    const allNodeIds = [...map.values()].flat();
    if (allNodeIds.length > 1) {
      try {
        await formSynapses(agentId, allNodeIds);
      } catch {
        // Non-critical
      }
    }
  }

  return map;
}

// ─── Search ────────────────────────────────────────────

/**
 * Hybrid search with full scoring (same as production).
 */
export async function search(
  agentId: number,
  query: string,
  topK: number = 10
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    WITH vector_scores AS (
      SELECT
        mn.id,
        mn.content,
        mn.source,
        mn.resonance_score,
        1 - (mn.embedding <=> ${embeddingStr}::vector) AS cosine_sim,
        CASE WHEN mn.content ILIKE ${"%" + query + "%"} THEN 1.0 ELSE 0.0 END AS text_match,
        EXP(-0.023 * EXTRACT(EPOCH FROM (NOW() - mn.created_at)) / 86400) AS recency,
        LEAST(mn.resonance_score / 10.0, 1.0) AS norm_resonance,
        CASE mn.priority
          WHEN 0 THEN 1.0 WHEN 1 THEN 0.8 WHEN 2 THEN 0.5 WHEN 3 THEN 0.3 WHEN 4 THEN 0.1
          ELSE 0.5
        END AS priority_boost,
        COALESCE(ev.recall_boost, 0.0) AS emotional_boost
      FROM memory_nodes mn
      LEFT JOIN emotional_valence ev ON ev.memory_id = mn.id
      WHERE mn.agent_id = ${agentId}
        AND mn.status = 'active'
        AND mn.embedding IS NOT NULL
    )
    SELECT id, content, source, resonance_score,
      (0.45 * cosine_sim
     + 0.18 * text_match
     + 0.12 * recency
     + 0.10 * norm_resonance
     + 0.05 * priority_boost
     + 0.10 * emotional_boost) AS hybrid_score
    FROM vector_scores
    ORDER BY hybrid_score DESC
    LIMIT ${topK}
  `);

  return (results.rows as Array<{
    id: number;
    content: string;
    source: string | null;
    resonance_score: number;
    hybrid_score: number;
  }>).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    score: Number(r.hybrid_score),
    resonanceScore: Number(r.resonance_score),
  }));
}

/**
 * Temporal-aware search: only returns memories valid at the given timestamp.
 */
export async function temporalSearch(
  agentId: number,
  query: string,
  atTimestamp: string,
  topK: number = 10
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;
  const ts = new Date(atTimestamp).toISOString();

  const results = await db.execute(sql`
    WITH vector_scores AS (
      SELECT
        mn.id,
        mn.content,
        mn.source,
        mn.resonance_score,
        1 - (mn.embedding <=> ${embeddingStr}::vector) AS cosine_sim,
        CASE WHEN mn.content ILIKE ${"%" + query + "%"} THEN 1.0 ELSE 0.0 END AS text_match,
        LEAST(mn.resonance_score / 10.0, 1.0) AS norm_resonance,
        COALESCE(ev.recall_boost, 0.0) AS emotional_boost
      FROM memory_nodes mn
      LEFT JOIN emotional_valence ev ON ev.memory_id = mn.id
      WHERE mn.agent_id = ${agentId}
        AND mn.status = 'active'
        AND mn.embedding IS NOT NULL
        AND (mn.valid_from IS NULL OR mn.valid_from <= ${ts}::timestamptz)
        AND (mn.valid_until IS NULL OR mn.valid_until >= ${ts}::timestamptz)
    )
    SELECT id, content, source, resonance_score,
      (0.50 * cosine_sim
     + 0.18 * text_match
     + 0.12 * norm_resonance
     + 0.10 * emotional_boost) AS hybrid_score
    FROM vector_scores
    ORDER BY hybrid_score DESC
    LIMIT ${topK}
  `);

  return (results.rows as Array<{
    id: number;
    content: string;
    source: string | null;
    resonance_score: number;
    hybrid_score: number;
  }>).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    score: Number(r.hybrid_score),
    resonanceScore: Number(r.resonance_score),
  }));
}

// ─── Reconsolidation ───────────────────────────────────

export { markLabile, reconsolidate, isLabile };

/**
 * Trigger recall on a set of memory node IDs (makes them labile).
 *
 * Uses a PostgreSQL text-array literal (`{1,2,3}::int[]`) instead of
 * drizzle-orm's template array interpolation. This benchmark harness has
 * used this workaround since initial write because drizzle-orm serializes
 * JS number arrays as composite ROW(...) types that Postgres refuses to cast
 * to int[] ("cannot cast type record to integer[]").
 *
 * As of 2026-04-10, the canonical fix in the main codebase (src/) is to use
 * `sql.raw(\`ARRAY[${ids.join(",")}]::int[]\`)` — both patterns work. This
 * harness continues to use the text-literal pattern because it is battle-
 * tested against the full CogBench suite. The rest of the client.ts file
 * follows the same text-literal convention below (getResonanceScores,
 * getActiveNodeIds, countSynapses) — keep it consistent within this file.
 */
export async function recallAndMarkLabile(nodeIds: number[]): Promise<void> {
  if (nodeIds.length === 0) return;
  const idList = `{${nodeIds.join(",")}}`;
  await db.execute(sql`
    UPDATE memory_nodes
    SET last_recalled_at = NOW()
    WHERE id = ANY(${idList}::int[])
  `);
}

// ─── Novelty ───────────────────────────────────────────

export { dgEncode, computeNovelty, sparseOverlap };

/**
 * Compute novelty score for a text against an agent's existing memory.
 */
export async function computeNoveltyForText(
  agentId: number,
  text: string
): Promise<{ noveltyScore: number; resonanceScore: number }> {
  const [embedding] = await embedTexts([text]);
  const sparseCode = dgEncode(embedding);
  const result = await computeNovelty(agentId, embedding, sparseCode, 2);
  return {
    noveltyScore: result.noveltyScore,
    resonanceScore: result.resonanceScore,
  };
}

// ─── Procedural ────────────────────────────────────────

export { storeProcedural, retrieveProcedural, recordExecution };

// ─── Dream Cycle ───────────────────────────────────────

export { runDreamCycle };

// ─── Valence ───────────────────────────────────────────

export { analyzeValence };

// ─── Utility: get node IDs from fixture source ─────────

export async function getNodeIds(agentId: number, fixtureId: string): Promise<number[]> {
  const results = await db.execute(sql`
    SELECT id FROM memory_nodes
    WHERE agent_id = ${agentId}
      AND source LIKE ${`%/${fixtureId}`}
      AND status = 'active'
    ORDER BY id
  `);
  return (results.rows as Array<{ id: number }>).map((r) => r.id);
}

/**
 * Read resonance scores for a set of node IDs.
 */
export async function getResonanceScores(
  nodeIds: number[]
): Promise<Map<number, number>> {
  if (nodeIds.length === 0) return new Map();
  const idList = `{${nodeIds.join(",")}}`;
  const results = await db.execute(sql`
    SELECT id, resonance_score
    FROM memory_nodes
    WHERE id = ANY(${idList}::int[])
  `);
  const map = new Map<number, number>();
  for (const row of results.rows as Array<{ id: number; resonance_score: number }>) {
    map.set(row.id, Number(row.resonance_score));
  }
  return map;
}

/**
 * Check which node IDs are still active (not pruned/archived).
 */
export async function getActiveNodeIds(nodeIds: number[]): Promise<Set<number>> {
  if (nodeIds.length === 0) return new Set();
  const idList = `{${nodeIds.join(",")}}`;
  const results = await db.execute(sql`
    SELECT id FROM memory_nodes
    WHERE id = ANY(${idList}::int[])
      AND status = 'active'
  `);
  return new Set(
    (results.rows as Array<{ id: number }>).map((r) => r.id)
  );
}

/**
 * Count synapses between a set of node IDs.
 */
export async function countSynapses(
  nodeIds: number[]
): Promise<number> {
  if (nodeIds.length < 2) return 0;
  const idList = `{${nodeIds.join(",")}}`;
  const results = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM memory_synapses
    WHERE memory_a = ANY(${idList}::int[])
      AND memory_b = ANY(${idList}::int[])
  `);
  return Number((results.rows[0] as { cnt: string }).cnt);
}
