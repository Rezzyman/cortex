/**
 * CogBench — Type Definitions
 *
 * Shared types for the Cognitive Memory Benchmark suite.
 * Tests 7 capabilities no existing benchmark measures.
 */

// ─── Task Identifiers ──────────────────────────────────

export type TaskId =
  | "temporal-validity"
  | "reconsolidation"
  | "novelty-detection"
  | "emotional-recall"
  | "cross-agent-transfer"
  | "compounding-intelligence"
  | "procedural-learning";

export const ALL_TASKS: TaskId[] = [
  "temporal-validity",
  "reconsolidation",
  "novelty-detection",
  "emotional-recall",
  "cross-agent-transfer",
  "compounding-intelligence",
  "procedural-learning",
];

// ─── Dataset Schema ────────────────────────────────────

/** A single memory to ingest as part of a scenario. */
export interface MemoryFixture {
  id: string;
  content: string;
  source: string;
  /** ISO-8601 timestamp for ingestion ordering */
  timestamp: string;
  /** Optional temporal validity bounds */
  validFrom?: string;
  validUntil?: string;
  /** Optional emotional charge description */
  emotionalContext?: "neutral" | "positive-high" | "negative-high" | "positive-low" | "negative-low";
  /** Which agent this memory belongs to (for cross-agent tasks) */
  agentTag?: string;
  /** Priority level 0-4 */
  priority?: number;
}

/** A query to evaluate against the ingested memories. */
export interface QueryFixture {
  id: string;
  query: string;
  /** ISO-8601 timestamp representing "now" for the query */
  queryTimestamp?: string;
}

/** Expected outcome for a scenario. Task-specific fields. */
export interface ExpectedOutcome {
  /** Memory IDs that should be retrieved */
  expectedMemoryIds?: string[];
  /** Memory IDs that should NOT be retrieved */
  excludedMemoryIds?: string[];
  /** For reconsolidation: expected updated content */
  expectedContent?: string;
  /** For novelty: expected novelty classification */
  expectedNovelty?: "high" | "low" | "redundant";
  /** For procedural: expected proficiency level */
  expectedProficiency?: string;
  /** For temporal: whether the query should return any results */
  expectsResults?: boolean;
  /** Free-form expected answer for LLM-judged tasks */
  expectedAnswer?: string;
}

/** A complete test scenario for a single task. */
export interface Scenario {
  id: string;
  taskId: TaskId;
  /** Human-readable description of what's being tested */
  description: string;
  /** Memories to ingest before evaluation */
  memories: MemoryFixture[];
  /** Queries to evaluate */
  queries: QueryFixture[];
  /** Expected outcomes (one per query, matched by index) */
  expected: ExpectedOutcome[];
  /** Task-specific configuration */
  config?: Record<string, unknown>;
}

/** Full generated dataset. */
export interface CogBenchDataset {
  version: string;
  generatedAt: string;
  seed: number;
  tasks: Record<TaskId, Scenario[]>;
  stats: {
    totalScenarios: number;
    perTask: Record<TaskId, number>;
  };
}

// ─── Evaluation Results ────────────────────────────────

/** Result of evaluating a single query within a scenario. */
export interface QueryResult {
  queryId: string;
  passed: boolean;
  score: number;
  details: Record<string, unknown>;
}

/** Result of evaluating a full scenario. */
export interface ScenarioResult {
  scenarioId: string;
  taskId: TaskId;
  passed: boolean;
  score: number;
  queryResults: QueryResult[];
  durationMs: number;
  error?: string;
}

/** Per-task aggregate scores. */
export interface TaskScore {
  taskId: TaskId;
  totalScenarios: number;
  passed: number;
  failed: number;
  meanScore: number;
  medianScore: number;
  /** Task-specific metrics */
  metrics: Record<string, number>;
}

/** Full benchmark results. */
export interface CogBenchResults {
  benchmark: "CogBench";
  version: string;
  system: string;
  timestamp: string;
  /** Aggregate score: geometric mean of per-task means */
  compositeScore: number;
  tasks: TaskScore[];
  scenarios: ScenarioResult[];
  timing: {
    totalMs: number;
    perTask: Record<TaskId, number>;
  };
}

// ─── Task Evaluator Interface ──────────────────────────

/** Every task module exports this interface. */
export interface TaskEvaluator {
  taskId: TaskId;
  /** Generate synthetic scenarios for this task */
  generateScenarios(seed: number, count: number): Scenario[];
  /** Evaluate a single scenario against a live CORTEX instance */
  evaluateScenario(
    scenario: Scenario,
    agentId: number
  ): Promise<ScenarioResult>;
}
