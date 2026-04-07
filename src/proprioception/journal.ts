/**
 * CORTEX V2 — Proprioception: Agent Journal
 *
 * Structured self-state logging for agent introspection.
 */
import { db, schema } from "../db/index.js";
import { eq, sql, desc, gte } from "drizzle-orm";

interface JournalEntry {
  energyState?: "high" | "normal" | "low" | "depleted";
  activeThreads?: unknown[];
  confidence?: number;
  memoryQuality?: number;
  concerns?: string[];
  notes?: string;
  sessionId?: string;
}

export async function writeJournalEntry(agentId: number, entry: JournalEntry): Promise<number> {
  const [inserted] = await db
    .insert(schema.agentStateLogs)
    .values({
      agentId,
      sessionId: entry.sessionId || null,
      energyState: entry.energyState || "normal",
      activeThreads: entry.activeThreads || [],
      confidence: entry.confidence ?? 0.5,
      memoryQuality: entry.memoryQuality ?? 0.5,
      concerns: entry.concerns || [],
      notes: entry.notes || null,
    })
    .returning({ id: schema.agentStateLogs.id });

  return inserted.id;
}

export async function getRecentJournal(agentId: number, hours = 24): Promise<Array<{
  id: number;
  timestamp: Date;
  energyState: string | null;
  confidence: number | null;
  memoryQuality: number | null;
  concerns: string[] | null;
  notes: string | null;
  sessionId: string | null;
}>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const entries = await db
    .select()
    .from(schema.agentStateLogs)
    .where(eq(schema.agentStateLogs.agentId, agentId))
    .orderBy(desc(schema.agentStateLogs.timestamp))
    .limit(50);

  return entries.filter(e => e.timestamp >= since).map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    energyState: e.energyState,
    confidence: e.confidence,
    memoryQuality: e.memoryQuality,
    concerns: e.concerns,
    notes: e.notes,
    sessionId: e.sessionId,
  }));
}

export function formatJournalEntries(entries: Awaited<ReturnType<typeof getRecentJournal>>): string {
  if (entries.length === 0) return "No journal entries found.\n";

  let output = `# Agent Journal (${entries.length} entries)\n\n`;
  for (const e of entries) {
    const time = e.timestamp.toISOString().replace("T", " ").slice(0, 19);
    output += `## ${time}\n`;
    output += `- Energy: ${e.energyState || "unknown"}\n`;
    output += `- Confidence: ${e.confidence?.toFixed(2) || "?"}\n`;
    output += `- Memory Quality: ${e.memoryQuality?.toFixed(2) || "?"}\n`;
    if (e.concerns && e.concerns.length > 0) output += `- Concerns: ${e.concerns.join(", ")}\n`;
    if (e.notes) output += `- Notes: ${e.notes}\n`;
    output += "\n";
  }
  return output;
}
