import { Router, Request, Response } from "express";
import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { runDreamCycle } from "../dream/dream-cycle.js";

const router = Router();

/**
 * POST /api/v1/dream
 * Trigger a dream cycle for an agent.
 *
 * Body: { agentId: string, cycleType?: "full" | "sws_only" | "rem_only" }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { agentId, cycleType = "full" } = req.body;

    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const agentResult = await db.execute(sql`
      SELECT id, external_id, name FROM agents WHERE external_id = ${agentId}
    `);

    if (agentResult.rows.length === 0) {
      res.status(404).json({ error: `Agent '${agentId}' not found` });
      return;
    }

    const agent = agentResult.rows[0] as { id: number; external_id: string; name: string };

    console.log(`[dream-api] Starting ${cycleType} dream cycle for ${agent.external_id}`);
    const stats = await runDreamCycle(agent.id, cycleType);

    res.json({
      agentId: agent.external_id,
      cycleType,
      stats,
      status: "completed",
    });
  } catch (err) {
    console.error("[dream-api] Error:", err);
    res.status(500).json({ error: "Dream cycle failed" });
  }
});

export { router as dreamRouter };
