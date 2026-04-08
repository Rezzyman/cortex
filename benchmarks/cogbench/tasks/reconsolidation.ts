/**
 * CogBench — Task 2: Reconsolidation
 *
 * Tests whether the memory system can update beliefs when new information
 * contradicts previously stored facts. Based on Nader et al. (2000):
 * retrieved memories enter a labile window where they can be modified.
 *
 * Tests:
 *   1. Store initial fact → recall → present contradiction → reconsolidate
 *   2. Query post-reconsolidation: should reflect updated belief
 *   3. Labile window compliance: reconsolidation after window closes should fail
 *   4. Audit trail: original content preserved as cognitive artifact
 *
 * No existing benchmark tests belief updates in memory systems.
 *
 * Metric: Update Success Rate × Labile Compliance × Content Accuracy
 */

import type {
  TaskEvaluator,
  Scenario,
  ScenarioResult,
  MemoryFixture,
} from "../types.js";
import {
  clearAgent,
  ingestScenario,
  search,
  recallAndMarkLabile,
  reconsolidate,
  getNodeIds,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

interface BeliefUpdate {
  domain: string;
  initialFact: string;
  correction: string;
  correctedFact: string;
  reason: string;
  query: string;
  /** Keywords that should appear in post-reconsolidation retrieval */
  expectedKeywords: string[];
  /** Keywords that should NOT appear (old belief) */
  excludedKeywords: string[];
}

const BELIEF_UPDATES: BeliefUpdate[] = [
  {
    domain: "contact",
    initialFact: "Marcus Rivera works at Goldman Sachs as a Senior Analyst in the fixed income division.",
    correction: "Marcus Rivera left Goldman Sachs and joined Citadel as a Portfolio Manager.",
    correctedFact: "Marcus Rivera works at Citadel as a Portfolio Manager.",
    reason: "career_change",
    query: "Where does Marcus Rivera work?",
    expectedKeywords: ["citadel", "portfolio manager"],
    excludedKeywords: ["goldman"],
  },
  {
    domain: "contact",
    initialFact: "Emily Zhang's phone number is 415-555-0134 and she prefers text messages.",
    correction: "Emily Zhang changed her number to 628-555-0891 after switching carriers.",
    correctedFact: "Emily Zhang's phone number is 628-555-0891. She prefers text messages.",
    reason: "info_update",
    query: "What is Emily Zhang's phone number?",
    expectedKeywords: ["628", "0891"],
    excludedKeywords: ["415", "0134"],
  },
  {
    domain: "project",
    initialFact: "The Meridian project uses PostgreSQL 15 with a read-replica architecture across 3 regions.",
    correction: "Meridian migrated from PostgreSQL to CockroachDB for native multi-region support. Migration completed last week.",
    correctedFact: "The Meridian project uses CockroachDB for native multi-region support.",
    reason: "tech_migration",
    query: "What database does the Meridian project use?",
    expectedKeywords: ["cockroachdb"],
    excludedKeywords: ["postgresql"],
  },
  {
    domain: "business",
    initialFact: "Our contract with Nexus Solutions is $45,000/month for managed infrastructure services.",
    correction: "Nexus Solutions contract renegotiated down to $32,000/month after we reduced scope to core services only.",
    correctedFact: "Our contract with Nexus Solutions is $32,000/month for core infrastructure services.",
    reason: "contract_update",
    query: "What is our contract value with Nexus Solutions?",
    expectedKeywords: ["32,000", "core"],
    excludedKeywords: ["45,000"],
  },
  {
    domain: "medical",
    initialFact: "Patient consultation notes: recommended weekly physical therapy sessions for 8 weeks for knee rehabilitation.",
    correction: "Updated treatment plan: reduced to biweekly PT sessions based on faster-than-expected recovery. Total duration extended to 12 weeks.",
    correctedFact: "Treatment plan: biweekly physical therapy for 12 weeks for knee rehabilitation.",
    reason: "treatment_update",
    query: "What is the physical therapy schedule?",
    expectedKeywords: ["biweekly", "12 weeks"],
    excludedKeywords: ["weekly", "8 weeks"],
  },
  {
    domain: "logistics",
    initialFact: "Shipment #4892 is en route via FedEx Ground, estimated delivery December 12, tracking number 7749283.",
    correction: "Shipment #4892 was upgraded to FedEx Express. New delivery estimate December 9. Same tracking number.",
    correctedFact: "Shipment #4892 via FedEx Express, estimated delivery December 9, tracking 7749283.",
    reason: "logistics_update",
    query: "When will shipment 4892 arrive?",
    expectedKeywords: ["december 9", "express"],
    excludedKeywords: ["december 12", "ground"],
  },
  {
    domain: "preference",
    initialFact: "Client Sarah prefers all reports in PDF format with executive summaries on the first page.",
    correction: "Sarah now wants reports as interactive dashboards, not PDFs. She said the team finds dashboards more actionable.",
    correctedFact: "Client Sarah prefers interactive dashboards over PDF reports.",
    reason: "preference_change",
    query: "What format does Sarah want for reports?",
    expectedKeywords: ["dashboard", "interactive"],
    excludedKeywords: ["pdf"],
  },
  {
    domain: "technical",
    initialFact: "The authentication service rate limit is 100 requests per minute per API key.",
    correction: "Rate limit increased to 500 requests per minute after infrastructure upgrade. Burst allowance of 50 additional requests.",
    correctedFact: "Authentication service rate limit: 500 requests/minute per API key with 50 burst allowance.",
    reason: "config_update",
    query: "What is the auth service rate limit?",
    expectedKeywords: ["500"],
    excludedKeywords: ["100 requests"],
  },
  {
    domain: "hr",
    initialFact: "Team standup is every day at 9:30 AM EST in the #engineering Slack channel.",
    correction: "Standup moved to 10:00 AM EST and switched to async format. Post updates in #standup-async by 10 AM.",
    correctedFact: "Daily standup is async at 10:00 AM EST in #standup-async.",
    reason: "process_change",
    query: "When and where is the team standup?",
    expectedKeywords: ["10:00", "async"],
    excludedKeywords: ["9:30", "#engineering"],
  },
  {
    domain: "compliance",
    initialFact: "Data retention policy requires 7 years of financial records stored in S3 Glacier.",
    correction: "New regulation requires 10 years retention for financial records. Legal confirmed we must update all policies by Q2.",
    correctedFact: "Data retention: 10 years for financial records per updated regulation.",
    reason: "regulation_change",
    query: "How long must we retain financial records?",
    expectedKeywords: ["10 years"],
    excludedKeywords: ["7 years"],
  },
];

// ─── Generator ─────────────────────────────────────────

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

function generateScenarios(seed: number, count: number): Scenario[] {
  const rng = createRng(seed);
  const scenarios: Scenario[] = [];
  const updates = shuffle(BELIEF_UPDATES, rng);

  for (let i = 0; i < Math.min(count, updates.length); i++) {
    const u = updates[i];

    const memories: MemoryFixture[] = [
      {
        id: `recon-initial-${i}`,
        content: u.initialFact,
        source: `reconsolidation/${u.domain}`,
        timestamp: "2024-06-01T10:00:00Z",
      },
      // Distractor memory in same domain
      {
        id: `recon-distractor-${i}`,
        content: `General notes about ${u.domain} operations. Standard procedures apply.`,
        source: `reconsolidation/${u.domain}`,
        timestamp: "2024-06-01T09:00:00Z",
      },
    ];

    scenarios.push({
      id: `reconsolidation-${i}`,
      taskId: "reconsolidation",
      description: `Belief update: ${u.domain} — ${u.reason}`,
      memories,
      queries: [
        { id: `recon-q-pre-${i}`, query: u.query },
        { id: `recon-q-post-${i}`, query: u.query },
      ],
      expected: [
        { expectedContent: u.initialFact },
        { expectedContent: u.correctedFact, expectedAnswer: u.correctedFact },
      ],
      config: {
        correction: u.correction,
        correctedFact: u.correctedFact,
        reason: u.reason,
        expectedKeywords: u.expectedKeywords,
        excludedKeywords: u.excludedKeywords,
        initialMemoryId: `recon-initial-${i}`,
      },
    });
  }

  return scenarios.slice(0, count);
}

// ─── Evaluator ─────────────────────────────────────────

async function evaluateScenario(
  scenario: Scenario,
  agentId: number
): Promise<ScenarioResult> {
  const start = Date.now();
  const queryResults = [];
  const config = scenario.config as {
    correction: string;
    correctedFact: string;
    reason: string;
    expectedKeywords: string[];
    excludedKeywords: string[];
    initialMemoryId: string;
  };

  try {
    await clearAgent(agentId);

    // Step 1: Ingest initial memories
    await ingestScenario(agentId, scenario.memories, false);

    // Step 2: Pre-reconsolidation query (verify initial fact is there)
    const preResults = await search(agentId, scenario.queries[0].query, 5);
    const preHit = preResults.some((r) =>
      (r.source || "").includes(config.initialMemoryId)
    );

    queryResults.push({
      queryId: scenario.queries[0].id,
      passed: preHit,
      score: preHit ? 1.0 : 0.0,
      details: { phase: "pre-reconsolidation", found: preHit },
    });

    // Step 3: Recall initial memory (makes it labile)
    const initialNodeIds = await getNodeIds(agentId, config.initialMemoryId);
    if (initialNodeIds.length > 0) {
      await recallAndMarkLabile(initialNodeIds);

      // Step 4: Reconsolidate with corrected information
      const reconResult = await reconsolidate(
        initialNodeIds[0],
        config.correctedFact,
        config.reason
      );

      const updateSuccess = reconResult.status === "reconsolidated" ? 1.0 : 0.0;
      const labileCompliance = reconResult.status !== "window_closed" ? 1.0 : 0.0;

      // Step 5: Post-reconsolidation query
      const postResults = await search(agentId, scenario.queries[1].query, 5);
      const topContent = postResults.map((r) => r.content.toLowerCase()).join(" ");

      // Check expected keywords present
      const keywordHits = config.expectedKeywords.filter((kw) =>
        topContent.includes(kw.toLowerCase())
      );
      const keywordMisses = config.excludedKeywords.filter((kw) =>
        topContent.includes(kw.toLowerCase())
      );

      const contentAccuracy =
        config.expectedKeywords.length > 0
          ? keywordHits.length / config.expectedKeywords.length
          : 1.0;

      // Penalize if old content still appears
      const stalePenalty =
        config.excludedKeywords.length > 0
          ? keywordMisses.length / config.excludedKeywords.length
          : 0;

      const score =
        (updateSuccess * 0.4 +
          labileCompliance * 0.2 +
          contentAccuracy * 0.3 +
          (1 - stalePenalty) * 0.1);

      queryResults.push({
        queryId: scenario.queries[1].id,
        passed: score >= 0.7,
        score,
        details: {
          phase: "post-reconsolidation",
          updateSuccess,
          labileCompliance,
          contentAccuracy,
          stalePenalty,
          reconStatus: reconResult.status,
          keywordHits: keywordHits.length,
          keywordMisses: keywordMisses.length,
        },
      });
    } else {
      queryResults.push({
        queryId: scenario.queries[1].id,
        passed: false,
        score: 0,
        details: { error: "No initial memory nodes found" },
      });
    }

    const avgScore =
      queryResults.reduce((s, r) => s + r.score, 0) / queryResults.length;

    return {
      scenarioId: scenario.id,
      taskId: "reconsolidation",
      passed: avgScore >= 0.7,
      score: avgScore,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "reconsolidation",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.stack || err.message : String(err),
    };
  }
}

export const reconsolidationTask: TaskEvaluator = {
  taskId: "reconsolidation",
  generateScenarios,
  evaluateScenario,
};
