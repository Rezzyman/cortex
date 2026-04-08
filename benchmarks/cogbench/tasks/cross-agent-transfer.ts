/**
 * CogBench — Task 5: Cross-Agent Transfer
 *
 * Tests whether knowledge can be transferred between agent instances.
 * In multi-agent deployments, Agent A may learn facts that Agent B
 * needs to act on. Transfer mechanisms must preserve fidelity.
 *
 * Cognitive basis: Analogous to social learning / cultural transmission.
 * In biological systems, knowledge transfer between individuals (teaching,
 * language) enables collective intelligence beyond individual capacity.
 *
 * Protocol:
 *   1. Agent A ingests domain-specific knowledge
 *   2. Export Agent A's memories as a transferable package
 *   3. Import into Agent B (fresh agent)
 *   4. Query Agent B — can it recall Agent A's knowledge?
 *   5. Measure Transfer Recall and Knowledge Loss
 *
 * Metric: Transfer Recall@K × (1 - Knowledge Loss Rate)
 */

import type {
  TaskEvaluator,
  Scenario,
  ScenarioResult,
  MemoryFixture,
} from "../types.js";
import {
  createAgent,
  clearAgent,
  ingestScenario,
  search,
} from "../client.js";
import { db, schema } from "../../../src/db/index.js";
import { sql } from "drizzle-orm";

// ─── Scenario Templates ────────────────────────────────

interface TransferScenario {
  domain: string;
  /** Facts Agent A knows */
  agentAFacts: string[];
  /** Queries that Agent B should be able to answer after transfer */
  queries: Array<{ query: string; expectedFactIdx: number }>;
}

const TRANSFER_TEMPLATES: TransferScenario[] = [
  {
    domain: "sales-handoff",
    agentAFacts: [
      "Client Apex Dynamics: decision maker is COO Rachel Torres. Budget approved at $320K. Pain point is manual inventory reconciliation taking 40 hours/week.",
      "Apex negotiation notes: they want a 90-day pilot before annual commitment. Competitor Netsync already proposed at $250K but lacks our real-time sync feature.",
      "Rachel's assistant David handles scheduling. Meetings only on Tuesdays and Thursdays between 2-4pm EST. Rachel prefers concise bullet-point follow-ups.",
    ],
    queries: [
      { query: "Who is the decision maker at Apex Dynamics?", expectedFactIdx: 0 },
      { query: "What is Apex's main pain point?", expectedFactIdx: 0 },
      { query: "What did Apex request regarding the pilot?", expectedFactIdx: 1 },
      { query: "When can I schedule meetings with Rachel?", expectedFactIdx: 2 },
    ],
  },
  {
    domain: "engineering-oncall",
    agentAFacts: [
      "Payment service has a known memory leak under high concurrency (>500 TPS). Workaround: restart pod every 4 hours via CronJob. Fix tracked in JIRA-4892.",
      "Database connection pool on prod-db-3 is configured at 200 connections. Going above 180 causes latency spikes. Alert threshold set at 170.",
      "The CDN cache invalidation endpoint is rate-limited to 10 requests/minute. Batch invalidations using the /batch-purge endpoint instead of individual /purge calls.",
    ],
    queries: [
      { query: "What's the workaround for the payment service memory leak?", expectedFactIdx: 0 },
      { query: "What's the connection pool limit on the prod database?", expectedFactIdx: 1 },
      { query: "How should I handle CDN cache invalidation?", expectedFactIdx: 2 },
    ],
  },
  {
    domain: "customer-success-handoff",
    agentAFacts: [
      "QuantumLeap (account #4471): renewal date June 15. Currently at 85 seats, contracted for 100. Usage trending down in analytics module — 23% decline over 3 months.",
      "QuantumLeap stakeholder map: CEO Jim Parsons (executive sponsor, met once at conference), VP Eng Lisa Huang (daily user, champion), IT Director Tom Reeves (skeptic, concerned about SSO integration).",
      "Open issues: SSO SAML integration failing intermittently (ticket #8832, P2). Custom report export timing out for datasets over 10K rows (ticket #8901, P1). Lisa flagged both as renewal blockers.",
    ],
    queries: [
      { query: "When does QuantumLeap renew and what's their usage trend?", expectedFactIdx: 0 },
      { query: "Who are the key stakeholders at QuantumLeap?", expectedFactIdx: 1 },
      { query: "What open issues could block the QuantumLeap renewal?", expectedFactIdx: 2 },
    ],
  },
  {
    domain: "research-collaboration",
    agentAFacts: [
      "Paper draft: 'Sparse Coding in Synthetic Hippocampal Architectures' — Section 3 needs ablation study on sparsity ratios (3%, 5%, 7%, 10%). Deadline: April 20 for MemAgents workshop.",
      "Key finding: 5% sparsity in dentate gyrus layer gives optimal pattern separation (0.92 Jaccard distinctness) while maintaining 87% pattern completion accuracy in CA3.",
      "Related work gap: No prior work combines reconsolidation with hippocampal sparse coding. Closest is MemFormer (2025) which uses attention-based gating but no biological plausibility.",
    ],
    queries: [
      { query: "What ablation study is needed for the paper?", expectedFactIdx: 0 },
      { query: "What sparsity ratio works best for pattern separation?", expectedFactIdx: 1 },
      { query: "What's the novelty of our approach vs related work?", expectedFactIdx: 2 },
    ],
  },
  {
    domain: "project-transition",
    agentAFacts: [
      "Migration to Kubernetes: Phase 1 (stateless services) complete. Phase 2 (stateful — Postgres, Redis) starts next sprint. Risk: PVC provisioning on our cloud provider is slow (avg 45s).",
      "Feature flags managed in LaunchDarkly. Critical flag: 'enable_new_billing' controls rollout of Stripe migration. Currently at 5% of users. Do NOT go above 10% until latency regression in billing-service is fixed.",
      "CI pipeline runs in 18 minutes on main. PR builds are 12 minutes. Build cache is on S3 — if cache miss, builds take 35+ minutes. Cache TTL is 48 hours.",
    ],
    queries: [
      { query: "What's the status of the Kubernetes migration?", expectedFactIdx: 0 },
      { query: "What are the constraints on the new billing feature flag?", expectedFactIdx: 1 },
      { query: "How long do CI builds take and what affects build time?", expectedFactIdx: 2 },
    ],
  },
];

// ─── Seeded RNG ────────────────────────────────────────

function createRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ─── Generator ─────────────────────────────────────────

function generateScenarios(seed: number, count: number): Scenario[] {
  const rng = createRng(seed);
  const templates = shuffle(TRANSFER_TEMPLATES, rng);
  const scenarios: Scenario[] = [];

  for (let t = 0; t < templates.length && scenarios.length < count; t++) {
    const tmpl = templates[t];

    const memories: MemoryFixture[] = tmpl.agentAFacts.map((fact, i) => ({
      id: `xfer-a-${t}-${i}`,
      content: fact,
      source: `transfer/${tmpl.domain}`,
      timestamp: new Date(2024, 5, 10, 9 + i).toISOString(),
      agentTag: "agent-a",
    }));

    scenarios.push({
      id: `cross-agent-${tmpl.domain}-${t}`,
      taskId: "cross-agent-transfer",
      description: `Cross-agent transfer: ${tmpl.domain}`,
      memories,
      queries: tmpl.queries.map((q, i) => ({
        id: `xfer-q-${t}-${i}`,
        query: q.query,
      })),
      expected: tmpl.queries.map((q) => ({
        expectedMemoryIds: [`xfer-a-${t}-${q.expectedFactIdx}`],
      })),
    });
  }

  return scenarios.slice(0, count);
}

// ─── Evaluator ─────────────────────────────────────────

/**
 * Transfer mechanism: export Agent A's memories and re-ingest into Agent B.
 * This simulates the minimal viable transfer: content + embeddings, no synapses.
 */
async function transferKnowledge(
  sourceAgentId: number,
  targetAgentId: number
): Promise<number> {
  // Use raw SQL for the full round-trip to avoid type serialization issues
  // with pgvector embeddings and PostgreSQL arrays
  const sourceMemories = await db.execute(sql`
    SELECT id, content, source, priority, resonance_score
    FROM memory_nodes
    WHERE agent_id = ${sourceAgentId}
      AND status = 'active'
      AND embedding IS NOT NULL
  `);

  if (sourceMemories.rows.length === 0) return 0;

  // Transfer via SQL INSERT ... SELECT to preserve native types
  const result = await db.execute(sql`
    INSERT INTO memory_nodes (
      agent_id, content, source, source_type, chunk_index,
      embedding, entities, semantic_tags,
      priority, resonance_score, novelty_score, status
    )
    SELECT
      ${targetAgentId},
      content,
      'transfer/' || COALESCE(source, 'unknown'),
      'benchmark',
      0,
      embedding,
      entities,
      semantic_tags,
      priority,
      GREATEST(resonance_score * 0.8, 1.0),
      0.5,
      'active'
    FROM memory_nodes
    WHERE agent_id = ${sourceAgentId}
      AND status = 'active'
      AND embedding IS NOT NULL
  `);

  return sourceMemories.rows.length;
}

async function evaluateScenario(
  scenario: Scenario,
  agentId: number // This is Agent A's ID
): Promise<ScenarioResult> {
  const start = Date.now();
  const queryResults = [];

  try {
    // Create two agents: A (source) and B (target)
    const agentAId = agentId;
    const agentBId = await createAgent(`transfer-b-${scenario.id}`);

    await clearAgent(agentAId);
    await clearAgent(agentBId);

    // Step 1: Ingest into Agent A
    await ingestScenario(agentAId, scenario.memories, false);

    // Step 2: Verify Agent A can answer queries (baseline)
    const baselineHits: boolean[] = [];
    for (const query of scenario.queries) {
      const results = await search(agentAId, query.query, 5);
      baselineHits.push(results.length > 0);
    }

    // Step 3: Transfer from A to B
    const transferred = await transferKnowledge(agentAId, agentBId);

    // Step 4: Query Agent B
    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const query = scenario.queries[qi];
      const expect = scenario.expected[qi];

      const results = await search(agentBId, query.query, 5);

      // Check if expected content is in results
      const retrievedSources = results.map((r) => r.source || "");
      const expectedIds = expect.expectedMemoryIds || [];

      const transferRecall = expectedIds.length > 0
        ? expectedIds.filter((eid) =>
            retrievedSources.some((src) => src.includes(eid))
          ).length / expectedIds.length
        : results.length > 0 ? 1.0 : 0.0;

      // Content-level check: does any result contain relevant keywords?
      const allContent = results.map((r) => r.content.toLowerCase()).join(" ");
      const queryWords = query.query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      const contentMatch = queryWords.filter((w) => allContent.includes(w)).length / Math.max(queryWords.length, 1);

      const knowledgeLoss = baselineHits[qi] && results.length === 0 ? 1.0 : 0.0;

      const score = transferRecall * 0.6 + contentMatch * 0.3 + (1 - knowledgeLoss) * 0.1;

      queryResults.push({
        queryId: query.id,
        passed: score >= 0.5,
        score,
        details: {
          transferRecall,
          knowledgeLoss,
          contentMatch,
          baselineHit: baselineHits[qi],
          transferredResults: results.length,
          totalTransferred: transferred,
        },
      });
    }

    // Cleanup Agent B
    await clearAgent(agentBId);

    const avgScore =
      queryResults.reduce((s, r) => s + r.score, 0) / queryResults.length;

    return {
      scenarioId: scenario.id,
      taskId: "cross-agent-transfer",
      passed: avgScore >= 0.5,
      score: avgScore,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "cross-agent-transfer",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

export const crossAgentTransferTask: TaskEvaluator = {
  taskId: "cross-agent-transfer",
  generateScenarios,
  evaluateScenario,
};
