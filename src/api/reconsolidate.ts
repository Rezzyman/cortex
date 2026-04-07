import { Router, Request, Response } from "express";
import { db, schema } from "../db/index.js";
import { reconsolidate, getLabileMemories } from "../reconsolidation/index.js";
import { eq } from "drizzle-orm";

const router = Router();

/**
 * POST /api/v1/reconsolidate
 * Body: { agentId, memoryId, newContent, reason? }
 *
 * Update a recalled memory during its labile window.
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { agentId, memoryId, newContent, reason } = req.body;

    if (!agentId || !memoryId || !newContent) {
      res
        .status(400)
        .json({ error: "agentId, memoryId, and newContent required" });
      return;
    }

    const result = await reconsolidate(memoryId, newContent, reason);

    if (result.status === "not_found") {
      res.status(404).json({ error: "Memory not found", ...result });
      return;
    }

    if (result.status === "not_labile" || result.status === "window_closed") {
      res.status(409).json({
        error:
          result.status === "not_labile"
            ? "Memory has not been recalled recently. Recall it first."
            : "Labile window has closed. Recall the memory again to reopen.",
        ...result,
      });
      return;
    }

    res.json(result);
  } catch (err) {
    console.error("[reconsolidate] Error:", err);
    res.status(500).json({ error: "Reconsolidation failed" });
  }
});

/**
 * GET /api/v1/reconsolidate/labile?agentId=xxx
 *
 * Get all currently labile (modifiable) memories for an agent.
 */
router.get("/labile", async (req: Request, res: Response) => {
  try {
    const agentExternalId = req.query.agentId as string;
    if (!agentExternalId) {
      res.status(400).json({ error: "agentId query param required" });
      return;
    }

    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.externalId, agentExternalId));

    if (!agent) {
      res.status(404).json({ error: `Agent '${agentExternalId}' not found` });
      return;
    }

    const labile = await getLabileMemories(agent.id);
    res.json({ agentId: agentExternalId, labileMemories: labile });
  } catch (err) {
    console.error("[reconsolidate] Error:", err);
    res.status(500).json({ error: "Failed to fetch labile memories" });
  }
});

export { router as reconsolidateRouter };
