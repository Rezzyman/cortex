/**
 * CORTEX V2 — Meta-Cognition: Inner Monologue
 *
 * Stores observations, reflections, and self-directed thoughts
 * as P2 cognitive artifacts.
 */
import { db, schema } from "../db/index.js";
import { eq, desc, and, gte } from "drizzle-orm";

export async function writeInnerMonologue(
  agentId: number,
  content: string,
  context?: string
): Promise<number> {
  const [artifact] = await db
    .insert(schema.cognitiveArtifacts)
    .values({
      agentId,
      artifactType: "inner_monologue",
      content: {
        thought: content,
        context: context || null,
        timestamp: new Date().toISOString(),
      },
      resonanceScore: 4.0,
    })
    .returning({ id: schema.cognitiveArtifacts.id });

  return artifact.id;
}

export async function getRecentMonologue(agentId: number, hours = 24): Promise<Array<{
  id: number;
  thought: string;
  context: string | null;
  timestamp: string;
  createdAt: Date;
}>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const artifacts = await db
    .select()
    .from(schema.cognitiveArtifacts)
    .where(and(
      eq(schema.cognitiveArtifacts.agentId, agentId),
      eq(schema.cognitiveArtifacts.artifactType, "inner_monologue"),
      gte(schema.cognitiveArtifacts.createdAt, since)
    ))
    .orderBy(desc(schema.cognitiveArtifacts.createdAt))
    .limit(50);

  return artifacts.map(a => {
    const content = a.content as { thought: string; context: string | null; timestamp: string };
    return {
      id: a.id,
      thought: content.thought,
      context: content.context,
      timestamp: content.timestamp,
      createdAt: a.createdAt,
    };
  });
}

export function formatMonologue(entries: Awaited<ReturnType<typeof getRecentMonologue>>): string {
  if (entries.length === 0) return "No inner monologue entries found.\n";

  let output = `# Inner Monologue (${entries.length} entries)\n\n`;
  for (const e of entries) {
    output += `## ${e.timestamp}\n`;
    output += `${e.thought}\n`;
    if (e.context) output += `*Context: ${e.context}*\n`;
    output += "\n";
  }
  return output;
}
