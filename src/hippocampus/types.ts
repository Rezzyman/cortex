/**
 * Hippocampal Encoding Types
 *
 * Sparse codes, novelty results, and pattern completion interfaces
 * for the Digital Hippocampus layer (DG → CA1 → CA3).
 */

/** Sparse representation from Dentate Gyrus pattern separation */
export interface SparseCode {
  /** Active neuron indices in the expanded space */
  indices: number[];
  /** Corresponding activation values (L2-normalized) */
  values: number[];
  /** Dimensionality of the expanded space */
  dim: number;
}

/** Novelty detection result from CA1 comparator */
export interface NoveltyResult {
  /** Combined novelty score (0 = redundant, 1 = completely novel) */
  noveltyScore: number;
  /** Adjusted resonance score based on novelty */
  resonanceScore: number;
  /** Adjusted priority based on novelty */
  adjustedPriority: number;
  /** Dense-space similarity to predicted centroid */
  predictedSimilarity: number;
  /** Sparse-space mismatch score */
  sparseMismatch: number;
}

/** Full hippocampal encoding output */
export interface HippocampalEncoding {
  sparseCode: SparseCode;
  noveltyResult: NoveltyResult;
}

/** CA3 pattern completion result */
export interface CompletionResult {
  memoryId: number;
  activationScore: number;
  sparseOverlap: number;
  synapticBoost: number;
}
