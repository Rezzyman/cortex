/**
 * Emotional Valence Layer — Entry Point
 *
 * Multi-dimensional emotional context for memories.
 * Replaces simple priority 0-4 with a 6-dimensional emotional vector
 * that modulates storage, retrieval, and pruning.
 */

export { analyzeValence, computeSalience } from "./analyzer.js";
export type {
  EmotionalVector,
  EmotionalSalience,
  ValenceResult,
} from "./types.js";
export { NEUTRAL_VECTOR } from "./types.js";
