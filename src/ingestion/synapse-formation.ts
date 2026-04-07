import { db, schema } from "../db/index.js";
import { eq, and, sql, inArray, or, ne } from "drizzle-orm";

/**
 * Automatic synapse formation after ingestion.
 *
 * Three connection types:
 * 1. Semantic: cosine similarity > 0.85 between node embeddings
 * 2. Entity: shared entity mentions between nodes
 * 3. Temporal: same source file (co-located content)
 */
export async function formSynapses(
  agentId: number,
  newNodeIds: number[]
): Promise<number> {
  if (newNodeIds.length === 0) return 0;

  let synapsesCreated = 0;

  // 1. Semantic synapses — find high-similarity pairs via pgvector
  //    For each new node, find existing nodes with cosine similarity > 0.85
  for (const nodeId of newNodeIds) {
    try {
      const results = await db.execute(sql`
        SELECT b.id, 1 - (a.embedding <=> b.embedding) AS similarity
        FROM memory_nodes a, memory_nodes b
        WHERE a.id = ${nodeId}
          AND b.id != ${nodeId}
          AND b.agent_id = ${agentId}
          AND b.status = 'active'
          AND b.embedding IS NOT NULL
          AND a.embedding IS NOT NULL
          AND 1 - (a.embedding <=> b.embedding) > 0.85
        ORDER BY similarity DESC
        LIMIT 10
      `);

      for (const row of results.rows as Array<{
        id: number;
        similarity: number;
      }>) {
        const [memA, memB] = [
          Math.min(nodeId, row.id),
          Math.max(nodeId, row.id),
        ];

        await db
          .insert(schema.memorySynapses)
          .values({
            memoryA: memA,
            memoryB: memB,
            connectionType: "semantic",
            connectionStrength: Math.min(row.similarity, 1.0),
            decayRate: 0.005,
          })
          .onConflictDoUpdate({
            target: [
              schema.memorySynapses.memoryA,
              schema.memorySynapses.memoryB,
              schema.memorySynapses.connectionType,
            ],
            set: {
              connectionStrength: sql`GREATEST(memory_synapses.connection_strength, ${Math.min(row.similarity, 1.0)})`,
              lastActivatedAt: sql`NOW()`,
            },
          });
        synapsesCreated++;
      }
    } catch (err) {
      // Silently skip if embedding is null or vector ops fail
      console.error(`[synapses] Semantic error for node ${nodeId}:`, err);
    }
  }

  // 2. Entity-based synapses — shared entity mentions
  const newNodes = await db
    .select({
      id: schema.memoryNodes.id,
      entities: schema.memoryNodes.entities,
    })
    .from(schema.memoryNodes)
    .where(inArray(schema.memoryNodes.id, newNodeIds));

  for (const node of newNodes) {
    if (!node.entities || node.entities.length === 0) continue;

    for (const entity of node.entities) {
      // Find other nodes mentioning the same entity
      const matches = await db.execute(sql`
        SELECT id FROM memory_nodes
        WHERE agent_id = ${agentId}
          AND id != ${node.id}
          AND status = 'active'
          AND ${entity} = ANY(entities)
        LIMIT 20
      `);

      for (const match of matches.rows as Array<{ id: number }>) {
        const [memA, memB] = [
          Math.min(node.id, match.id),
          Math.max(node.id, match.id),
        ];

        await db
          .insert(schema.memorySynapses)
          .values({
            memoryA: memA,
            memoryB: memB,
            connectionType: "entity_shared",
            connectionStrength: 0.6,
            decayRate: 0.01,
          })
          .onConflictDoUpdate({
            target: [
              schema.memorySynapses.memoryA,
              schema.memorySynapses.memoryB,
              schema.memorySynapses.connectionType,
            ],
            set: {
              activationCount: sql`memory_synapses.activation_count + 1`,
              lastActivatedAt: sql`NOW()`,
            },
          });
        synapsesCreated++;
      }
    }
  }

  // 3. Temporal synapses — nodes from the same source file
  //    (co-located content is likely related)
  const sources = await db
    .select({
      id: schema.memoryNodes.id,
      source: schema.memoryNodes.source,
    })
    .from(schema.memoryNodes)
    .where(inArray(schema.memoryNodes.id, newNodeIds));

  for (const node of sources) {
    if (!node.source) continue;

    const siblings = await db
      .select({ id: schema.memoryNodes.id })
      .from(schema.memoryNodes)
      .where(
        and(
          eq(schema.memoryNodes.agentId, agentId),
          eq(schema.memoryNodes.source, node.source),
          ne(schema.memoryNodes.id, node.id)
        )
      )
      .limit(5); // Only link nearby chunks

    for (const sibling of siblings) {
      const [memA, memB] = [
        Math.min(node.id, sibling.id),
        Math.max(node.id, sibling.id),
      ];

      await db
        .insert(schema.memorySynapses)
        .values({
          memoryA: memA,
          memoryB: memB,
          connectionType: "temporal",
          connectionStrength: 0.4,
          decayRate: 0.02,
        })
        .onConflictDoUpdate({
          target: [
            schema.memorySynapses.memoryA,
            schema.memorySynapses.memoryB,
            schema.memorySynapses.connectionType,
          ],
          set: {
            lastActivatedAt: sql`NOW()`,
          },
        });
      synapsesCreated++;
    }
  }

  if (synapsesCreated > 0) {
    console.log(
      `[synapses] Formed ${synapsesCreated} synapses for ${newNodeIds.length} new nodes`
    );
  }

  return synapsesCreated;
}
