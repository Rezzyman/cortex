/**
 * Procedural Memory Types
 *
 * Biological basis:
 *   - Episodic memory (hippocampus): "what happened" — events, conversations, experiences
 *   - Semantic memory (neocortex): "what I know" — facts, concepts, relationships
 *   - Procedural memory (basal ganglia/cerebellum): "how to do things" — skills, habits, workflows
 *
 * Current CORTEX conflates all three into memory_nodes. This module separates
 * procedural memory: skills, workflows, patterns, and learned behaviors that
 * should be retrieved by TASK TYPE rather than by semantic similarity.
 *
 * Key differences from episodic memory:
 *   - Procedural memories don't decay with time (skills persist)
 *   - They strengthen with repeated execution (practice makes perfect)
 *   - They're retrieved by task context, not content similarity
 *   - They can be refined/versioned as the agent gets better
 */

/** The type of procedural knowledge */
export type ProceduralType =
  | "skill"        // A capability: "how to write a cold outreach email"
  | "workflow"     // A multi-step process: "client onboarding sequence"
  | "pattern"      // A recognized pattern: "when a client asks X, do Y"
  | "preference"   // A learned preference: "User prefers bullet points over paragraphs"
  | "heuristic";   // A rule of thumb: "always confirm budget before scoping"

/** Proficiency level (improves with execution) */
export type ProficiencyLevel =
  | "novice"       // First encounter, untested
  | "competent"    // Executed successfully a few times
  | "proficient"   // Reliable, consistent results
  | "expert";      // Optimized, can adapt to edge cases

/** A single procedural memory entry */
export interface ProceduralMemory {
  id: number;
  agentId: number;
  /** What this skill/workflow/pattern is */
  name: string;
  /** Detailed description of how to execute */
  description: string;
  /** The type of procedural knowledge */
  proceduralType: ProceduralType;
  /** When this procedure applies (trigger conditions) */
  triggerContext: string;
  /** Step-by-step execution (for workflows) or key principles (for skills) */
  steps: string[];
  /** Current proficiency level */
  proficiency: ProficiencyLevel;
  /** Times this procedure has been executed/applied */
  executionCount: number;
  /** Times it produced a successful outcome */
  successCount: number;
  /** Success rate = successCount / executionCount */
  successRate: number;
  /** Tags for retrieval by task context */
  domainTags: string[];
  /** IDs of episodic memories where this was learned/applied */
  sourceMemoryIds: number[];
  /** Version — increments on refinement */
  version: number;
}

/** Result of procedural memory retrieval */
export interface ProceduralMatch {
  memory: ProceduralMemory;
  relevanceScore: number;
  matchType: "trigger" | "domain" | "semantic";
}
