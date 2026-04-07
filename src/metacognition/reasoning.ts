/**
 * CORTEX V2 — Meta-Cognition: Reasoning Traces
 *
 * Stores structured traces for significant decisions,
 * including options considered, rationale, and confidence.
 */
import { db, schema } from "../db/index.js";
import { eq, desc, and } from "drizzle-orm";

interface ReasoningTrace {
  decision: string;
  context: string;
  options?: Array<{ name: string; pros: string[]; cons: string[] }>;
  chosen: string;
  rationale: string;
  confidence: number;
  reversible?: boolean;
  impacts?: string[];
}

export async function storeReasoningTrace(agentId: number, trace: ReasoningTrace): Promise<number> {
  const [artifact] = await db
    .insert(schema.cognitiveArtifacts)
    .values({
      agentId,
      artifactType: "reasoning_trace",
      content: {
        ...trace,
        timestamp: new Date().toISOString(),
      },
      resonanceScore: Math.max(5.0, trace.confidence * 8),
    })
    .returning({ id: schema.cognitiveArtifacts.id });

  return artifact.id;
}

export async function getRecentTraces(agentId: number, limit = 10): Promise<Array<{
  id: number;
  content: ReasoningTrace & { timestamp: string };
  createdAt: Date;
}>> {
  const artifacts = await db
    .select()
    .from(schema.cognitiveArtifacts)
    .where(and(
      eq(schema.cognitiveArtifacts.agentId, agentId),
      eq(schema.cognitiveArtifacts.artifactType, "reasoning_trace")
    ))
    .orderBy(desc(schema.cognitiveArtifacts.createdAt))
    .limit(limit);

  return artifacts.map(a => ({
    id: a.id,
    content: a.content as ReasoningTrace & { timestamp: string },
    createdAt: a.createdAt,
  }));
}

export function formatReasoningTrace(trace: ReasoningTrace & { timestamp?: string }, id?: number): string {
  let output = `# Reasoning Trace${id ? ` #${id}` : ""}\n`;
  if (trace.timestamp) output += `*${trace.timestamp}*\n\n`;
  output += `**Decision:** ${trace.decision}\n`;
  output += `**Context:** ${trace.context}\n`;
  output += `**Chosen:** ${trace.chosen}\n`;
  output += `**Rationale:** ${trace.rationale}\n`;
  output += `**Confidence:** ${(trace.confidence * 100).toFixed(0)}%\n`;
  if (trace.reversible !== undefined) output += `**Reversible:** ${trace.reversible ? "yes" : "no"}\n`;

  if (trace.options && trace.options.length > 0) {
    output += `\n## Options Considered\n`;
    for (const opt of trace.options) {
      output += `### ${opt.name}\n`;
      if (opt.pros.length > 0) output += `Pros: ${opt.pros.join(", ")}\n`;
      if (opt.cons.length > 0) output += `Cons: ${opt.cons.join(", ")}\n`;
    }
  }

  if (trace.impacts && trace.impacts.length > 0) {
    output += `\n## Impacts\n`;
    for (const i of trace.impacts) output += `- ${i}\n`;
  }

  return output;
}
