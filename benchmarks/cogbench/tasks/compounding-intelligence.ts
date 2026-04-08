/**
 * CogBench — Task 6: Compounding Intelligence
 *
 * Tests whether the memory system's intelligence compounds over time
 * through synapse formation, dream consolidation, and pattern completion.
 *
 * Cognitive basis: Intelligence compounds when memories form connections.
 * Individual facts become more useful when linked to related facts via
 * synaptic connections. Dream consolidation clusters related memories and
 * strengthens key pathways. Pattern completion (CA3) enables recall of
 * related facts from partial cues.
 *
 * Protocol:
 *   1. Ingest facts across separate sessions (individually incomplete)
 *   2. Measure baseline retrieval (pre-consolidation)
 *   3. Run synapse formation + dream consolidation
 *   4. Measure post-consolidation retrieval
 *   5. Compute Compound Gain: improvement in retrieval quality
 *
 * Metric: Compound Gain × Synapse Utilization
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
  runDreamCycle,
  countSynapses,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

interface CompoundScenario {
  domain: string;
  /** Facts spread across sessions that connect to form richer understanding */
  sessions: Array<{
    context: string;
    facts: string[];
  }>;
  /** Queries that require connecting facts from multiple sessions */
  compoundQueries: Array<{
    query: string;
    /** Keywords from multiple sessions that should appear in good retrieval */
    requiredKeywords: string[];
  }>;
}

const COMPOUND_TEMPLATES: CompoundScenario[] = [
  {
    domain: "market-intelligence",
    sessions: [
      {
        context: "session-1-competitor",
        facts: [
          "Competitor VectorDB Inc raised $40M Series B. They're expanding into enterprise with a new managed service offering.",
          "VectorDB's new product targets the same Fortune 500 segment we're pursuing. Pricing undercuts us by 30%.",
        ],
      },
      {
        context: "session-2-customer",
        facts: [
          "Customer Acme Corp's VP of Data mentioned they're evaluating alternatives to our platform. Budget review in Q2.",
          "Acme Corp specifically praised our real-time sync feature but said competitors offer better analytics dashboards.",
        ],
      },
      {
        context: "session-3-product",
        facts: [
          "Product roadmap: analytics dashboard overhaul is planned for Q3, not Q2. Current dashboard uses legacy charting library.",
          "Engineering estimates 6 weeks for the dashboard redesign. Could be accelerated to 4 weeks with contractor support.",
        ],
      },
    ],
    compoundQueries: [
      {
        query: "What's the risk with Acme Corp and what can we do about it?",
        requiredKeywords: ["acme", "competitor", "dashboard", "analytics"],
      },
      {
        query: "How does VectorDB's pricing strategy affect our enterprise customers?",
        requiredKeywords: ["vectordb", "pricing", "enterprise", "acme"],
      },
    ],
  },
  {
    domain: "incident-analysis",
    sessions: [
      {
        context: "session-1-alert",
        facts: [
          "Alert: API latency spike to 2.3s (P95) at 14:22 UTC. Affecting payment endpoints specifically.",
          "Initial triage: database connection pool at 95% capacity. Normal is 60-70%.",
        ],
      },
      {
        context: "session-2-investigation",
        facts: [
          "Root cause identified: marketing campaign drove 3x normal traffic spike starting at 14:00 UTC.",
          "Marketing didn't notify engineering about the campaign. No capacity planning was done.",
        ],
      },
      {
        context: "session-3-remediation",
        facts: [
          "Short-term fix: increased connection pool from 200 to 400. Latency returned to normal by 15:10 UTC.",
          "Long-term action items: implement auto-scaling for connection pools and create a marketing-engineering notification SOP.",
        ],
      },
    ],
    compoundQueries: [
      {
        query: "Walk me through the full incident: what happened, why, and what we're doing about it?",
        requiredKeywords: ["latency", "marketing", "connection pool", "auto-scaling"],
      },
      {
        query: "What process failure caused the outage and how do we prevent it?",
        requiredKeywords: ["marketing", "notification", "capacity", "sop"],
      },
    ],
  },
  {
    domain: "hiring-pipeline",
    sessions: [
      {
        context: "session-1-req",
        facts: [
          "Headcount approved for 2 senior backend engineers. Budget: $180-220K per role. Must have distributed systems experience.",
          "Hiring manager: Sarah from Platform team. She wants candidates who've built systems handling >10K RPS.",
        ],
      },
      {
        context: "session-2-candidates",
        facts: [
          "Candidate Alex: 8 years experience, built the ingestion pipeline at DataCorp handling 50K RPS. Strong Golang. Asking $210K.",
          "Candidate Jordan: 5 years experience, previously at AWS on DynamoDB team. Strong distributed systems theory. Asking $195K.",
        ],
      },
      {
        context: "session-3-feedback",
        facts: [
          "Sarah reviewed Alex's system design: 'Impressive scale experience but the design was over-engineered. Concerned about pragmatism.'",
          "Sarah on Jordan: 'Great fundamentals, loved the approach to consistency tradeoffs. Less hands-on production experience than Alex.'",
        ],
      },
    ],
    compoundQueries: [
      {
        query: "Compare the two backend engineering candidates based on requirements and feedback",
        requiredKeywords: ["alex", "jordan", "sarah", "distributed", "rps"],
      },
      {
        query: "Which candidate better fits the role requirements and why?",
        requiredKeywords: ["alex", "jordan", "10k rps", "pragmatism"],
      },
    ],
  },
  {
    domain: "strategic-planning",
    sessions: [
      {
        context: "session-1-market",
        facts: [
          "TAM for AI agent memory systems estimated at $2.1B by 2027, growing 85% CAGR.",
          "Key segments: enterprise AI ops (40%), developer tools (35%), consumer AI assistants (25%).",
        ],
      },
      {
        context: "session-2-positioning",
        facts: [
          "Our differentiation: only cognitive architecture with hippocampal encoding, dream consolidation, and reconsolidation. Competitors use simple vector RAG.",
          "Brand positioning test with 50 enterprise buyers: 'cognitive memory' resonates 3x more than 'advanced RAG' or 'memory layer'.",
        ],
      },
      {
        context: "session-3-gtm",
        facts: [
          "GTM strategy: lead with published benchmarks (LongMemEval 100%), then offer proof-of-concept deployments.",
          "Target first 10 enterprise deals at $200K ACV each. Pipeline currently has 4 qualified at this level.",
        ],
      },
    ],
    compoundQueries: [
      {
        query: "Summarize our market opportunity and go-to-market approach",
        requiredKeywords: ["2.1b", "cognitive", "benchmarks", "enterprise"],
      },
      {
        query: "How does our competitive positioning connect to the sales strategy?",
        requiredKeywords: ["hippocampal", "cognitive memory", "benchmark", "proof-of-concept"],
      },
    ],
  },
  {
    domain: "product-feedback",
    sessions: [
      {
        context: "session-1-feedback",
        facts: [
          "Feature request from 12 enterprise accounts: role-based access control (RBAC) for shared memory spaces.",
          "Customer surveys show RBAC is the #1 blocker for 8 of our top 20 accounts moving to paid plans.",
        ],
      },
      {
        context: "session-2-technical",
        facts: [
          "Engineering assessment: RBAC implementation requires schema changes to memory_nodes (add org_id, role columns) plus a permissions middleware.",
          "Estimated effort: 3 developer-weeks for basic RBAC, 6 weeks for fine-grained (field-level) permissions.",
        ],
      },
      {
        context: "session-3-revenue",
        facts: [
          "Revenue model: the 8 blocked accounts represent $1.4M in potential ARR if converted.",
          "Sales team forecasts 60% conversion within 30 days of RBAC launch based on verbal commitments.",
        ],
      },
    ],
    compoundQueries: [
      {
        query: "What's the business case for building RBAC?",
        requiredKeywords: ["12 enterprise", "1.4m", "3 developer-weeks", "conversion"],
      },
      {
        query: "How does the RBAC feature request connect to revenue growth?",
        requiredKeywords: ["rbac", "blocked", "revenue", "paid plans"],
      },
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
  const templates = shuffle(COMPOUND_TEMPLATES, rng);
  const scenarios: Scenario[] = [];

  for (let t = 0; t < templates.length && scenarios.length < count; t++) {
    const tmpl = templates[t];
    let memIdx = 0;

    const memories: MemoryFixture[] = [];
    for (const session of tmpl.sessions) {
      for (const fact of session.facts) {
        memories.push({
          id: `comp-${t}-${memIdx}`,
          content: fact,
          source: `compound/${tmpl.domain}/${session.context}`,
          timestamp: new Date(2024, 5, 10, 9 + memIdx).toISOString(),
        });
        memIdx++;
      }
    }

    scenarios.push({
      id: `compounding-${tmpl.domain}-${t}`,
      taskId: "compounding-intelligence",
      description: `Compounding intelligence: ${tmpl.domain} — ${tmpl.sessions.length} sessions, ${memories.length} facts`,
      memories,
      queries: tmpl.compoundQueries.map((q, i) => ({
        id: `comp-q-${t}-${i}`,
        query: q.query,
      })),
      expected: tmpl.compoundQueries.map((q) => ({
        expectedAnswer: q.requiredKeywords.join(", "),
      })),
      config: {
        requiredKeywords: tmpl.compoundQueries.map((q) => q.requiredKeywords),
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
  const config = scenario.config as { requiredKeywords: string[][] };

  try {
    await clearAgent(agentId);

    // Step 1: Ingest WITHOUT full pipeline (no synapses, no hippocampal)
    const fixtureMap = await ingestScenario(agentId, scenario.memories, false);
    const allNodeIds = [...fixtureMap.values()].flat();

    // Step 2: Baseline retrieval (pre-consolidation)
    const baselineScores: number[] = [];
    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const query = scenario.queries[qi];
      const keywords = config.requiredKeywords[qi];

      const results = await search(agentId, query.query, 10);
      const allContent = results.map((r) => r.content.toLowerCase()).join(" ");
      const hits = keywords.filter((kw) => allContent.includes(kw.toLowerCase()));
      baselineScores.push(hits.length / keywords.length);
    }

    // Step 3: Run full cognitive pipeline (synapse formation + dream)
    await ingestScenario(agentId, scenario.memories, true);
    await runDreamCycle(agentId, "consolidation_only");

    // Step 4: Post-consolidation retrieval
    const synapseCount = await countSynapses(allNodeIds);

    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const query = scenario.queries[qi];
      const keywords = config.requiredKeywords[qi];

      const results = await search(agentId, query.query, 10);
      const allContent = results.map((r) => r.content.toLowerCase()).join(" ");
      const hits = keywords.filter((kw) => allContent.includes(kw.toLowerCase()));
      const postScore = hits.length / keywords.length;

      // Compound Gain: improvement over baseline
      const baseline = baselineScores[qi];
      const compoundGain = baseline > 0
        ? (postScore - baseline) / baseline
        : postScore > 0 ? 1.0 : 0.0;

      // Synapse Utilization: did the system form meaningful connections?
      const maxPossibleSynapses = (allNodeIds.length * (allNodeIds.length - 1)) / 2;
      const synapseUtil = maxPossibleSynapses > 0
        ? Math.min(synapseCount / maxPossibleSynapses, 1.0)
        : 0;

      // Score: blend of absolute performance and relative improvement
      const score = postScore * 0.5 + Math.min(compoundGain, 1.0) * 0.3 + synapseUtil * 0.2;

      queryResults.push({
        queryId: query.id,
        passed: postScore >= 0.5,
        score,
        details: {
          compoundGain: Math.max(compoundGain, 0),
          synapseUtil,
          baselineKeywordCoverage: baseline,
          postKeywordCoverage: postScore,
          keywordHits: hits.length,
          totalKeywords: keywords.length,
          synapseCount,
          totalNodes: allNodeIds.length,
        },
      });
    }

    const avgScore =
      queryResults.reduce((s, r) => s + r.score, 0) / queryResults.length;

    return {
      scenarioId: scenario.id,
      taskId: "compounding-intelligence",
      passed: avgScore >= 0.4,
      score: avgScore,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "compounding-intelligence",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

export const compoundingIntelligenceTask: TaskEvaluator = {
  taskId: "compounding-intelligence",
  generateScenarios,
  evaluateScenario,
};
