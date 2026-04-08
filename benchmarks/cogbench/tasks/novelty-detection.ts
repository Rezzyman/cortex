/**
 * CogBench — Task 3: Novelty Detection
 *
 * Tests whether the memory system's hippocampal CA1 comparator can
 * distinguish genuinely novel information from redundant paraphrases.
 *
 * Biological basis: The hippocampal CA1 region acts as a novelty detector
 * by comparing incoming patterns against predictions from CA3 pattern
 * completion. High prediction error = high novelty = prioritized encoding.
 *
 * Protocol:
 *   1. Ingest a "base" set of semantically similar memories
 *   2. Present new items: some redundant (paraphrases), some genuinely novel
 *   3. Measure CA1 novelty scores for each
 *   4. Compute classification accuracy (novel vs redundant)
 *
 * Metric: Novelty AUC (area under ROC curve for novel/redundant classification)
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
  computeNoveltyForText,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

interface NoveltyScenario {
  domain: string;
  /** Base facts to establish the memory network */
  baseFacts: string[];
  /** Items that are paraphrases of base facts (should score LOW novelty) */
  redundant: string[];
  /** Items that are genuinely new information (should score HIGH novelty) */
  novel: string[];
}

const NOVELTY_TEMPLATES: NoveltyScenario[] = [
  {
    domain: "sales-pipeline",
    baseFacts: [
      "Quarterly revenue target is $2.4M. Current pipeline shows $3.1M in qualified opportunities.",
      "Top deal: Meridian Health, $450K ACV, in procurement review. Decision expected by month end.",
      "Sales team has 8 active reps. Average quota attainment is 87% this quarter.",
      "Primary sales channels are outbound (45%), inbound (35%), and partner referrals (20%).",
    ],
    redundant: [
      "The revenue goal for this quarter is $2.4 million with a pipeline of $3.1 million in qualified deals.",
      "Meridian Health is our biggest opportunity at $450K, currently in procurement. Should close this month.",
      "We have eight sales reps hitting an average of 87% quota attainment.",
    ],
    novel: [
      "Meridian Health's CFO was replaced last week. New CFO is reviewing all pending contracts over $200K.",
      "Competitor launched a free tier that undercuts our entry pricing by 40%. Two prospects mentioned it.",
      "New regulation in healthcare vertical requires SOC 2 Type II certification for all vendors by Q3.",
    ],
  },
  {
    domain: "engineering-ops",
    baseFacts: [
      "Production deployment cadence is weekly on Tuesdays at 2pm EST via GitHub Actions.",
      "Current tech stack: Next.js frontend, Go microservices, PostgreSQL, Redis, deployed on AWS EKS.",
      "P95 latency target is 200ms. Current P95 is 180ms. API error rate is 0.02%.",
      "Engineering team is 12 developers across 3 squads: Platform, Product, and Data.",
    ],
    redundant: [
      "We deploy to production every Tuesday at 2pm Eastern using GitHub Actions CI/CD pipeline.",
      "Our stack is Next.js, Go, PostgreSQL, Redis on AWS EKS. P95 latency is running at 180ms.",
      "There are 12 engineers split into Platform, Product, and Data squads.",
    ],
    novel: [
      "Memory leak detected in the Go payment service. RSS growing 50MB/hour. Needs hotfix before Tuesday deploy.",
      "AWS announced EKS pricing change: 25% increase effective next quarter. Should evaluate GKE migration.",
      "Data squad lead resigned. Knowledge transfer for the ML pipeline is incomplete — 3 undocumented cron jobs.",
    ],
  },
  {
    domain: "client-relationship",
    baseFacts: [
      "Client: Terrawave Inc. Contract: $180K/year. Primary contact: VP of Ops, Janet Liu.",
      "Relationship status: healthy. NPS score 72. Monthly check-ins on first Thursday.",
      "Current projects: dashboard redesign (on track), API integration (2 weeks behind).",
      "Janet prefers Slack for quick questions, email for formal deliverables.",
    ],
    redundant: [
      "Terrawave pays us $180K annually. Janet Liu is our main point of contact there as VP of Ops.",
      "NPS is 72 at Terrawave. We meet with them monthly, on the first Thursday. Things are going well.",
      "The dashboard project at Terrawave is on schedule. API integration is running about 2 weeks late.",
    ],
    novel: [
      "Terrawave is being acquired by OmniCorp. Janet says all vendor contracts will be re-evaluated in 60 days.",
      "Janet promoted to SVP. New VP of Ops hire coming in — we'll need to rebuild the relationship from scratch.",
      "Terrawave's board approved a $500K expansion of our contract to include AI automation. Janet wants a proposal by Friday.",
    ],
  },
  {
    domain: "product-roadmap",
    baseFacts: [
      "Q1 roadmap: mobile app v2.0, analytics dashboard, and SSO integration.",
      "Mobile v2.0 uses React Native with offline-first architecture. Beta target: Feb 15.",
      "Analytics dashboard built on Metabase with custom embedding. 3 developer-weeks remaining.",
      "SSO integration supports SAML 2.0 and OIDC. Dependency on identity provider SDK v4.",
    ],
    redundant: [
      "The Q1 plan includes three deliverables: mobile app version 2, analytics dashboard, and SSO.",
      "Mobile 2.0 is React Native, designed for offline use. Beta should be ready by mid-February.",
      "SSO will support both SAML 2.0 and OIDC protocols, using the identity provider SDK version 4.",
    ],
    novel: [
      "Identity provider deprecated SDK v4. We must migrate to v5 which has a breaking API change in token refresh.",
      "CEO wants AI copilot added to Q1 scope. No additional headcount approved. Something will slip.",
      "React Native 0.78 introduced a regression in offline storage. Community workaround exists but adds 2 days.",
    ],
  },
  {
    domain: "financial-ops",
    baseFacts: [
      "Monthly burn rate is $340K. Runway at current rate: 14 months. Last raise: Series A, $5M.",
      "Top expense categories: payroll (65%), infrastructure (15%), sales & marketing (12%), G&A (8%).",
      "Revenue growing 12% MoM. ARR is $1.2M. Gross margin 78%.",
      "Board meeting quarterly. Next one: March 15. Required: financial update and hiring plan.",
    ],
    redundant: [
      "We're burning $340K per month with 14 months of runway. Raised $5M in Series A.",
      "Payroll is 65% of spend, infra 15%, S&M 12%, and G&A is 8%. ARR at $1.2M.",
      "Revenue is growing at 12% month over month. Gross margin is 78 percent.",
    ],
    novel: [
      "AWS bill spiked 40% this month due to unoptimized ML training jobs. Need to implement spot instances ASAP.",
      "Lead investor signaled interest in bridge round at $8M pre-money. Wants term sheet by end of month.",
      "Payroll processor flagged a compliance issue: two contractors may be misclassified. Legal review needed.",
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
  const templates = shuffle(NOVELTY_TEMPLATES, rng);
  const scenarios: Scenario[] = [];

  for (let t = 0; t < templates.length && scenarios.length < count; t++) {
    const tmpl = templates[t];

    const memories: MemoryFixture[] = tmpl.baseFacts.map((fact, i) => ({
      id: `nov-base-${t}-${i}`,
      content: fact,
      source: `novelty/${tmpl.domain}`,
      timestamp: new Date(2024, 5, 1, 10 + i).toISOString(),
    }));

    // Interleave redundant and novel items as test probes
    const probes = [
      ...tmpl.redundant.map((text, i) => ({
        id: `nov-redundant-${t}-${i}`,
        text,
        label: "redundant" as const,
      })),
      ...tmpl.novel.map((text, i) => ({
        id: `nov-novel-${t}-${i}`,
        text,
        label: "novel" as const,
      })),
    ];

    const shuffledProbes = shuffle(probes, rng);

    scenarios.push({
      id: `novelty-${tmpl.domain}-${t}`,
      taskId: "novelty-detection",
      description: `Novelty detection in ${tmpl.domain}: ${tmpl.redundant.length} redundant, ${tmpl.novel.length} novel probes`,
      memories,
      queries: shuffledProbes.map((p) => ({
        id: p.id,
        query: p.text,
      })),
      expected: shuffledProbes.map((p) => ({
        expectedNovelty: p.label === "novel" ? "high" : "redundant",
      })),
      config: {
        probeLabels: shuffledProbes.map((p) => p.label),
      },
    });
  }

  return scenarios.slice(0, count);
}

// ─── Evaluator ─────────────────────────────────────────

/**
 * Compute AUC from paired scores and labels.
 * Uses the trapezoidal rule on the ROC curve.
 */
function computeAUC(
  scores: number[],
  labels: boolean[]
): { auc: number; tpr: number; fpr: number } {
  if (scores.length === 0) return { auc: 0, tpr: 0, fpr: 0 };

  // Sort by score descending
  const pairs = scores
    .map((s, i) => ({ score: s, positive: labels[i] }))
    .sort((a, b) => b.score - a.score);

  const totalPositive = labels.filter(Boolean).length;
  const totalNegative = labels.length - totalPositive;

  if (totalPositive === 0 || totalNegative === 0) return { auc: 0.5, tpr: 0, fpr: 0 };

  let tp = 0, fp = 0;
  let prevFPR = 0, prevTPR = 0;
  let auc = 0;

  for (const p of pairs) {
    if (p.positive) tp++;
    else fp++;

    const tpr = tp / totalPositive;
    const fpr = fp / totalNegative;
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevFPR = fpr;
    prevTPR = tpr;
  }

  // Final TPR/FPR at the threshold that maximizes (TPR - FPR)
  const bestThresholdTPR = totalPositive > 0 ? tp / totalPositive : 0;
  const bestThresholdFPR = totalNegative > 0 ? fp / totalNegative : 0;

  return { auc, tpr: bestThresholdTPR, fpr: bestThresholdFPR };
}

async function evaluateScenario(
  scenario: Scenario,
  agentId: number
): Promise<ScenarioResult> {
  const start = Date.now();
  const queryResults = [];

  try {
    await clearAgent(agentId);

    // Ingest base facts with full pipeline (hippocampal encoding)
    await ingestScenario(agentId, scenario.memories, true);

    const labels = (scenario.config as { probeLabels: string[] }).probeLabels;
    const noveltyScores: number[] = [];
    const isNovel: boolean[] = [];

    // Compute novelty for each probe
    for (let qi = 0; qi < scenario.queries.length; qi++) {
      const probe = scenario.queries[qi];
      const expectedLabel = labels[qi];

      const { noveltyScore } = await computeNoveltyForText(
        agentId,
        probe.query
      );

      noveltyScores.push(noveltyScore);
      isNovel.push(expectedLabel === "novel");

      queryResults.push({
        queryId: probe.id,
        passed: expectedLabel === "novel" ? noveltyScore > 0.5 : noveltyScore <= 0.5,
        score: expectedLabel === "novel" ? noveltyScore : 1 - noveltyScore,
        details: {
          noveltyScore,
          expectedLabel,
          classified: noveltyScore > 0.5 ? "novel" : "redundant",
          correct: (expectedLabel === "novel") === (noveltyScore > 0.5),
        },
      });
    }

    // Compute AUC across all probes
    const { auc, tpr, fpr } = computeAUC(noveltyScores, isNovel);

    // Inject AUC into all query results for aggregation
    for (const qr of queryResults) {
      qr.details.auc = auc;
      qr.details.tpr = tpr;
      qr.details.fpr = fpr;
    }

    return {
      scenarioId: scenario.id,
      taskId: "novelty-detection",
      passed: auc >= 0.7,
      score: auc,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "novelty-detection",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

export const noveltyDetectionTask: TaskEvaluator = {
  taskId: "novelty-detection",
  generateScenarios,
  evaluateScenario,
};
