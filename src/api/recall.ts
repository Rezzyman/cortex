import { Router, Request, Response } from "express";
import { db, schema } from "../db/index.js";
import { hybridSearch } from "./search.js";
import { countTokens } from "../ingestion/chunker.js";
import { eq, sql, desc } from "drizzle-orm";

const router = Router();

interface RecallResult {
  context: string;
  memories: Array<{
    id: number;
    content: string;
    source: string | null;
    score: number;
  }>;
  artifacts: Array<{
    id: number;
    type: string;
    content: unknown;
  }>;
  tokenCount: number;
  tokenBudget: number;
}

/**
 * Token-budget-aware context retrieval.
 * Builds a context window by greedily selecting highest-scored memories
 * until the token budget is exhausted.
 *
 * POST /api/v1/recall
 * Body: { query, agentId, tokenBudget? }
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { query, agentId, tokenBudget = 4000 } = req.body;

    if (!query || !agentId) {
      res.status(400).json({ error: "query and agentId required" });
      return;
    }

    // Resolve agent
    const [agent] = await db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.externalId, agentId));

    if (!agent) {
      res.status(404).json({ error: `Agent '${agentId}' not found` });
      return;
    }

    // Fetch more results than we might need, then trim to budget
    const searchResults = await hybridSearch(agent.id, query, 50);

    // Also fetch recent cognitive artifacts
    const recentArtifacts = await db
      .select()
      .from(schema.cognitiveArtifacts)
      .where(eq(schema.cognitiveArtifacts.agentId, agent.id))
      .orderBy(desc(schema.cognitiveArtifacts.createdAt))
      .limit(5);

    // Build context within token budget
    const selectedMemories: RecallResult["memories"] = [];
    const selectedArtifacts: RecallResult["artifacts"] = [];
    let currentTokens = 0;

    // Reserve ~20% of budget for artifacts
    const memoryBudget = Math.floor(tokenBudget * 0.8);
    const artifactBudget = tokenBudget - memoryBudget;

    // Fill memory context
    for (const result of searchResults) {
      const tokens = countTokens(result.content);
      if (currentTokens + tokens > memoryBudget) {
        // Try to fit a truncated version if it's high-scoring
        if (result.score > 0.6 && currentTokens + 100 <= memoryBudget) {
          const truncated = result.content.slice(0, 400) + "...";
          const truncTokens = countTokens(truncated);
          if (currentTokens + truncTokens <= memoryBudget) {
            selectedMemories.push({
              id: result.id,
              content: truncated,
              source: result.source,
              score: result.score,
            });
            currentTokens += truncTokens;
          }
        }
        continue;
      }
      selectedMemories.push({
        id: result.id,
        content: result.content,
        source: result.source,
        score: result.score,
      });
      currentTokens += tokens;
    }

    // Fill artifact context
    let artifactTokens = 0;
    for (const artifact of recentArtifacts) {
      const content = JSON.stringify(artifact.content);
      const tokens = countTokens(content);
      if (artifactTokens + tokens > artifactBudget) continue;
      selectedArtifacts.push({
        id: artifact.id,
        type: artifact.artifactType,
        content: artifact.content,
      });
      artifactTokens += tokens;
    }

    // Format context block
    const contextParts: string[] = [];

    if (selectedMemories.length > 0) {
      contextParts.push("## Relevant Memories\n");
      for (const mem of selectedMemories) {
        const sourceLabel = mem.source
          ? ` [${mem.source.split("/").pop()}]`
          : "";
        contextParts.push(
          `### Memory #${mem.id}${sourceLabel} (score: ${mem.score.toFixed(3)})\n${mem.content}\n`
        );
      }
    }

    if (selectedArtifacts.length > 0) {
      contextParts.push("## Recent Cognitive Artifacts\n");
      for (const art of selectedArtifacts) {
        contextParts.push(
          `### ${art.type} #${art.id}\n${JSON.stringify(art.content, null, 2)}\n`
        );
      }
    }

    const context = contextParts.join("\n");

    res.json({
      query,
      agentId,
      context,
      memories: selectedMemories,
      artifacts: selectedArtifacts,
      tokenCount: currentTokens + artifactTokens,
      tokenBudget,
    } satisfies RecallResult & { query: string; agentId: string });
  } catch (err) {
    console.error("[recall] Error:", err);
    res.status(500).json({ error: "Recall failed" });
  }
});

export { router as recallRouter };
