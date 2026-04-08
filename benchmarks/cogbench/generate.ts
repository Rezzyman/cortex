/**
 * CogBench — Dataset Generator
 *
 * Generates synthetic test scenarios for all 7 cognitive memory tasks.
 * Output is a self-contained JSON file that can be distributed independently.
 *
 * No database connection required — pure data generation.
 *
 * Usage:
 *   npx tsx benchmarks/cogbench/generate.ts [--seed 42] [--count 75] [--out dataset/cogbench-v1.json]
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { CogBenchDataset, TaskId, Scenario, TaskEvaluator } from "./types.js";
import { ALL_TASKS } from "./types.js";
import { temporalValidityTask } from "./tasks/temporal-validity.js";
import { reconsolidationTask } from "./tasks/reconsolidation.js";
import { noveltyDetectionTask } from "./tasks/novelty-detection.js";
import { emotionalRecallTask } from "./tasks/emotional-recall.js";
import { crossAgentTransferTask } from "./tasks/cross-agent-transfer.js";
import { compoundingIntelligenceTask } from "./tasks/compounding-intelligence.js";
import { proceduralLearningTask } from "./tasks/procedural-learning.js";

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

/** Default per-task scenario counts. Total ≈ 500. */
const DEFAULT_COUNTS: Record<TaskId, number> = {
  "temporal-validity": 10,
  "reconsolidation": 10,
  "novelty-detection": 5,
  "emotional-recall": 8,
  "cross-agent-transfer": 5,
  "compounding-intelligence": 5,
  "procedural-learning": 6,
};

// ─── CLI ───────────────────────────────────────────────

const args = process.argv.slice(2);
const seed = args.includes("--seed")
  ? parseInt(args[args.indexOf("--seed") + 1])
  : 42;
const countOverride = args.includes("--count")
  ? parseInt(args[args.indexOf("--count") + 1])
  : 0;
const outPath = args.includes("--out")
  ? args[args.indexOf("--out") + 1]
  : join(__dirname, "dataset", "cogbench-v1.json");

// ─── Generate ──────────────────────────────────────────

console.log("╔══════════════════════════════════════════════╗");
console.log("║        CogBench Dataset Generator            ║");
console.log("╚══════════════════════════════════════════════╝\n");
console.log(`Seed: ${seed}`);

const tasks: Record<TaskId, Scenario[]> = {} as Record<TaskId, Scenario[]>;
let totalScenarios = 0;
const perTask: Record<TaskId, number> = {} as Record<TaskId, number>;

for (const taskId of ALL_TASKS) {
  const evaluator = TASK_EVALUATORS[taskId];
  const count = countOverride > 0 ? countOverride : DEFAULT_COUNTS[taskId];

  // Each task gets a derived seed for independent reproducibility
  const taskSeed = seed + ALL_TASKS.indexOf(taskId) * 1000;
  const scenarios = evaluator.generateScenarios(taskSeed, count);

  tasks[taskId] = scenarios;
  perTask[taskId] = scenarios.length;
  totalScenarios += scenarios.length;

  console.log(`  ${taskId}: ${scenarios.length} scenarios`);
}

const dataset: CogBenchDataset = {
  version: "1.0.0",
  generatedAt: new Date().toISOString(),
  seed,
  tasks,
  stats: { totalScenarios, perTask },
};

// ─── Write ─────────────────────────────────────────────

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(dataset, null, 2));

console.log(`\nTotal: ${totalScenarios} scenarios`);
console.log(`Output: ${outPath}`);
console.log(`Size: ${(Buffer.byteLength(JSON.stringify(dataset)) / 1024).toFixed(1)} KB`);
