/**
 * CogBench — Task 4: Emotional Recall
 *
 * Tests whether emotionally salient memories are preferentially recalled
 * and resist decay better than neutral memories.
 *
 * Biological basis: The amygdala modulates hippocampal encoding strength.
 * Emotionally charged events form stronger memory traces, resist forgetting,
 * and are recalled more easily (McGaugh 2004; LaBar & Cabeza 2006).
 *
 * Protocol:
 *   1. Ingest paired memories: emotionally charged + neutral, same core info
 *   2. Run dream cycle (pruning phase)
 *   3. Search for both — emotional memory should rank higher
 *   4. Check that emotional memory survived pruning better
 *
 * Metric: Emotional Recall Advantage (ERA) × Decay Resistance Ratio
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
  getActiveNodeIds,
  getResonanceScores,
} from "../client.js";

// ─── Scenario Templates ────────────────────────────────

interface EmotionalPair {
  domain: string;
  topic: string;
  emotional: string;
  neutral: string;
  query: string;
}

const EMOTIONAL_PAIRS: EmotionalPair[] = [
  {
    domain: "incident",
    topic: "server outage",
    emotional: "CRITICAL: Production database went down at 3 AM. 47,000 users affected. Revenue loss estimated at $180K. The CEO called an emergency all-hands. Team worked 14 hours straight to restore service. CTO was furious about the missing failover.",
    neutral: "The production database experienced an outage. Users were affected. The team worked to restore service. A post-mortem was scheduled to review the incident and failover configuration.",
    query: "What happened with the production database outage?",
  },
  {
    domain: "deal",
    topic: "contract signing",
    emotional: "INCREDIBLE WIN! We just signed the biggest deal in company history — $2.3M annual contract with GlobalTech. The entire sales team was celebrating. Jake literally cried when the DocuSign notification came through. This changes everything for our Series B narrative.",
    neutral: "GlobalTech signed an annual contract valued at $2.3M. The sales team completed the deal process. This contract contributes to the Series B fundraising narrative.",
    query: "Tell me about the GlobalTech contract.",
  },
  {
    domain: "loss",
    topic: "client churn",
    emotional: "Devastating loss. Pinnacle Corp cancelled their $400K contract after 3 years. Their new CTO said our platform was 'embarrassingly behind competitors.' The account team is demoralized. We failed them — the product gaps they flagged 8 months ago were never addressed.",
    neutral: "Pinnacle Corp did not renew their $400K contract after 3 years. Their new CTO cited competitive gaps. The product issues they previously reported had not been addressed.",
    query: "What happened with the Pinnacle Corp account?",
  },
  {
    domain: "hire",
    topic: "key hire",
    emotional: "Thrilled to announce we finally landed Dr. Maya Patel as our Head of AI! She turned down offers from Google DeepMind and OpenAI to join us. Her paper on cognitive architectures has 2,400 citations. I'm incredibly excited — this is the hire that makes CORTEX real.",
    neutral: "Dr. Maya Patel joined as Head of AI. She previously considered positions at other companies. She has published research on cognitive architectures with significant citations.",
    query: "Who is our Head of AI and what's their background?",
  },
  {
    domain: "security",
    topic: "breach attempt",
    emotional: "URGENT SECURITY ALERT: Detected unauthorized access attempt on customer data. Attacker exploited a known CVE we hadn't patched. 12,000 records potentially exposed. I'm sick to my stomach. Legal is involved. We have 72 hours to notify affected customers under GDPR.",
    neutral: "An unauthorized access attempt was detected targeting customer data. It involved an unpatched CVE. Some records were potentially exposed. Legal review and customer notification procedures were initiated per GDPR requirements.",
    query: "What happened with the security incident involving customer data?",
  },
  {
    domain: "launch",
    topic: "product launch",
    emotional: "WE DID IT! Product launch exceeded every projection. 15,000 signups in the first 24 hours (target was 3,000). Hacker News hit #1. The team is absolutely euphoric. Three years of work paying off in one incredible day. Champagne is flowing.",
    neutral: "The product launch resulted in 15,000 signups within 24 hours, exceeding the 3,000 target. The launch received coverage on technology news sites. The development timeline was approximately three years.",
    query: "How did the product launch go?",
  },
  {
    domain: "conflict",
    topic: "team conflict",
    emotional: "Terrible meeting today. Marcus and Sofia had a shouting match in front of the whole team about the architecture decision. Marcus slammed his laptop shut and walked out. Three junior engineers looked terrified. This level of dysfunction is killing morale and we need to address it immediately.",
    neutral: "During today's meeting, Marcus and Sofia disagreed about the architecture decision. Marcus left the meeting early. The discussion affected team dynamics and should be addressed in follow-up conversations.",
    query: "What happened in the meeting between Marcus and Sofia?",
  },
  {
    domain: "milestone",
    topic: "revenue milestone",
    emotional: "Just crossed $1M ARR!!! 🎉 What started as a crazy idea in my garage 18 months ago is now a real business. Every rejection, every sleepless night, every time someone said it wouldn't work — this moment makes it all worth it. Grateful beyond words for this team.",
    neutral: "Annual recurring revenue reached $1M. The company has been operating for 18 months. The milestone represents progress from the initial founding period.",
    query: "When did we hit $1M ARR and what was the journey like?",
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
  const pairs = shuffle(EMOTIONAL_PAIRS, rng);
  const scenarios: Scenario[] = [];

  for (let i = 0; i < Math.min(count, pairs.length); i++) {
    const p = pairs[i];

    const memories: MemoryFixture[] = [
      {
        id: `emo-emotional-${i}`,
        content: p.emotional,
        source: `emotional/${p.domain}`,
        timestamp: new Date(2024, 5, 15, 10).toISOString(),
        emotionalContext: "positive-high",
        priority: 2,
      },
      {
        id: `emo-neutral-${i}`,
        content: p.neutral,
        source: `emotional/${p.domain}`,
        timestamp: new Date(2024, 5, 15, 10).toISOString(),
        emotionalContext: "neutral",
        priority: 2,
      },
      // Low-priority padding to trigger pruning during dream cycle
      ...Array.from({ length: 6 }, (_, j) => ({
        id: `emo-padding-${i}-${j}`,
        content: `Routine ${p.domain} update #${j + 1}. Standard operations continuing normally. No significant changes to report. Regular monitoring in place.`,
        source: `emotional/${p.domain}`,
        timestamp: new Date(2024, 5, 15 - 30, 10 + j).toISOString(),
        emotionalContext: "neutral" as const,
        priority: 4,
      })),
    ];

    scenarios.push({
      id: `emotional-recall-${i}`,
      taskId: "emotional-recall",
      description: `Emotional recall: ${p.domain} — ${p.topic}`,
      memories,
      queries: [{ id: `emo-q-${i}`, query: p.query }],
      expected: [{ expectedMemoryIds: [`emo-emotional-${i}`] }],
      config: {
        emotionalId: `emo-emotional-${i}`,
        neutralId: `emo-neutral-${i}`,
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
    emotionalId: string;
    neutralId: string;
  };

  try {
    await clearAgent(agentId);

    // Step 1: Ingest with full pipeline (valence analysis)
    const fixtureMap = await ingestScenario(agentId, scenario.memories, true);
    const emotionalNodeIds = fixtureMap.get(config.emotionalId) || [];
    const neutralNodeIds = fixtureMap.get(config.neutralId) || [];

    // Step 2: Record pre-dream resonance
    const preResonance = await getResonanceScores([
      ...emotionalNodeIds,
      ...neutralNodeIds,
    ]);

    // Step 3: Run dream cycle (resonance + pruning)
    await runDreamCycle(agentId, "sws_only");

    // Step 4: Check survival and post-dream resonance
    const activeNodes = await getActiveNodeIds([
      ...emotionalNodeIds,
      ...neutralNodeIds,
    ]);

    const emotionalSurvived = emotionalNodeIds.some((id) => activeNodes.has(id));
    const neutralSurvived = neutralNodeIds.some((id) => activeNodes.has(id));

    // Decay resistance ratio: emotional should survive better
    const decayResistance =
      emotionalSurvived && !neutralSurvived ? 1.0 :
      emotionalSurvived && neutralSurvived ? 0.7 :
      !emotionalSurvived && !neutralSurvived ? 0.3 : 0.0;

    // Step 5: Search and check rank advantage
    const results = await search(agentId, scenario.queries[0].query, 10);
    const emotionalRank = results.findIndex((r) =>
      emotionalNodeIds.includes(r.id)
    );
    const neutralRank = results.findIndex((r) =>
      neutralNodeIds.includes(r.id)
    );

    // ERA: emotional memory should rank higher (lower index)
    let era = 0.5; // default: no advantage
    if (emotionalRank >= 0 && neutralRank >= 0) {
      era = emotionalRank < neutralRank ? 1.0 : emotionalRank === neutralRank ? 0.5 : 0.0;
    } else if (emotionalRank >= 0 && neutralRank < 0) {
      era = 1.0; // emotional found, neutral not — strong advantage
    } else if (emotionalRank < 0 && neutralRank >= 0) {
      era = 0.0; // neutral found but emotional not — no advantage
    }

    // Post-dream resonance comparison
    const postResonance = await getResonanceScores([
      ...emotionalNodeIds.filter((id) => activeNodes.has(id)),
      ...neutralNodeIds.filter((id) => activeNodes.has(id)),
    ]);

    const avgEmotionalRes = emotionalNodeIds.length > 0
      ? emotionalNodeIds.reduce((s, id) => s + (postResonance.get(id) || 0), 0) / emotionalNodeIds.length
      : 0;
    const avgNeutralRes = neutralNodeIds.length > 0
      ? neutralNodeIds.reduce((s, id) => s + (postResonance.get(id) || 0), 0) / neutralNodeIds.length
      : 0;

    const score = era * 0.6 + decayResistance * 0.4;

    queryResults.push({
      queryId: scenario.queries[0].id,
      passed: score >= 0.6,
      score,
      details: {
        era,
        decayResistance,
        emotionalRank: emotionalRank >= 0 ? emotionalRank + 1 : null,
        neutralRank: neutralRank >= 0 ? neutralRank + 1 : null,
        emotionalSurvived,
        neutralSurvived,
        avgEmotionalResonance: avgEmotionalRes,
        avgNeutralResonance: avgNeutralRes,
      },
    });

    return {
      scenarioId: scenario.id,
      taskId: "emotional-recall",
      passed: score >= 0.6,
      score,
      queryResults,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      taskId: "emotional-recall",
      passed: false,
      score: 0,
      queryResults,
      durationMs: Date.now() - start,
      error: String(err),
    };
  }
}

export const emotionalRecallTask: TaskEvaluator = {
  taskId: "emotional-recall",
  generateScenarios,
  evaluateScenario,
};
