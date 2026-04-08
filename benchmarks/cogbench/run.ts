/**
 * CogBench — Evaluation Harness
 *
 * Runs the CogBench benchmark suite against a live CORTEX instance.
 * Loads a pre-generated dataset and evaluates each scenario, computing
 * per-task metrics and the composite CogBench score.
 *
 * Requires:
 *   - CORTEX database (DATABASE_URL in .env)
 *   - Embedding service (Voyage API or Ollama)
 *   - Pre-generated dataset (run generate.ts first)
 *
 * Usage:
 *   npx tsx benchmarks/cogbench/run.ts [options]
 *
 * Options:
 *   --dataset <path>    Path to dataset JSON (default: dataset/cogbench-v1.json)
 *   --task <id>         Run only a specific task
 *   --limit <n>         Limit scenarios per task
 *   --skip-dream        Skip tasks requiring dream cycles (faster)
 *   --verbose           Print per-scenario results
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type {
  TaskId,
  CogBenchDataset,
  CogBenchResults,
  ScenarioResult,
  TaskEvaluator,
} from "./types.js";
import { ALL_TASKS } from "./types.js";
import { initCogBench, createAgent, clearAgent } from "./client.js";
import { scoreTask, compositeScore, bootstrapCI, formatResults } from "./scoring.js";
import { temporalValidityTask } from "./tasks/temporal-validity.js";
import { reconsolidationTask } from "./tasks/reconsolidation.js";
import { noveltyDetectionTask } from "./tasks/novelty-detection.js";
import { emotionalRecallTask } from "./tasks/emotional-recall.js";
import { crossAgentTransferTask } from "./tasks/cross-agent-transfer.js";
import { compoundingIntelligenceTask } from "./tasks/compounding-intelligence.js";
import { proceduralLearningTask } from "./tasks/procedural-learning.js";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Task Registry ─────────────────────────────────────

const TASK_EVALUATORS: Record<TaskId, TaskEvaluator> = {
  "temporal-validity": temporalValidityTask,
  "reconsolidation": reconsolidationTask,
  "novelty-detection": noveltyDetectionTask,
  "emotional-recall": emotionalRecallTask,
  "cross-agent-transfer": crossAgentTransferTask,
  "compounding-intelligence": compoundingIntelligenceTask,
  "procedural-learning": proceduralLearningTask,
};

const DREAM_TASKS: TaskId[] = ["emotional-recall", "compounding-intelligence"];

// ─── CLI ───────────────────────────────────────────────

const args = process.argv.slice(2);
const datasetPath = args.includes("--dataset")
  ? args[args.indexOf("--dataset") + 1]
  : join(__dirname, "dataset", "cogbench-v1.json");
const taskFilter = args.includes("--task")
  ? (args[args.indexOf("--task") + 1] as TaskId)
  : null;
const limitArg = args.includes("--limit")
  ? parseInt(args[args.indexOf("--limit") + 1])
  : 0;
const skipDream = args.includes("--skip-dream");
const verbose = args.includes("--verbose");

// ─── Main ──────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║         CogBench Evaluation Harness          ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Load dataset
  console.log(`Loading dataset: ${datasetPath}`);
  const raw = readFileSync(datasetPath, "utf-8");
  const dataset: CogBenchDataset = JSON.parse(raw);
  console.log(`Dataset v${dataset.version} | Seed: ${dataset.seed} | Total: ${dataset.stats.totalScenarios} scenarios\n`);

  // Initialize CORTEX connection
  await initCogBench();

  // Determine which tasks to run
  let tasksToRun: TaskId[] = taskFilter ? [taskFilter] : ALL_TASKS;
  if (skipDream) {
    tasksToRun = tasksToRun.filter((t) => !DREAM_TASKS.includes(t));
    console.log(`Skipping dream-dependent tasks: ${DREAM_TASKS.join(", ")}\n`);
  }

  const allResults: ScenarioResult[] = [];
  const taskTimings: Record<string, number> = {};
  const totalStart = Date.now();

  for (const taskId of tasksToRun) {
    const evaluator = TASK_EVALUATORS[taskId];
    let scenarios = dataset.tasks[taskId];

    if (!scenarios || scenarios.length === 0) {
      console.log(`[${taskId}] No scenarios in dataset — skipping`);
      continue;
    }

    if (limitArg > 0) {
      scenarios = scenarios.slice(0, limitArg);
    }

    console.log(`\n${"═".repeat(50)}`);
    console.log(`  ${taskId} (${scenarios.length} scenarios)`);
    console.log(`${"═".repeat(50)}`);

    const agentId = await createAgent(taskId);
    const taskStart = Date.now();

    for (let si = 0; si < scenarios.length; si++) {
      const scenario = scenarios[si];
      const progress = `[${si + 1}/${scenarios.length}]`;

      try {
        const result = await evaluator.evaluateScenario(scenario, agentId);
        allResults.push(result);

        const status = result.passed ? "PASS" : "FAIL";
        const scoreStr = (result.score * 100).toFixed(1);

        if (verbose || !result.passed) {
          console.log(
            `  ${progress} ${status} ${scoreStr}% | ${scenario.description.slice(0, 60)} | ${result.durationMs}ms`
          );
          if (result.error) {
            console.log(`    ERROR: ${result.error.slice(0, 120)}`);
          }
        } else {
          // Compact progress
          process.stdout.write(
            `\r  ${progress} ${status} ${scoreStr}% | ${result.durationMs}ms`
          );
        }
      } catch (err) {
        const errorResult: ScenarioResult = {
          scenarioId: scenario.id,
          taskId,
          passed: false,
          score: 0,
          queryResults: [],
          durationMs: 0,
          error: String(err),
        };
        allResults.push(errorResult);
        console.log(`  ${progress} ERROR: ${String(err).slice(0, 100)}`);
      }
    }

    if (!verbose) console.log(); // newline after compact progress

    taskTimings[taskId] = Date.now() - taskStart;

    // Cleanup
    await clearAgent(agentId);
  }

  // ─── Scoring ─────────────────────────────────────────

  const taskScores = tasksToRun.map((taskId) =>
    scoreTask(
      taskId,
      allResults.filter((r) => r.taskId === taskId)
    )
  );

  const composite = compositeScore(taskScores);

  // Bootstrap CI for composite
  const allScores = allResults.map((r) => r.score);
  const ci = bootstrapCI(allScores, 2000, dataset.seed);

  const results: CogBenchResults = {
    benchmark: "CogBench",
    version: dataset.version,
    system: "CORTEX V2.4",
    timestamp: new Date().toISOString(),
    compositeScore: composite,
    tasks: taskScores,
    scenarios: allResults,
    timing: {
      totalMs: Date.now() - totalStart,
      perTask: taskTimings as Record<TaskId, number>,
    },
  };

  // ─── Output ──────────────────────────────────────────

  console.log("\n" + formatResults(results));

  console.log(`\n95% CI: [${(ci.lower * 100).toFixed(1)}%, ${(ci.upper * 100).toFixed(1)}%]`);

  // Save results
  const outputPath = join(__dirname, "results.json");
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  // Print failure summary
  const failures = allResults.filter((r) => !r.passed);
  if (failures.length > 0 && failures.length <= 20) {
    console.log(`\n─── Failed Scenarios (${failures.length}) ───\n`);
    for (const f of failures) {
      console.log(`  ${f.taskId}/${f.scenarioId}: score=${(f.score * 100).toFixed(1)}%${f.error ? ` ERROR: ${f.error.slice(0, 80)}` : ""}`);
    }
  }
}

main().catch((err) => {
  console.error("CogBench failed:", err);
  process.exit(1);
});
