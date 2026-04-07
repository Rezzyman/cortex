/**
 * CORTEX V2 — Social Intelligence: Relationship Graph
 *
 * Structured profiles for key contacts with communication prefs,
 * open items, and contact freshness tracking.
 */
import { db, schema } from "../db/index.js";
import { eq, sql, desc, and, ilike } from "drizzle-orm";

interface RelationshipUpdate {
  personEmail?: string;
  relationshipType?: string;
  lastContact?: Date | "now";
  contactFrequency?: string;
  importanceScore?: number;
  personalityModel?: Record<string, unknown>;
  communicationPrefs?: Record<string, unknown>;
  notes?: string;
}

export async function getRelationship(agentId: number, name: string): Promise<typeof schema.relationshipGraph.$inferSelect | null> {
  // Try exact match first, then fuzzy
  let results = await db
    .select()
    .from(schema.relationshipGraph)
    .where(and(
      eq(schema.relationshipGraph.agentId, agentId),
      eq(schema.relationshipGraph.personName, name)
    ))
    .limit(1);

  if (results.length === 0) {
    // Try case-insensitive partial match
    results = await db
      .select()
      .from(schema.relationshipGraph)
      .where(and(
        eq(schema.relationshipGraph.agentId, agentId),
        ilike(schema.relationshipGraph.personName, `%${name}%`)
      ))
      .limit(1);
  }

  return results[0] || null;
}

export async function listRelationships(agentId: number, filters?: {
  type?: string;
  overdueOnly?: boolean;
}): Promise<Array<typeof schema.relationshipGraph.$inferSelect>> {
  if (filters?.overdueOnly) {
    const results = await db.execute(sql`
      SELECT *
      FROM relationship_graph
      WHERE agent_id = ${agentId}
        AND last_contact IS NOT NULL
        AND contact_frequency != 'as_needed'
        AND (
          (contact_frequency = 'daily' AND last_contact < NOW() - INTERVAL '2 days')
          OR (contact_frequency = 'weekly' AND last_contact < NOW() - INTERVAL '10 days')
          OR (contact_frequency = 'biweekly' AND last_contact < NOW() - INTERVAL '18 days')
          OR (contact_frequency = 'monthly' AND last_contact < NOW() - INTERVAL '35 days')
          OR (contact_frequency = 'quarterly' AND last_contact < NOW() - INTERVAL '100 days')
        )
      ORDER BY importance_score DESC
    `);
    return results.rows as Array<typeof schema.relationshipGraph.$inferSelect>;
  }

  let query = db
    .select()
    .from(schema.relationshipGraph)
    .where(eq(schema.relationshipGraph.agentId, agentId))
    .orderBy(desc(schema.relationshipGraph.importanceScore));

  const allResults = await query;

  if (filters?.type) {
    return allResults.filter(r => r.relationshipType === filters.type);
  }

  return allResults;
}

export async function updateRelationship(agentId: number, name: string, updates: RelationshipUpdate): Promise<typeof schema.relationshipGraph.$inferSelect> {
  const existing = await getRelationship(agentId, name);

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.personEmail !== undefined) values.personEmail = updates.personEmail;
  if (updates.relationshipType !== undefined) values.relationshipType = updates.relationshipType;
  if (updates.lastContact !== undefined) values.lastContact = updates.lastContact === "now" ? new Date() : updates.lastContact;
  if (updates.contactFrequency !== undefined) values.contactFrequency = updates.contactFrequency;
  if (updates.importanceScore !== undefined) values.importanceScore = updates.importanceScore;
  if (updates.personalityModel !== undefined) values.personalityModel = updates.personalityModel;
  if (updates.communicationPrefs !== undefined) values.communicationPrefs = updates.communicationPrefs;
  if (updates.notes !== undefined) values.notes = updates.notes;

  if (existing) {
    const [updated] = await db
      .update(schema.relationshipGraph)
      .set(values)
      .where(eq(schema.relationshipGraph.id, existing.id))
      .returning();
    return updated;
  } else {
    // Create new entry
    const [inserted] = await db
      .insert(schema.relationshipGraph)
      .values({
        agentId,
        personName: name,
        ...values,
      } as typeof schema.relationshipGraph.$inferInsert)
      .returning();
    return inserted;
  }
}

export async function addOpenItem(agentId: number, personName: string, item: string): Promise<void> {
  const rel = await getRelationship(agentId, personName);
  if (!rel) throw new Error(`Relationship not found: ${personName}`);

  const items = (rel.openItems as Array<{ text: string; done: boolean; addedAt: string }>) || [];
  items.push({ text: item, done: false, addedAt: new Date().toISOString() });

  await db
    .update(schema.relationshipGraph)
    .set({ openItems: items, updatedAt: new Date() })
    .where(eq(schema.relationshipGraph.id, rel.id));
}

export async function resolveOpenItem(agentId: number, personName: string, itemIndex: number): Promise<void> {
  const rel = await getRelationship(agentId, personName);
  if (!rel) throw new Error(`Relationship not found: ${personName}`);

  const items = (rel.openItems as Array<{ text: string; done: boolean; addedAt: string }>) || [];
  if (itemIndex >= 0 && itemIndex < items.length) {
    items[itemIndex].done = true;
  }

  await db
    .update(schema.relationshipGraph)
    .set({ openItems: items, updatedAt: new Date() })
    .where(eq(schema.relationshipGraph.id, rel.id));
}

export async function getOverdueContacts(agentId: number): Promise<Array<typeof schema.relationshipGraph.$inferSelect>> {
  return listRelationships(agentId, { overdueOnly: true });
}

export function formatRelationship(rel: typeof schema.relationshipGraph.$inferSelect): string {
  let output = `# ${rel.personName}\n`;
  if (rel.personEmail) output += `Email: ${rel.personEmail}\n`;
  output += `Type: ${rel.relationshipType || "unset"}\n`;
  output += `Importance: ${rel.importanceScore}/10\n`;
  output += `Contact Frequency: ${rel.contactFrequency}\n`;
  if (rel.lastContact) output += `Last Contact: ${new Date(rel.lastContact).toLocaleDateString()}\n`;
  output += "\n";

  const prefs = rel.communicationPrefs as Record<string, unknown> | null;
  if (prefs && Object.keys(prefs).length > 0) {
    output += `## Communication Preferences\n`;
    for (const [k, v] of Object.entries(prefs)) {
      output += `- ${k}: ${JSON.stringify(v)}\n`;
    }
    output += "\n";
  }

  const personality = rel.personalityModel as Record<string, unknown> | null;
  if (personality && Object.keys(personality).length > 0) {
    output += `## Personality Model\n`;
    for (const [k, v] of Object.entries(personality)) {
      output += `- ${k}: ${JSON.stringify(v)}\n`;
    }
    output += "\n";
  }

  const items = rel.openItems as Array<{ text: string; done: boolean; addedAt: string }> | null;
  if (items && items.length > 0) {
    output += `## Open Items\n`;
    for (let i = 0; i < items.length; i++) {
      const status = items[i].done ? "[x]" : "[ ]";
      output += `${i}. ${status} ${items[i].text}\n`;
    }
    output += "\n";
  }

  if (rel.notes) output += `## Notes\n${rel.notes}\n`;

  return output;
}

export function formatRelationshipList(rels: Array<typeof schema.relationshipGraph.$inferSelect>): string {
  if (rels.length === 0) return "No relationships found.\n";

  let output = `# Relationships (${rels.length})\n\n`;
  for (const r of rels) {
    const lastContact = r.lastContact ? new Date(r.lastContact).toLocaleDateString() : "never";
    const openCount = ((r.openItems as Array<{ done: boolean }>) || []).filter(i => !i.done).length;
    output += `- **${r.personName}** (${r.relationshipType || "?"}) importance:${r.importanceScore} freq:${r.contactFrequency} last:${lastContact}${openCount > 0 ? ` [${openCount} open items]` : ""}\n`;
  }
  return output;
}
