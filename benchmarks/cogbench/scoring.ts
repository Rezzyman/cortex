/**
 * CogBench — Scoring Engine
 *
 * Computes task-specific metrics and the composite CogBench score.
 * The composite is the geometric mean of per-task scores, preventing
 * one high score from masking failures in other capabilities.
 */

import type {
  TaskId,
  TaskScore,
  ScenarioResult,
  CogBenchResults,
} from "./types.js";

// ─── Per-Task Aggregation ──────────────────────────────

export function scoreTask(
  taskId: TaskId,
  results: ScenarioResult[]
): TaskScore {
  if (results.length === 0) {
    return {
      taskId,
      totalScenarios: 0,
      passed: 0,
      failed: 0,
      meanScore: 0,
      medianScore: 0,
      metrics: {},
    };
  }

  const scores = results.map((r) => r.score);
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const passed = results.filter((r) => r.passed).length;
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Extract task-specific metrics from individual results
  const metrics = extractTaskMetrics(taskId, results);

  return {
    taskId,
    totalScenarios: results.length,
    passed,
    failed: results.length - passed,
    meanScore: mean,
    medianScore: median,
    metrics,
  };
}

// ─── Task-Specific Metrics ─────────────────────────────

function extractTaskMetrics(
  taskId: TaskId,
  results: ScenarioResult[]
): Record<string, number> {
  const allDetails = results.flatMap((r) =>
    r.queryResults.map((q) => q.details)
  );

  switch (taskId) {
    case "temporal-validity":
      return {
        temporalPrecision: avgField(allDetails, "temporalPrecision"),
        temporalRecall: avgField(allDetails, "temporalRecall"),
        expiryCompliance: avgField(allDetails, "expiryCompliance"),
      };
    case "reconsolidation":
      return {
        updateSuccessRate: avgField(allDetails, "updateSuccess"),
        labileCompliance: avgField(allDetails, "labileCompliance"),
        contentAccuracy: avgField(allDetails, "contentAccuracy"),
      };
    case "novelty-detection":
      return {
        noveltyAUC: avgField(allDetails, "auc"),
        truePositiveRate: avgField(allDetails, "tpr"),
        falsePositiveRate: avgField(allDetails, "fpr"),
      };
    case "emotional-recall":
      return {
        emotionalRecallAdvantage: avgField(allDetails, "era"),
        decayResistanceRatio: avgField(allDetails, "decayResistance"),
      };
    case "cross-agent-transfer":
      return {
        transferRecall: avgField(allDetails, "transferRecall"),
        knowledgeLossRate: avgField(allDetails, "knowledgeLoss"),
      };
    case "compounding-intelligence":
      return {
        compoundGain: avgField(allDetails, "compoundGain"),
        synapseUtilization: avgField(allDetails, "synapseUtil"),
      };
    case "procedural-learning":
      return {
        proficiencyAccuracy: avgField(allDetails, "proficiencyAccuracy"),
        contextRetrievalPrecision: avgField(allDetails, "retrievalPrecision"),
      };
    default:
      return {};
  }
}

function avgField(
  details: Record<string, unknown>[],
  field: string
): number {
  const values = details
    .map((d) => d[field])
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── Composite Score ───────────────────────────────────

/**
 * Geometric mean of per-task mean scores.
 * Returns 0 if any task scores 0 (reflects that all capabilities matter).
 * Epsilon-floored at 0.001 to avoid log(0) when a task has partial success.
 */
export function compositeScore(taskScores: TaskScore[]): number {
  if (taskScores.length === 0) return 0;
  const means = taskScores.map((t) => Math.max(t.meanScore, 0.001));
  const logSum = means.reduce((s, m) => s + Math.log(m), 0);
  return Math.exp(logSum / means.length);
}

// ─── Confidence Interval (Bootstrap) ───────────────────

/**
 * Bootstrap 95% confidence interval for a set of scores.
 */
export function bootstrapCI(
  scores: number[],
  nBootstrap: number = 1000,
  seed: number = 42
): { lower: number; upper: number; mean: number } {
  if (scores.length === 0) return { lower: 0, upper: 0, mean: 0 };

  let rng = seed;
  const nextRand = () => {
    rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  const means: number[] = [];
  for (let b = 0; b < nBootstrap; b++) {
    let sum = 0;
    for (let i = 0; i < scores.length; i++) {
      const idx = Math.floor(nextRand() * scores.length);
      sum += scores[idx];
    }
    means.push(sum / scores.length);
  }

  means.sort((a, b) => a - b);
  const lo = Math.floor(0.025 * means.length);
  const hi = Math.floor(0.975 * means.length);

  return {
    lower: means[lo],
    upper: means[hi],
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
  };
}

// ─── Report Formatting ─────────────────────────────────

export function formatResults(results: CogBenchResults): string {
  let out = "";
  out += "╔══════════════════════════════════════════════╗\n";
  out += "║          CogBench Results                    ║\n";
  out += "╚══════════════════════════════════════════════╝\n\n";
  out += `System: ${results.system}\n`;
  out += `Version: ${results.version}\n`;
  out += `Timestamp: ${results.timestamp}\n`;
  out += `Composite Score: ${(results.compositeScore * 100).toFixed(1)}%\n\n`;

  out += "─── Per-Task Scores ───\n\n";
  out += "| Task | Scenarios | Pass Rate | Mean | Median |\n";
  out += "|------|-----------|-----------|------|--------|\n";

  for (const t of results.tasks) {
    const passRate = t.totalScenarios > 0
      ? ((t.passed / t.totalScenarios) * 100).toFixed(1)
      : "0.0";
    out += `| ${t.taskId} | ${t.totalScenarios} | ${passRate}% | ${(t.meanScore * 100).toFixed(1)}% | ${(t.medianScore * 100).toFixed(1)}% |\n`;
  }

  out += "\n─── Task-Specific Metrics ───\n\n";
  for (const t of results.tasks) {
    if (Object.keys(t.metrics).length === 0) continue;
    out += `### ${t.taskId}\n`;
    for (const [k, v] of Object.entries(t.metrics)) {
      out += `  ${k}: ${(v * 100).toFixed(1)}%\n`;
    }
    out += "\n";
  }

  out += `─── Timing ───\n`;
  out += `Total: ${(results.timing.totalMs / 1000).toFixed(1)}s\n`;
  for (const [task, ms] of Object.entries(results.timing.perTask)) {
    out += `  ${task}: ${(ms / 1000).toFixed(1)}s\n`;
  }

  return out;
}
