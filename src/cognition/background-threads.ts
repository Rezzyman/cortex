/**
 * CORTEX V2 — Autonomous Cognition: Background Threads
 *
 * Three deterministic reasoning threads that query CORTEX data:
 * - Strategic: gaps, stalled projects, alignment
 * - Operational: cron health, diagnostics, stuck items
 * - Relational: contact freshness, pending follow-ups
 */
import { db, schema } from "../db/index.js";
import { eq, sql, desc, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

interface ThreadResult {
  insights: string[];
  actions: string[];
  questions: string[];
}

async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function runStrategicThread(agentId: number): Promise<ThreadResult> {
  const insights: string[] = [];
  const actions: string[] = [];
  const questions: string[] = [];

  // Query recent P0/P1 memories
  const criticalMemories = await db.execute(sql`
    SELECT id, content, source, created_at, resonance_score
    FROM memory_nodes
    WHERE agent_id = ${agentId}
      AND status = 'active'
      AND priority <= 1
    ORDER BY created_at DESC
    LIMIT 30
  `);

  // Query recent decision artifacts
  const decisions = await db
    .select()
    .from(schema.cognitiveArtifacts)
    .where(and(
      eq(schema.cognitiveArtifacts.agentId, agentId),
      eq(schema.cognitiveArtifacts.artifactType, "decision")
    ))
    .orderBy(desc(schema.cognitiveArtifacts.createdAt))
    .limit(10);

  // Check for stalled projects: P0/P1 memories older than 7 days with no recent related activity
  const stalledCheck = await db.execute(sql`
    SELECT content, source, created_at
    FROM memory_nodes
    WHERE agent_id = ${agentId}
      AND status = 'active'
      AND priority <= 1
      AND created_at < NOW() - INTERVAL '7 days'
      AND id NOT IN (
        SELECT DISTINCT memory_a FROM memory_synapses
        WHERE last_activated_at > NOW() - INTERVAL '7 days'
        UNION
        SELECT DISTINCT memory_b FROM memory_synapses
        WHERE last_activated_at > NOW() - INTERVAL '7 days'
      )
    LIMIT 10
  `);

  const stalledRows = stalledCheck.rows as Array<{ content: string; source: string | null; created_at: string }>;
  if (stalledRows.length > 0) {
    insights.push(`${stalledRows.length} critical memories have gone dormant (no synapse activity in 7 days)`);
    for (const row of stalledRows.slice(0, 3)) {
      const src = row.source?.split("/").pop() || "unknown";
      actions.push(`Review stalled item [${src}]: "${row.content.slice(0, 100)}..."`);
    }
  }

  // Check decision frequency
  if (decisions.length === 0) {
    questions.push("No decisions recorded recently. Are we tracking our decision-making process?");
  }

  // Check entity coverage: are any known entities going unmentioned?
  const entityActivity = await db.execute(sql`
    SELECT unnest(entities) as entity, COUNT(*) as mentions,
           MAX(created_at) as last_seen
    FROM memory_nodes
    WHERE agent_id = ${agentId} AND status = 'active'
      AND created_at > NOW() - INTERVAL '14 days'
    GROUP BY entity
    ORDER BY mentions DESC
    LIMIT 20
  `);

  const activeEntities = (entityActivity.rows as Array<{ entity: string; mentions: string }>).map(e => e.entity);
  const knownCritical: string[] = []; // Configure via env or agent config
  for (const entity of knownCritical) {
    if (!activeEntities.includes(entity)) {
      questions.push(`No recent mentions of "${entity}" in last 14 days. Status?`);
    }
  }

  // Store as cognitive artifact
  const result = { insights, actions, questions };
  await db.insert(schema.cognitiveArtifacts).values({
    agentId,
    artifactType: "background_thread",
    content: { threadType: "strategic", ...result, timestamp: new Date().toISOString() },
    resonanceScore: 5.0,
  });

  // Update background thread status
  await upsertThreadStatus(agentId, "strategic", result);

  return result;
}

export async function runOperationalThread(agentId: number): Promise<ThreadResult> {
  const insights: string[] = [];
  const actions: string[] = [];
  const questions: string[] = [];

  // Check recent diagnostics
  const recentDiags = await db
    .select()
    .from(schema.selfDiagnostics)
    .where(eq(schema.selfDiagnostics.agentId, agentId))
    .orderBy(desc(schema.selfDiagnostics.timestamp))
    .limit(5);

  if (recentDiags.length === 0) {
    actions.push("No self-diagnostics found. Run `cortex self-check` to establish baseline.");
  } else {
    const latest = recentDiags[0];
    if (latest.overallHealth !== "healthy") {
      insights.push(`Latest diagnostic: ${latest.overallHealth}. Alerts: ${(latest.alerts as string[])?.join(", ") || "none"}`);
    }

    // Check for health trends
    const degradedCount = recentDiags.filter(d => d.overallHealth !== "healthy").length;
    if (degradedCount >= 3) {
      insights.push(`${degradedCount} of last ${recentDiags.length} diagnostics show degraded/critical health`);
      actions.push("Investigate persistent health issues");
    }
  }

  // Check cron job status
  const cronFile = join(process.env.HOME || "", ".openclaw", "cron", "jobs.json");
  const cronData = await safeReadFile(cronFile);
  if (cronData) {
    const { jobs } = JSON.parse(cronData);
    const enabledJobs = jobs.filter((j: { enabled: boolean }) => j.enabled);
    const failedJobs = enabledJobs.filter((j: { state?: { lastStatus: string } }) => j.state?.lastStatus === "error");
    if (failedJobs.length > 0) {
      insights.push(`${failedJobs.length} cron jobs in error state`);
      for (const j of failedJobs) {
        actions.push(`Fix cron job: ${j.name}`);
      }
    }
  }

  // Check memory system health
  const memStats = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active') as active,
      COUNT(*) FILTER (WHERE status = 'deleted') as deleted,
      COUNT(*) FILTER (WHERE status = 'archived') as archived,
      AVG(resonance_score) FILTER (WHERE status = 'active') as avg_resonance
    FROM memory_nodes WHERE agent_id = ${agentId}
  `);

  const stats = memStats.rows[0] as { active: string; deleted: string; archived: string; avg_resonance: string };
  if (Number(stats.avg_resonance) < 3.0) {
    insights.push(`Average memory resonance is low (${Number(stats.avg_resonance).toFixed(2)}). Dream cycle may need tuning.`);
  }

  const result = { insights, actions, questions };
  await db.insert(schema.cognitiveArtifacts).values({
    agentId,
    artifactType: "background_thread",
    content: { threadType: "operational", ...result, timestamp: new Date().toISOString() },
    resonanceScore: 5.0,
  });

  await upsertThreadStatus(agentId, "operational", result);
  return result;
}

export async function runRelationalThread(agentId: number): Promise<ThreadResult> {
  const insights: string[] = [];
  const actions: string[] = [];
  const questions: string[] = [];

  // Check relationship graph for overdue contacts
  const overdueContacts = await db.execute(sql`
    SELECT person_name, relationship_type, last_contact, contact_frequency, importance_score
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

  const overdueRows = overdueContacts.rows as Array<{
    person_name: string; relationship_type: string; last_contact: string;
    contact_frequency: string; importance_score: number;
  }>;

  if (overdueRows.length > 0) {
    insights.push(`${overdueRows.length} contacts are overdue for check-in`);
    for (const r of overdueRows) {
      actions.push(`Reach out to ${r.person_name} (${r.relationship_type}, ${r.contact_frequency}, last: ${new Date(r.last_contact).toLocaleDateString()})`);
    }
  }

  // Check for pending open items
  const openItemsResult = await db.execute(sql`
    SELECT person_name, open_items, importance_score
    FROM relationship_graph
    WHERE agent_id = ${agentId}
      AND open_items IS NOT NULL
      AND jsonb_array_length(open_items) > 0
    ORDER BY importance_score DESC
  `);

  const openRows = openItemsResult.rows as Array<{ person_name: string; open_items: unknown[]; importance_score: number }>;
  if (openRows.length > 0) {
    let totalOpen = 0;
    for (const r of openRows) {
      const items = r.open_items as Array<{ text: string; done?: boolean }>;
      const pending = items.filter(i => !i.done);
      totalOpen += pending.length;
      if (pending.length > 0) {
        actions.push(`${r.person_name} has ${pending.length} open item(s): ${pending.map(i => i.text).join("; ").slice(0, 100)}`);
      }
    }
    if (totalOpen > 0) {
      insights.push(`${totalOpen} total open items across ${openRows.length} contacts`);
    }
  }

  // Fallback: if no relationship graph data, check entity frequency trends
  if (overdueRows.length === 0 && openRows.length === 0) {
    const entityTrend = await db.execute(sql`
      SELECT unnest(entities) as entity, COUNT(*) as mentions
      FROM memory_nodes
      WHERE agent_id = ${agentId} AND status = 'active'
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY entity
      HAVING COUNT(*) >= 3
      ORDER BY mentions DESC
      LIMIT 15
    `);

    const entities = entityTrend.rows as Array<{ entity: string; mentions: string }>;
    if (entities.length > 0) {
      insights.push(`Top active contacts (by mention): ${entities.slice(0, 5).map(e => `${e.entity} (${e.mentions})`).join(", ")}`);
    }

    questions.push("Relationship graph may not be seeded. Run seed-relationships to populate.");
  }

  const result = { insights, actions, questions };
  await db.insert(schema.cognitiveArtifacts).values({
    agentId,
    artifactType: "background_thread",
    content: { threadType: "relational", ...result, timestamp: new Date().toISOString() },
    resonanceScore: 5.0,
  });

  await upsertThreadStatus(agentId, "relational", result);
  return result;
}

async function upsertThreadStatus(agentId: number, threadType: string, findings: ThreadResult): Promise<void> {
  // Check if thread record exists
  const existing = await db
    .select()
    .from(schema.backgroundThreads)
    .where(and(
      eq(schema.backgroundThreads.agentId, agentId),
      eq(schema.backgroundThreads.threadType, threadType)
    ))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.backgroundThreads)
      .set({
        status: "completed",
        lastRun: new Date(),
        findings,
        nextAction: findings.actions[0] || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.backgroundThreads.id, existing[0].id));
  } else {
    await db.insert(schema.backgroundThreads).values({
      agentId,
      threadType,
      status: "completed",
      lastRun: new Date(),
      findings,
      nextAction: findings.actions[0] || null,
      priority: threadType === "strategic" ? 1 : threadType === "operational" ? 2 : 3,
    });
  }
}

/**
 * Run all three background threads with individual timeouts.
 * Uses Promise.allSettled so one hanging thread doesn't block the others.
 * Each thread gets 30 seconds before being killed.
 */
const THREAD_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function runAllThreads(agentId: number): Promise<{
  strategic: ThreadResult | null;
  operational: ThreadResult | null;
  relational: ThreadResult | null;
  errors: string[];
}> {
  const errors: string[] = [];

  const results = await Promise.allSettled([
    withTimeout(runStrategicThread(agentId), THREAD_TIMEOUT_MS, "strategic"),
    withTimeout(runOperationalThread(agentId), THREAD_TIMEOUT_MS, "operational"),
    withTimeout(runRelationalThread(agentId), THREAD_TIMEOUT_MS, "relational"),
  ]);

  const extract = (r: PromiseSettledResult<ThreadResult>, name: string): ThreadResult | null => {
    if (r.status === "fulfilled") return r.value;
    errors.push(`${name}: ${r.reason?.message || String(r.reason)}`);
    console.error(`[bg-thread] ${name} failed:`, r.reason);
    return null;
  };

  return {
    strategic: extract(results[0], "strategic"),
    operational: extract(results[1], "operational"),
    relational: extract(results[2], "relational"),
    errors,
  };
}

export function formatThreadResult(threadType: string, result: ThreadResult): string {
  let output = `# Background Thread: ${threadType.charAt(0).toUpperCase() + threadType.slice(1)}\n\n`;

  if (result.insights.length > 0) {
    output += `## Insights\n`;
    for (const i of result.insights) output += `- ${i}\n`;
    output += "\n";
  }

  if (result.actions.length > 0) {
    output += `## Recommended Actions\n`;
    for (const a of result.actions) output += `- ${a}\n`;
    output += "\n";
  }

  if (result.questions.length > 0) {
    output += `## Open Questions\n`;
    for (const q of result.questions) output += `- ${q}\n`;
    output += "\n";
  }

  if (result.insights.length === 0 && result.actions.length === 0 && result.questions.length === 0) {
    output += "All clear. No issues detected.\n";
  }

  return output;
}
