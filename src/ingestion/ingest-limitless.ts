import { readFileSync } from "fs";
import { basename } from "path";
import { db, schema } from "../db/index.js";
import { chunkText } from "./chunker.js";
import { embedTexts } from "./embeddings.js";
import { extractEntities, extractSemanticTags } from "./entities.js";
import { formSynapses } from "./synapse-formation.js";
import { eq, and } from "drizzle-orm";

/**
 * Ingest a Limitless transcript file.
 * Limitless exports are markdown with speaker labels and timestamps.
 */
export async function ingestLimitlessFile(
  agentId: number,
  filePath: string
): Promise<number> {
  const content = readFileSync(filePath, "utf-8");
  if (!content.trim()) return 0;

  // Clear previous ingestion
  const existing = await db
    .select({ id: schema.memoryNodes.id })
    .from(schema.memoryNodes)
    .where(
      and(
        eq(schema.memoryNodes.agentId, agentId),
        eq(schema.memoryNodes.source, filePath)
      )
    );

  if (existing.length > 0) {
    await db
      .delete(schema.memoryNodes)
      .where(
        and(
          eq(schema.memoryNodes.agentId, agentId),
          eq(schema.memoryNodes.source, filePath)
        )
      );
  }

  // Chunk the transcript
  const chunks = chunkText(content);
  console.log(
    `[limitless] ${basename(filePath)}: ${chunks.length} chunks`
  );

  const embeddings = await embedTexts(chunks.map((c) => c.text));

  const insertedIds: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const entities = await extractEntities(chunks[i].text);
    const tags = extractSemanticTags(chunks[i].text);

    const [inserted] = await db
      .insert(schema.memoryNodes)
      .values({
        agentId,
        content: chunks[i].text,
        source: filePath,
        sourceType: "limitless",
        chunkIndex: chunks[i].index,
        embedding: embeddings[i],
        entities,
        semanticTags: tags,
        priority: 3,
        resonanceScore: 3.0,
        status: "active",
      })
      .returning({ id: schema.memoryNodes.id });
    insertedIds.push(inserted.id);
  }

  await formSynapses(agentId, insertedIds);
  return insertedIds.length;
}
