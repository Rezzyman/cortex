/**
 * Procedural Memory Layer
 *
 * Stores and retrieves skill/habit/workflow knowledge separately from
 * episodic memory. Procedural memories:
 *   - Don't decay with time (skills persist)
 *   - Strengthen with repeated execution
 *   - Are retrieved by task context, not just semantic similarity
 *   - Can be refined/versioned as the agent improves
 */

import { db, schema } from "../db/index.js";
import { eq, sql, and, ilike, or } from "drizzle-orm";
import { embedTexts, embedQuery } from "../ingestion/embeddings.js";
import type {
  ProceduralType,
  ProficiencyLevel,
  ProceduralMemory,
  ProceduralMatch,
} from "./types.js";

export type { ProceduralType, ProficiencyLevel, ProceduralMemory, ProceduralMatch };

// ─── Store ──────────────────────────────────────────────

interface CreateProceduralInput {
  agentId: number;
  name: string;
  description: string;
  proceduralType: ProceduralType;
  triggerContext: string;
  steps: string[];
  domainTags: string[];
  sourceMemoryIds?: number[];
}

/**
 * Store a new procedural memory (skill, workflow, pattern, preference, heuristic).
 */
export async function storeProcedural(
  input: CreateProceduralInput
): Promise<number> {
  // Embed the combined text for semantic retrieval
  const textForEmbedding = `${input.name}. ${input.triggerContext}. ${input.description}. ${input.steps.join(". ")}`;
  const [embedding] = await embedTexts([textForEmbedding]);

  const [inserted] = await db
    .insert(schema.proceduralMemories)
    .values({
      agentId: input.agentId,
      name: input.name,
      description: input.description,
      proceduralType: input.proceduralType,
      triggerContext: input.triggerContext,
      steps: input.steps,
      domainTags: input.domainTags,
      sourceMemoryIds: input.sourceMemoryIds || [],
      embedding,
      proficiency: "novice",
      executionCount: 0,
      successCount: 0,
      successRate: 0,
      version: 1,
    })
    .returning({ id: schema.proceduralMemories.id });

  console.log(
    `[procedural] Stored: "${input.name}" (${input.proceduralType}) → #${inserted.id}`
  );

  return inserted.id;
}

// ─── Retrieve ───────────────────────────────────────────

/**
 * Retrieve relevant procedural memories for a task context.
 * Uses three retrieval strategies:
 *   1. Trigger match: does the task context match a known trigger?
 *   2. Domain match: do the domain tags overlap?
 *   3. Semantic match: cosine similarity on the embedded description
 */
export async function retrieveProcedural(
  agentId: number,
  taskContext: string,
  limit: number = 5
): Promise<ProceduralMatch[]> {
  const queryEmbedding = await embedQuery(taskContext);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    SELECT
      id, name, description, procedural_type, trigger_context,
      steps, proficiency, execution_count, success_count, success_rate,
      domain_tags, source_memory_ids, version,
      1 - (embedding <=> ${embeddingStr}::vector) AS cosine_sim,
      CASE WHEN trigger_context ILIKE ${"%" + taskContext.slice(0, 80) + "%"} THEN 1.0 ELSE 0.0 END AS trigger_match
    FROM procedural_memories
    WHERE agent_id = ${agentId}
      AND status = 'active'
      AND embedding IS NOT NULL
    ORDER BY
      trigger_match DESC,
      cosine_sim DESC
    LIMIT ${limit}
  `);

  return (
    results.rows as Array<{
      id: number;
      name: string;
      description: string;
      procedural_type: ProceduralType;
      trigger_context: string;
      steps: string[];
      proficiency: ProficiencyLevel;
      execution_count: number;
      success_count: number;
      success_rate: number;
      domain_tags: string[];
      source_memory_ids: number[];
      version: number;
      cosine_sim: number;
      trigger_match: number;
    }>
  ).map((row) => {
    const matchType =
      row.trigger_match > 0
        ? "trigger"
        : row.cosine_sim > 0.7
        ? "semantic"
        : "domain";

    return {
      memory: {
        id: row.id,
        agentId,
        name: row.name,
        description: row.description,
        proceduralType: row.procedural_type,
        triggerContext: row.trigger_context,
        steps: row.steps || [],
        proficiency: row.proficiency,
        executionCount: row.execution_count,
        successCount: row.success_count,
        successRate: row.success_rate,
        domainTags: row.domain_tags || [],
        sourceMemoryIds: row.source_memory_ids || [],
        version: row.version,
      },
      relevanceScore:
        row.trigger_match > 0
          ? 1.0
          : Number(row.cosine_sim),
      matchType: matchType as "trigger" | "domain" | "semantic",
    };
  });
}

// ─── Execute (Record Outcome) ───────────────────────────

/**
 * Record that a procedural memory was executed and its outcome.
 * This is how skills improve: repeated execution with feedback.
 */
export async function recordExecution(
  proceduralId: number,
  success: boolean
): Promise<{ proficiency: ProficiencyLevel; successRate: number }> {
  // Increment counts
  await db.execute(sql`
    UPDATE procedural_memories
    SET execution_count = execution_count + 1,
        success_count = success_count + ${success ? 1 : 0},
        success_rate = (success_count + ${success ? 1 : 0})::real / (execution_count + 1)::real,
        last_executed_at = NOW(),
        updated_at = NOW()
    WHERE id = ${proceduralId}
  `);

  // Check if proficiency should be upgraded
  const [current] = (
    await db.execute(sql`
      SELECT execution_count, success_count, success_rate, proficiency
      FROM procedural_memories WHERE id = ${proceduralId}
    `)
  ).rows as Array<{
    execution_count: number;
    success_count: number;
    success_rate: number;
    proficiency: ProficiencyLevel;
  }>;

  if (!current) {
    return { proficiency: "novice", successRate: 0 };
  }

  // Proficiency advancement rules
  let newProficiency = current.proficiency;
  if (
    current.execution_count >= 20 &&
    current.success_rate >= 0.9
  ) {
    newProficiency = "expert";
  } else if (
    current.execution_count >= 10 &&
    current.success_rate >= 0.8
  ) {
    newProficiency = "proficient";
  } else if (
    current.execution_count >= 3 &&
    current.success_rate >= 0.6
  ) {
    newProficiency = "competent";
  }

  if (newProficiency !== current.proficiency) {
    await db.execute(sql`
      UPDATE procedural_memories
      SET proficiency = ${newProficiency}
      WHERE id = ${proceduralId}
    `);
    console.log(
      `[procedural] #${proceduralId} proficiency: ${current.proficiency} → ${newProficiency}`
    );
  }

  return { proficiency: newProficiency, successRate: current.success_rate };
}

// ─── Refine ─────────────────────────────────────────────

/**
 * Refine a procedural memory with updated steps or description.
 * Increments version and re-embeds.
 */
export async function refineProcedural(
  proceduralId: number,
  updates: {
    description?: string;
    steps?: string[];
    triggerContext?: string;
    domainTags?: string[];
  }
): Promise<number> {
  // Get current state
  const [current] = (
    await db.execute(sql`
      SELECT name, description, trigger_context, steps, domain_tags, version
      FROM procedural_memories WHERE id = ${proceduralId}
    `)
  ).rows as Array<{
    name: string;
    description: string;
    trigger_context: string;
    steps: string[];
    domain_tags: string[];
    version: number;
  }>;

  if (!current) throw new Error(`Procedural memory #${proceduralId} not found`);

  const newDesc = updates.description || current.description;
  const newSteps = updates.steps || current.steps;
  const newTrigger = updates.triggerContext || current.trigger_context;
  const newTags = updates.domainTags || current.domain_tags;
  const newVersion = current.version + 1;

  // Re-embed with updated content
  const textForEmbedding = `${current.name}. ${newTrigger}. ${newDesc}. ${newSteps.join(". ")}`;
  const [embedding] = await embedTexts([textForEmbedding]);

  await db.execute(sql`
    UPDATE procedural_memories
    SET description = ${newDesc},
        steps = ${newSteps}::text[],
        trigger_context = ${newTrigger},
        domain_tags = ${newTags}::text[],
        embedding = ${`[${embedding.join(",")}]`}::vector,
        version = ${newVersion},
        updated_at = NOW()
    WHERE id = ${proceduralId}
  `);

  console.log(`[procedural] #${proceduralId} refined → v${newVersion}`);
  return newVersion;
}
