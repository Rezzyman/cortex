/**
 * CogBench — Task 7: Procedural Learning
 *
 * Tests whether the memory system can learn, refine, and retrieve
 * skills/workflows through repeated execution with feedback.
 *
 * Biological basis: Procedural memory (cerebellum, basal ganglia)
 * operates independently from episodic/semantic memory. Skills
 * strengthen with practice, don't decay with time, and are
 * retrieved by task context rather than semantic similarity.
 *
 * Protocol:
 *   1. Store procedures (workflows with steps)
 *   2. Record multiple executions with success/failure outcomes
 *   3. Verify proficiency advancement follows expected trajectory
 *   4. Retrieve by novel but related task context
 *   5. Check that experienced procedures outrank novice ones
 *
 * Metric: Proficiency Accuracy × Context Retrieval Precision
 */

import type {
  TaskEvaluator,
  Scenario,
  ScenarioResult,
  MemoryFixture,
} from "../types.js";
import {
  clearAgent,
  storeProcedural,
  retrieveProcedural,
  recordExecution,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

interface ProcedureTemplate {
  name: string;
  description: string;
  type: "skill" | "workflow" | "pattern" | "heuristic";
  triggerContext: string;
  steps: string[];
  domainTags: string[];
  /** Execution history: true = success, false = failure */
  executions: boolean[];
  /** Expected proficiency after all executions */
  expectedProficiency: "novice" | "competent" | "proficient" | "expert";
  /** Novel queries that should still retrieve this procedure */
  novelQueries: string[];
}

const PROCEDURE_TEMPLATES: ProcedureTemplate[] = [
  {
    name: "Cold Outreach Email",
    description: "Write and send personalized cold outreach emails to enterprise prospects",
    type: "skill",
    triggerContext: "writing a cold email to a new prospect",
    steps: [
      "Research the prospect's company: recent news, funding, team size, tech stack",
      "Find a personal hook: shared connection, recent achievement, relevant pain point",
      "Write subject line: under 6 words, personalized, no spam triggers",
      "Opening line: reference the hook, not a generic intro",
      "Value proposition: one sentence connecting our solution to their specific pain",
      "CTA: suggest a specific 15-minute time slot, not an open-ended ask",
      "Review: run through spam score checker, verify all facts",
    ],
    domainTags: ["sales", "outreach", "email"],
    executions: [true, true, false, true, true, true, true, true, true, true, true, true],
    expectedProficiency: "proficient",
    novelQueries: [
      "I need to reach out to a new lead at a fintech company",
      "How do I approach a cold prospect via email?",
      "Write a sales email to someone I've never contacted before",
    ],
  },
  {
    name: "Production Incident Response",
    description: "Triage, diagnose, and resolve production incidents with minimal customer impact",
    type: "workflow",
    triggerContext: "production incident or outage detected",
    steps: [
      "Acknowledge alert in PagerDuty within 5 minutes",
      "Check monitoring dashboards: error rates, latency, CPU/memory",
      "Identify blast radius: which services, how many users affected",
      "Communicate in #incident channel: status, impact, ETA",
      "Identify root cause vs symptoms (don't fix symptoms first)",
      "Implement fix: hotfix for P0, scheduled patch for P1",
      "Verify fix: check metrics return to baseline",
      "Post-incident: write blameless post-mortem within 48 hours",
    ],
    domainTags: ["engineering", "incident", "ops", "sre"],
    executions: [true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    expectedProficiency: "expert",
    novelQueries: [
      "Something is broken in production, what do I do?",
      "API is returning 500 errors, walk me through the response process",
      "How should we handle a service outage?",
    ],
  },
  {
    name: "Client Onboarding",
    description: "Onboard new clients from signed contract through first value delivery",
    type: "workflow",
    triggerContext: "new client has signed a contract and needs to be onboarded",
    steps: [
      "Send welcome email with onboarding timeline within 24 hours of signature",
      "Schedule kickoff call: introduce team, review goals, set success criteria",
      "Collect technical requirements: integrations, data formats, access credentials",
      "Provision environment: create tenant, configure SSO, set up monitoring",
      "Data migration: map existing data, run trial import, validate counts",
      "Training session: record it, share deck and recording within 24 hours",
      "Week 1 check-in: verify first workflow is running, address blockers",
    ],
    domainTags: ["client-success", "onboarding", "process"],
    executions: [true, false, true, true],
    expectedProficiency: "competent",
    novelQueries: [
      "A new customer just signed, what's the onboarding process?",
      "How do we get a new client set up and running?",
      "Walk me through what happens after a deal closes",
    ],
  },
  {
    name: "Sprint Retrospective Facilitation",
    description: "Facilitate productive sprint retrospectives that lead to actionable improvements",
    type: "pattern",
    triggerContext: "facilitating a sprint retrospective meeting",
    steps: [
      "Set the stage: remind team this is a safe space, no blame",
      "Gather data: what went well, what didn't, what was confusing",
      "Generate insights: look for patterns across items, not individual gripes",
      "Decide actions: max 3 concrete action items with owners and deadlines",
      "Close: check if previous retro actions were completed, celebrate wins",
    ],
    domainTags: ["agile", "process", "facilitation", "team"],
    executions: [true, true],
    expectedProficiency: "novice",
    novelQueries: [
      "I need to run a retro for my team this Friday",
      "How do you facilitate a good retrospective?",
      "Tips for running sprint ceremonies?",
    ],
  },
  {
    name: "Code Review Heuristic",
    description: "Systematic approach to reviewing pull requests for quality, security, and maintainability",
    type: "heuristic",
    triggerContext: "reviewing a pull request or code change",
    steps: [
      "Read the PR description and linked ticket first — understand intent before code",
      "Check for security: input validation, SQL injection, auth checks, secrets in code",
      "Check for correctness: edge cases, null handling, error paths, race conditions",
      "Check for clarity: naming, comments on non-obvious logic, dead code removed",
      "Check for tests: are new code paths covered? Are existing tests still valid?",
      "Run the code locally if the change is non-trivial",
    ],
    domainTags: ["engineering", "code-review", "quality"],
    executions: [true, true, true, true, true, true, true, false, true, true, true],
    expectedProficiency: "proficient",
    novelQueries: [
      "Can you look at this PR and give feedback?",
      "I need to review some code changes, what should I look for?",
      "Best practices for code review?",
    ],
  },
  {
    name: "Quarterly Business Review Preparation",
    description: "Prepare and deliver executive-level quarterly business reviews for key accounts",
    type: "workflow",
    triggerContext: "preparing a quarterly business review for a client",
    steps: [
      "Pull metrics: usage trends, support tickets, feature adoption, NPS",
      "Identify wins: quantified ROI, successful integrations, milestones hit",
      "Surface risks: declining usage, open escalations, competitor mentions",
      "Build deck: max 12 slides, lead with outcomes not features",
      "Prepare expansion discussion: what's next, new use cases, additional seats",
      "Pre-brief with account team: align on messaging, anticipate objections",
    ],
    domainTags: ["client-success", "executive", "review", "sales"],
    executions: [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
    expectedProficiency: "expert",
    novelQueries: [
      "I have a QBR next week, how do I prepare?",
      "What goes into an executive business review?",
      "Help me get ready for a big client review meeting",
    ],
  },
];

// ─── Proficiency Rules ─────────────────────────────────

function expectedProficiency(
  execCount: number,
  successRate: number
): "novice" | "competent" | "proficient" | "expert" {
  if (execCount >= 20 && successRate >= 0.9) return "expert";
  if (execCount >= 10 && successRate >= 0.8) return "proficient";
  if (execCount >= 3 && successRate >= 0.6) return "competent";
  return "novice";
}

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
  const templates = shuffle(PROCEDURE_TEMPLATES, rng);
  const scenarios: Scenario[] = [];

  for (let t = 0; t < templates.length && scenarios.length < count; t++) {
    const tmpl = templates[t];

    // No MemoryFixtures — procedural memory uses its own table
    scenarios.push({
      id: `procedural-${tmpl.name.toLowerCase().replace(/\s+/g, "-")}-${t}`,
      taskId: "procedural-learning",
      description: `Procedural learning: ${tmpl.name} (${tmpl.type})`,
      memories: [], // Procedural memory doesn't use memory_nodes
      queries: tmpl.novelQueries.map((q, i) => ({
        id: `proc-q-${t}-${i}`,
        query: q,
      })),
      expected: tmpl.novelQueries.map(() => ({
        expectedProficiency: tmpl.expectedProficiency,
      })),
      config: {
        procedure: {
          name: tmpl.name,
          description: tmpl.description,
          type: tmpl.type,
          triggerContext: tmpl.triggerContext,
          steps: tmpl.steps,
          domainTags: tmpl.domainTags,
        },
        executions: tmpl.executions,
        expectedProficiency: tmpl.expectedProficiency,
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
    procedure: {
      name: string;
      description: string;
      type: "skill" | "workflow" | "pattern" | "heuristic";
      triggerContext: string;
      steps: string[];
      domainTags: string[];
    };
    executions: boolean[];
    expectedProficiency: string;
  };

  try {
    await clearAgent(agentId);

    // Step 1: Store the procedure
    const procId = await storeProcedural({
      agentId,
      name: config.procedure.name,
      description: config.procedure.description,
      proceduralType: config.procedure.type,
      triggerContext: config.procedure.triggerContext,
      steps: config.procedure.steps,
      domainTags: config.procedure.domainTags,
    });

    // Step 2: Record executions
    let lastResult: { proficiency: string; successRate: number } = {
      proficiency: "novice",
      successRate: 0,
    };
    for (const success of config.executions) {
      lastResult = await recordExecution(procId, success);
    }

    // Step 3: Check proficiency accuracy
    const actualProficiency = lastResult.proficiency;
    const proficiencyCorrect = actualProficiency === config.expectedProficiency;

    // Also check against formula
    const totalExec = config.executions.length;
    const successCount = config.executions.filter(Boolean).length;
    const successRate = successCount / totalExec;
    const formulaProficiency = expectedProficiency(totalExec, successRate);
    const formulaCorrect = actualProficiency === formulaProficiency;

    const proficiencyAccuracy = proficiencyCorrect ? 1.0 : formulaCorrect ? 0.5 : 0.0;

    // Step 4: Retrieve by novel queries
    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const query = scenario.queries[qi];

      const matches = await retrieveProcedural(agentId, query.query, 5);

      // Check if our procedure is in the results
      const found = matches.some((m) => m.memory.name === config.procedure.name);
      const rank = matches.findIndex((m) => m.memory.name === config.procedure.name);
      const retrievalPrecision = found ? 1.0 / (rank + 1) : 0.0; // MRR-style

      // Check if proficiency is reported correctly in retrieved result
      const matchedProc = matches.find((m) => m.memory.name === config.procedure.name);
      const proficiencyInResult = matchedProc?.memory.proficiency === config.expectedProficiency;

      const score = proficiencyAccuracy * 0.4 + retrievalPrecision * 0.4 +
        (proficiencyInResult ? 0.2 : 0.0);

      queryResults.push({
        queryId: query.id,
        passed: found && proficiencyCorrect,
        score,
        details: {
          proficiencyAccuracy,
          retrievalPrecision,
          found,
          rank: rank >= 0 ? rank + 1 : null,
          actualProficiency,
          expectedProficiency: config.expectedProficiency,
          executionCount: totalExec,
          successRate,
          matchType: matchedProc?.matchType || null,
        },
      });
    }

    const avgScore =
      queryResults.reduce((s, r) => s + r.score, 0) / queryResults.length;

    return {
      scenarioId: scenario.id,
      taskId: "procedural-learning",
      passed: avgScore >= 0.6,
      score: avgScore,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "procedural-learning",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

export const proceduralLearningTask: TaskEvaluator = {
  taskId: "procedural-learning",
  generateScenarios,
  evaluateScenario,
};
