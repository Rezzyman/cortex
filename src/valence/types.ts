/**
 * Emotional Valence Types
 *
 * Multi-dimensional emotional context for memories, replacing
 * the simple priority 0-4 integer with a rich emotional fingerprint.
 *
 * Based on the circumplex model of affect (Russell 1980) extended
 * with dimensions relevant to AI agent cognition:
 *
 *   - valence: negative ← 0 → positive (pleasure/displeasure)
 *   - arousal: calm ← 0 → intense (activation level)
 *   - dominance: submissive ← 0 → dominant (sense of control)
 *   - certainty: uncertain ← 0 → certain (epistemic confidence)
 *   - relevance: peripheral ← 0 → core (how central to agent's mission)
 *   - urgency: no time pressure ← 0 → immediate (temporal salience)
 *
 * All dimensions normalized to [-1, 1] except relevance and urgency [0, 1].
 */

/** 6-dimensional emotional vector attached to each memory */
export interface EmotionalVector {
  /** Positive/negative affect. -1 = distressing, 0 = neutral, 1 = rewarding */
  valence: number;
  /** Activation intensity. -1 = calm/routine, 0 = moderate, 1 = urgent/intense */
  arousal: number;
  /** Sense of agency/control. -1 = helpless/blocked, 0 = neutral, 1 = empowered/decisive */
  dominance: number;
  /** Epistemic confidence. -1 = uncertain/speculative, 0 = mixed, 1 = confirmed/verified */
  certainty: number;
  /** Mission relevance. 0 = peripheral context, 1 = core to agent's purpose */
  relevance: number;
  /** Time pressure. 0 = no deadline, 1 = immediate action needed */
  urgency: number;
}

/** Emotional salience score derived from the vector */
export interface EmotionalSalience {
  /** Overall emotional intensity (magnitude of the vector) */
  intensity: number;
  /** Decay resistance: how much this emotion protects the memory from pruning (0-1) */
  decayResistance: number;
  /** Recall boost: how much this emotion enhances retrieval priority (0-1) */
  recallBoost: number;
  /** The dominant emotional dimension */
  dominantDimension: keyof EmotionalVector;
}

/** Combined output from emotional analysis */
export interface ValenceResult {
  vector: EmotionalVector;
  salience: EmotionalSalience;
}

/** Default neutral emotional vector */
export const NEUTRAL_VECTOR: EmotionalVector = {
  valence: 0,
  arousal: 0,
  dominance: 0,
  certainty: 0,
  relevance: 0.3,
  urgency: 0,
};
