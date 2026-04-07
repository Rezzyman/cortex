import { Router, Request, Response } from "express";
import { db, schema } from "../db/index.js";
import {
  storeProcedural,
  retrieveProcedural,
  recordExecution,
  refineProcedural,
} from "../procedural/index.js";
import { eq, sql } from "drizzle-orm";

const router = Router();

/**
 * GET /api/v1/procedural?agentId=<id>
 * List all procedural memories for an agent.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string;

    if (!agentId) {
      res.status(400).json({ error: "agentId query parameter required" });
      return;
    }

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.externalId, agentId));
    if (!agent) { res.status(404).json({ error: `Agent '${agentId}' not found` }); return; }

    const results = await db.execute(sql`
      SELECT id, name, description, procedural_type, trigger_context,
             steps, proficiency, execution_count, success_count, success_rate,
             domain_tags, source_memory_ids, version
      FROM procedural_memories
      WHERE agent_id = ${agent.id}
        AND status = 'active'
      ORDER BY name ASC
    `);

    const skills = (results.rows as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
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
    }));

    res.json({ agentId, count: skills.length, skills });
  } catch (err) {
    console.error("[procedural] Error:", err);
    res.status(500).json({ error: "Failed to list procedural memories" });
  }
});

/**
 * POST /api/v1/procedural
 * Store a new procedural memory (skill, workflow, pattern, etc.)
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { agentId, name, description, proceduralType, triggerContext, steps, domainTags, sourceMemoryIds } = req.body;

    if (!agentId || !name || !description || !proceduralType || !triggerContext) {
      res.status(400).json({ error: "agentId, name, description, proceduralType, and triggerContext required" });
      return;
    }

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.externalId, agentId));
    if (!agent) { res.status(404).json({ error: `Agent '${agentId}' not found` }); return; }

    const id = await storeProcedural({
      agentId: agent.id, name, description, proceduralType, triggerContext,
      steps: steps || [], domainTags: domainTags || [], sourceMemoryIds,
    });

    res.json({ id, name, proceduralType });
  } catch (err) {
    console.error("[procedural] Error:", err);
    res.status(500).json({ error: "Failed to store procedural memory" });
  }
});

/**
 * POST /api/v1/procedural/retrieve
 * Retrieve relevant procedural memories for a task context.
 */
router.post("/retrieve", async (req: Request, res: Response) => {
  try {
    const { agentId, taskContext, limit = 5 } = req.body;

    if (!agentId || !taskContext) {
      res.status(400).json({ error: "agentId and taskContext required" });
      return;
    }

    const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.externalId, agentId));
    if (!agent) { res.status(404).json({ error: `Agent '${agentId}' not found` }); return; }

    const results = await retrieveProcedural(agent.id, taskContext, limit);
    res.json({ agentId, taskContext, results });
  } catch (err) {
    console.error("[procedural] Error:", err);
    res.status(500).json({ error: "Failed to retrieve procedural memories" });
  }
});

/**
 * POST /api/v1/procedural/:id/execute
 * Record execution outcome for a procedural memory.
 */
router.post("/:id/execute", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { success } = req.body;

    if (typeof success !== "boolean") {
      res.status(400).json({ error: "success (boolean) required" });
      return;
    }

    const result = await recordExecution(id, success);
    res.json({ proceduralId: id, ...result });
  } catch (err) {
    console.error("[procedural] Error:", err);
    res.status(500).json({ error: "Failed to record execution" });
  }
});

/**
 * PATCH /api/v1/procedural/:id
 * Refine a procedural memory with updated info.
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { description, steps, triggerContext, domainTags } = req.body;

    const newVersion = await refineProcedural(id, { description, steps, triggerContext, domainTags });
    res.json({ proceduralId: id, version: newVersion });
  } catch (err) {
    console.error("[procedural] Error:", err);
    res.status(500).json({ error: "Failed to refine procedural memory" });
  }
});

export { router as proceduralRouter };
