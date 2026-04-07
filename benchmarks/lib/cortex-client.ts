/**
 * CORTEX Benchmark Client
 *
 * Interfaces with CORTEX's search, recall, and ingest APIs for benchmark evaluation.
 * Uses the database directly (not REST/MCP) for maximum throughput during bulk operations.
 */
import { db, schema, initDatabase } from "../../src/db/index.js";
import { sql, eq } from "drizzle-orm";
import { embedTexts, embedQuery } from "../../src/ingestion/embeddings.js";
import { chunkText } from "../../src/ingestion/chunker.js";
import { extractEntitiesSync, extractSemanticTags } from "../../src/ingestion/entities.js";
import { hippocampalEncode } from "../../src/hippocampus/index.js";
import { formSynapses } from "../../src/ingestion/synapse-formation.js";
import "dotenv/config";

export interface IngestResult {
  memoryIds: number[];
  chunks: number;
  duration: number;
}

export interface SearchResult {
  id: number;
  content: string;
  source: string | null;
  score: number;
  sessionId?: string;
}

/**
 * Initialize the benchmark environment.
 * Creates a dedicated benchmark agent to isolate from production data.
 */
export async function initBenchmark(benchmarkName: string): Promise<number> {
  await initDatabase();

  const agentExternalId = `benchmark-${benchmarkName}`;

  // Check if agent exists
  let [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.externalId, agentExternalId))
    .limit(1);

  if (!agent) {
    [agent] = await db
      .insert(schema.agents)
      .values({
        externalId: agentExternalId,
        name: `Benchmark: ${benchmarkName}`,
        ownerId: "benchmark",
      })
      .returning();
  }

  console.log(`[benchmark] Agent "${agentExternalId}" ready (id: ${agent.id})`);
  return agent.id;
}

/**
 * Clear all memories for a benchmark agent (clean slate between runs).
 */
export async function clearBenchmarkData(agentId: number): Promise<void> {
  // Single cascading delete — memory_nodes ON DELETE CASCADE handles synapses, hippocampal codes, valence
  await db.execute(sql`DELETE FROM memory_nodes WHERE agent_id = ${agentId}`);
}

/**
 * Ingest a conversation session into CORTEX.
 * Fast mode (default for benchmarks): skip hippocampal encoding + synapse formation.
 * Full mode: complete cognitive pipeline (slower, production-grade).
 */
export async function ingestSession(
  agentId: number,
  sessionId: string,
  content: string,
  source: string = "benchmark",
  fastMode: boolean = true
): Promise<IngestResult> {
  const start = Date.now();
  const chunks = chunkText(content);

  if (chunks.length === 0) {
    return { memoryIds: [], chunks: 0, duration: Date.now() - start };
  }

  const embeddings = await embedTexts(chunks.map((c) => c.text));

  // Batch insert all chunks at once (much faster than one-by-one)
  const values = chunks.map((chunk, i) => ({
    agentId,
    content: chunk.text,
    source: `${source}/${sessionId}`,
    sourceType: "benchmark" as const,
    chunkIndex: i,
    embedding: embeddings[i],
    entities: extractEntitiesSync(chunk.text),
    semanticTags: extractSemanticTags(chunk.text),
    priority: 2,
    resonanceScore: 5.0,
    noveltyScore: 0.5,
    status: "active" as const,
  }));

  const inserted = await db
    .insert(schema.memoryNodes)
    .values(values)
    .returning({ id: schema.memoryNodes.id });

  const insertedIds = inserted.map((r) => r.id);

  // Full mode: hippocampal encoding + synapse formation (slow but production-grade)
  if (!fastMode) {
    for (let i = 0; i < insertedIds.length; i++) {
      try {
        await hippocampalEncode(agentId, embeddings[i], 2);
      } catch {
        // Skip encoding errors
      }
    }
    if (insertedIds.length > 1) {
      try {
        await formSynapses(agentId, insertedIds, embeddings);
      } catch {
        // Non-critical
      }
    }
  }

  return {
    memoryIds: insertedIds,
    chunks: chunks.length,
    duration: Date.now() - start,
  };
}

/**
 * Search CORTEX and return ranked results.
 * Uses the same hybrid 7-factor scoring as production.
 */
export async function search(
  agentId: number,
  query: string,
  topK: number = 5
): Promise<SearchResult[]> {
  const queryEmbedding = await embedQuery(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    WITH vector_scores AS (
      SELECT
        id,
        content,
        source,
        1 - (embedding <=> ${embeddingStr}::vector) AS cosine_sim,
        CASE
          WHEN content ILIKE ${"%" + query + "%"} THEN 1.0
          ELSE 0.0
        END AS text_match,
        EXP(-0.023 * EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400) AS recency,
        LEAST(resonance_score / 10.0, 1.0) AS norm_resonance,
        CASE priority
          WHEN 0 THEN 1.0
          WHEN 1 THEN 0.8
          WHEN 2 THEN 0.5
          WHEN 3 THEN 0.3
          WHEN 4 THEN 0.1
          ELSE 0.5
        END AS priority_boost
      FROM memory_nodes
      WHERE agent_id = ${agentId}
        AND status = 'active'
        AND embedding IS NOT NULL
    )
    SELECT id, content, source,
      (0.50 * cosine_sim
     + 0.20 * text_match
     + 0.15 * recency
     + 0.10 * norm_resonance
     + 0.05 * priority_boost) AS hybrid_score
    FROM vector_scores
    ORDER BY hybrid_score DESC
    LIMIT ${topK}
  `);

  return (results.rows as Array<{
    id: number;
    content: string;
    source: string | null;
    hybrid_score: number;
  }>).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    score: Number(r.hybrid_score),
    sessionId: r.source?.split("/").pop(),
  }));
}

/**
 * Extract the session ID from a source path.
 */
export function extractSessionId(source: string | null): string | null {
  if (!source) return null;
  return source.split("/").pop() || null;
}
