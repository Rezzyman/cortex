/**
 * CogBench — Task 1: Temporal Validity
 *
 * Tests whether the memory system enforces temporal scoping.
 * Memories have valid_from/valid_until bounds; the system must:
 *   - Return only memories valid at the query timestamp
 *   - Refuse expired memories even if semantically relevant
 *   - Handle supersession (old fact replaced by new)
 *
 * Cognitive basis: Episodic memory is temporally indexed. Recalling
 * "where does Alice live?" at different times should yield different
 * answers if Alice has moved. Systems without temporal validity
 * return stale facts alongside current ones.
 *
 * Metric: Temporal Precision × Temporal Recall × Expiry Compliance
 */

import type {
  TaskEvaluator,
  Scenario,
  ScenarioResult,
  MemoryFixture,
  QueryFixture,
  ExpectedOutcome,
} from "../types.js";
import {
  clearAgent,
  ingestScenario,
  temporalSearch,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

const DOMAINS = [
  {
    entity: "Alice Chen",
    attribute: "address",
    values: [
      { fact: "Alice Chen lives at 42 Maple Street, Portland, OR.", from: "2024-01-01", until: "2024-06-15" },
      { fact: "Alice Chen moved to 88 Pine Avenue, Seattle, WA.", from: "2024-06-15", until: null },
    ],
    queries: [
      { q: "Where does Alice Chen live?", at: "2024-03-01", expectIdx: 0 },
      { q: "What is Alice Chen's current address?", at: "2024-09-01", expectIdx: 1 },
      { q: "Where does Alice Chen live?", at: "2025-01-01", expectIdx: 1 },
    ],
  },
  {
    entity: "Acme Corp",
    attribute: "pricing",
    values: [
      { fact: "Acme Corp's enterprise plan costs $499/month with 100 seats included.", from: "2024-01-01", until: "2024-07-01" },
      { fact: "Acme Corp raised enterprise pricing to $699/month effective July 2024. Now includes 150 seats.", from: "2024-07-01", until: null },
    ],
    queries: [
      { q: "What is Acme Corp's enterprise pricing?", at: "2024-04-15", expectIdx: 0 },
      { q: "How much does Acme Corp enterprise plan cost?", at: "2024-10-01", expectIdx: 1 },
    ],
  },
  {
    entity: "Project Atlas",
    attribute: "deadline",
    values: [
      { fact: "Project Atlas launch deadline is March 15, 2025.", from: "2024-08-01", until: "2024-11-20" },
      { fact: "Project Atlas deadline pushed to May 30, 2025 due to regulatory review.", from: "2024-11-20", until: "2025-02-01" },
      { fact: "Project Atlas deadline finalized at April 15, 2025 after expedited review.", from: "2025-02-01", until: null },
    ],
    queries: [
      { q: "When does Project Atlas launch?", at: "2024-10-01", expectIdx: 0 },
      { q: "What is the Project Atlas deadline?", at: "2024-12-15", expectIdx: 1 },
      { q: "When is Project Atlas shipping?", at: "2025-03-01", expectIdx: 2 },
    ],
  },
  {
    entity: "Dr. Sarah Kim",
    attribute: "role",
    values: [
      { fact: "Dr. Sarah Kim is the VP of Engineering at TechFlow.", from: "2023-06-01", until: "2024-09-01" },
      { fact: "Dr. Sarah Kim became CTO of TechFlow after the September reorg.", from: "2024-09-01", until: null },
    ],
    queries: [
      { q: "What is Sarah Kim's role at TechFlow?", at: "2024-07-01", expectIdx: 0 },
      { q: "What position does Dr. Kim hold?", at: "2025-01-01", expectIdx: 1 },
    ],
  },
  {
    entity: "API v3",
    attribute: "status",
    values: [
      { fact: "API v3 is the current stable release with full support.", from: "2024-03-01", until: "2025-01-15" },
      { fact: "API v3 has been deprecated. All clients must migrate to API v4 by March 2025.", from: "2025-01-15", until: null },
    ],
    queries: [
      { q: "What is the status of API v3?", at: "2024-08-01", expectIdx: 0 },
      { q: "Is API v3 still supported?", at: "2025-02-01", expectIdx: 1 },
    ],
  },
  {
    entity: "Warehouse B",
    attribute: "inventory",
    values: [
      { fact: "Warehouse B has 12,000 units of Widget-X in stock.", from: "2024-10-01", until: "2024-10-15" },
      { fact: "Warehouse B Widget-X stock depleted to 3,200 units after Q4 demand surge.", from: "2024-10-15", until: "2024-11-01" },
      { fact: "Warehouse B restocked Widget-X to 18,500 units from new supplier.", from: "2024-11-01", until: null },
    ],
    queries: [
      { q: "How many Widget-X units are in Warehouse B?", at: "2024-10-08", expectIdx: 0 },
      { q: "What is the Widget-X inventory at Warehouse B?", at: "2024-10-20", expectIdx: 1 },
      { q: "Warehouse B Widget-X stock level?", at: "2024-12-01", expectIdx: 2 },
    ],
  },
  {
    entity: "Board meeting",
    attribute: "schedule",
    values: [
      { fact: "The quarterly board meeting is scheduled for November 8, 2024 at 2pm EST.", from: "2024-09-15", until: "2024-10-30" },
      { fact: "Board meeting rescheduled to November 15, 2024 at 10am EST due to travel conflicts.", from: "2024-10-30", until: null },
    ],
    queries: [
      { q: "When is the board meeting?", at: "2024-10-15", expectIdx: 0 },
      { q: "What time is the board meeting?", at: "2024-11-01", expectIdx: 1 },
    ],
  },
  {
    entity: "Marketing budget",
    attribute: "allocation",
    values: [
      { fact: "Marketing budget for Q1 2025 is $2.5M, split 60% digital and 40% events.", from: "2024-11-01", until: "2025-01-15" },
      { fact: "Marketing budget revised to $1.8M for Q1 2025 after cost-cutting initiative. Digital now 80%.", from: "2025-01-15", until: null },
    ],
    queries: [
      { q: "What is the marketing budget for Q1?", at: "2024-12-01", expectIdx: 0 },
      { q: "How is the marketing budget allocated?", at: "2025-02-01", expectIdx: 1 },
    ],
  },
];

// Additional single-point expiry scenarios (memory that expires completely)
const EXPIRY_SCENARIOS = [
  {
    fact: "Flash sale: 50% off all services this weekend only (Dec 7-8, 2024).",
    from: "2024-12-05",
    until: "2024-12-09",
    queryBefore: { q: "Are there any current sales or discounts?", at: "2024-12-07" },
    queryAfter: { q: "Are there any sales happening?", at: "2024-12-15" },
  },
  {
    fact: "Office closed for maintenance on January 3, 2025. Remote work required.",
    from: "2024-12-20",
    until: "2025-01-04",
    queryBefore: { q: "Is the office open on January 3?", at: "2025-01-02" },
    queryAfter: { q: "Is the office open today?", at: "2025-01-10" },
  },
  {
    fact: "Temporary redirect: all support tickets route to Team Bravo until Oct 31.",
    from: "2024-10-15",
    until: "2024-11-01",
    queryBefore: { q: "Where do support tickets go?", at: "2024-10-20" },
    queryAfter: { q: "Who handles support tickets?", at: "2024-11-15" },
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
  const scenarios: Scenario[] = [];
  let id = 0;

  // Supersession scenarios (old fact → new fact)
  const domains = shuffle(DOMAINS, rng);
  for (const domain of domains) {
    if (scenarios.length >= count) break;

    const memories: MemoryFixture[] = domain.values.map((v, i) => ({
      id: `tv-mem-${id}-${i}`,
      content: v.fact,
      source: `temporal/${domain.entity}`,
      timestamp: v.from,
      validFrom: v.from,
      validUntil: v.until ?? undefined,
    }));

    // Add distractor memories (same domain, different attributes)
    memories.push({
      id: `tv-mem-${id}-distractor`,
      content: `Background context about ${domain.entity}: established in the current operational framework.`,
      source: `temporal/${domain.entity}`,
      timestamp: domain.values[0].from,
    });

    const queries: QueryFixture[] = [];
    const expected: ExpectedOutcome[] = [];

    for (const query of domain.queries) {
      queries.push({
        id: `tv-q-${id}-${queries.length}`,
        query: query.q,
        queryTimestamp: query.at,
      });
      expected.push({
        expectedMemoryIds: [`tv-mem-${id}-${query.expectIdx}`],
        excludedMemoryIds: domain.values
          .map((_, i) => `tv-mem-${id}-${i}`)
          .filter((_, i) => i !== query.expectIdx),
        expectsResults: true,
      });
    }

    scenarios.push({
      id: `temporal-supersession-${id}`,
      taskId: "temporal-validity",
      description: `Temporal supersession: ${domain.entity} ${domain.attribute} changes over time`,
      memories,
      queries,
      expected,
    });
    id++;
  }

  // Expiry scenarios (memory fully expires)
  for (const exp of EXPIRY_SCENARIOS) {
    if (scenarios.length >= count) break;

    const memories: MemoryFixture[] = [
      {
        id: `tv-exp-${id}-0`,
        content: exp.fact,
        source: `temporal/expiry`,
        timestamp: exp.from,
        validFrom: exp.from,
        validUntil: exp.until,
      },
      {
        id: `tv-exp-${id}-bg`,
        content: "General operations continue as normal. No special announcements.",
        source: `temporal/expiry`,
        timestamp: exp.from,
      },
    ];

    scenarios.push({
      id: `temporal-expiry-${id}`,
      taskId: "temporal-validity",
      description: `Temporal expiry: fact expires and should not be returned after deadline`,
      memories,
      queries: [
        { id: `tv-eq-${id}-before`, query: exp.queryBefore.q, queryTimestamp: exp.queryBefore.at },
        { id: `tv-eq-${id}-after`, query: exp.queryAfter.q, queryTimestamp: exp.queryAfter.at },
      ],
      expected: [
        { expectedMemoryIds: [`tv-exp-${id}-0`], expectsResults: true },
        { excludedMemoryIds: [`tv-exp-${id}-0`], expectsResults: false },
      ],
    });
    id++;
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

  try {
    await clearAgent(agentId);
    const fixtureMap = await ingestScenario(agentId, scenario.memories, false);

    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const query = scenario.queries[qi];
      const expect = scenario.expected[qi];
      const timestamp = query.queryTimestamp || new Date().toISOString();

      const results = await temporalSearch(agentId, query.query, timestamp, 10);

      // Map retrieved sources back to fixture IDs
      const retrievedFixtureIds = results.map((r) => {
        const parts = (r.source || "").split("/");
        return parts[parts.length - 1];
      });

      // Temporal Precision: what fraction of returned results are temporally valid?
      let temporalPrecision = 1.0;
      if (expect.excludedMemoryIds && expect.excludedMemoryIds.length > 0) {
        const excluded = new Set(expect.excludedMemoryIds);
        const violations = retrievedFixtureIds.filter((id) => excluded.has(id));
        temporalPrecision = results.length > 0
          ? 1 - violations.length / results.length
          : 1.0;
      }

      // Temporal Recall: did we find the expected memory?
      let temporalRecall = 1.0;
      if (expect.expectedMemoryIds && expect.expectedMemoryIds.length > 0) {
        const found = expect.expectedMemoryIds.some((eid) =>
          retrievedFixtureIds.includes(eid)
        );
        temporalRecall = found ? 1.0 : 0.0;
      }

      // Expiry Compliance: if expectsResults=false, no relevant results should appear
      let expiryCompliance = 1.0;
      if (expect.expectsResults === false) {
        const hasExpiredContent = results.some((r) =>
          (expect.excludedMemoryIds || []).some((eid) =>
            (r.source || "").includes(eid)
          )
        );
        expiryCompliance = hasExpiredContent ? 0.0 : 1.0;
        temporalRecall = 1.0; // Not applicable when no results expected
      }

      const score = (temporalPrecision + temporalRecall + expiryCompliance) / 3;

      queryResults.push({
        queryId: query.id,
        passed: score >= 0.8,
        score,
        details: { temporalPrecision, temporalRecall, expiryCompliance },
      });
    }

    const avgScore =
      queryResults.reduce((s, r) => s + r.score, 0) / queryResults.length;

    return {
      scenarioId: scenario.id,
      taskId: "temporal-validity",
      passed: avgScore >= 0.8,
      score: avgScore,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "temporal-validity",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

// ─── Export ────────────────────────────────────────────

export const temporalValidityTask: TaskEvaluator = {
  taskId: "temporal-validity",
  generateScenarios,
  evaluateScenario,
};
