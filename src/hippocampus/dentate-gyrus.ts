/**
 * Dentate Gyrus — Pattern Separation via Sparse Coding
 *
 * Implements the computational equivalent of DG granule cell expansion:
 *
 *   1. Random projection: 1024-dim dense → 4096-dim expanded (4x expansion
 *      ratio, matching biological ~5x DG granule cell expansion from EC).
 *
 *   2. ReLU nonlinearity: enforce non-negative activations (biological firing
 *      rates are non-negative).
 *
 *   3. k-Winners-Take-All: keep only top 5% of activations (~204 out of 4096),
 *      matching biological DG sparsity (~2-5% activation).
 *
 *   4. L2-normalize: so dot product = cosine similarity for downstream use.
 *
 * Two dense vectors with cosine similarity 0.9 (nearly identical) will activate
 * partially overlapping but distinct sets of ~204 neurons. The probability of
 * overlap in the top-k set drops exponentially with the expansion ratio, making
 * sparse representations far more orthogonal than the dense inputs.
 *
 * References:
 *   - Rolls (2013) "The mechanisms for pattern completion and pattern separation
 *     in the hippocampus"
 *   - Knierim & Neunzig (2016) "Tracking the flow of hippocampal computation:
 *     Pattern separation, pattern completion, and attractor dynamics"
 */

import type { SparseCode } from "./types.js";

const INPUT_DIM = 1024;
const EXPANDED_DIM = 4096;
const SPARSITY_RATIO = 0.05; // ~5% activation, biological DG sparsity
const K = Math.floor(SPARSITY_RATIO * EXPANDED_DIM); // 204 active neurons
const DG_SEED = 314159265; // deterministic projection — pi digits

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Deterministic: same seed always produces the same sequence.
 * This ensures all memories use the identical projection matrix.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic projection matrix W of shape (INPUT_DIM, EXPANDED_DIM).
 * Values drawn from N(0, 1/INPUT_DIM) for variance preservation.
 *
 * Stored as a flat Float32Array for cache-friendly access during matrix multiply.
 * Total size: 1024 * 4096 * 4 bytes = 16MB. Computed once, cached.
 */
function generateProjectionMatrix(): Float32Array {
  const rng = mulberry32(DG_SEED);
  const matrix = new Float32Array(INPUT_DIM * EXPANDED_DIM);
  const scale = 1.0 / Math.sqrt(INPUT_DIM);

  // Box-Muller transform for Gaussian distribution
  for (let i = 0; i < matrix.length; i += 2) {
    const u1 = rng();
    const u2 = rng();
    const r = Math.sqrt(-2.0 * Math.log(u1 || 1e-10));
    const theta = 2.0 * Math.PI * u2;
    matrix[i] = r * Math.cos(theta) * scale;
    if (i + 1 < matrix.length) {
      matrix[i + 1] = r * Math.sin(theta) * scale;
    }
  }

  return matrix;
}

// Lazy singleton — computed on first use, cached for process lifetime
let _projectionMatrix: Float32Array | null = null;

function getProjectionMatrix(): Float32Array {
  if (!_projectionMatrix) {
    _projectionMatrix = generateProjectionMatrix();
  }
  return _projectionMatrix;
}

/**
 * Encode a dense 1024-dim embedding into a sparse 4096-dim DG representation.
 *
 * Performance: ~1-5ms on modern hardware (pure math, no I/O).
 *
 * @param denseEmbedding - 1024-dim Voyage-3 embedding
 * @returns SparseCode with ~204 active indices and L2-normalized values
 */
export function dgEncode(denseEmbedding: number[]): SparseCode {
  if (denseEmbedding.length !== INPUT_DIM) {
    throw new Error(
      `DG encode: expected ${INPUT_DIM}-dim input, got ${denseEmbedding.length}`
    );
  }

  const W = getProjectionMatrix();

  // Step 1: Random projection — z = W^T * x
  const z = new Float32Array(EXPANDED_DIM);
  for (let j = 0; j < EXPANDED_DIM; j++) {
    let sum = 0;
    const offset = j; // column-major: W[i][j] = W[i * EXPANDED_DIM + j]
    for (let i = 0; i < INPUT_DIM; i++) {
      sum += denseEmbedding[i] * W[i * EXPANDED_DIM + offset];
    }
    z[j] = sum;
  }

  // Step 2: ReLU — enforce non-negative activations
  for (let j = 0; j < EXPANDED_DIM; j++) {
    if (z[j] < 0) z[j] = 0;
  }

  // Step 3: k-Winners-Take-All — find the K-th largest value
  // Use a partial sort (selection algorithm) for efficiency
  const activations: Array<{ idx: number; val: number }> = [];
  for (let j = 0; j < EXPANDED_DIM; j++) {
    if (z[j] > 0) {
      activations.push({ idx: j, val: z[j] });
    }
  }

  // Sort descending by value, take top K
  activations.sort((a, b) => b.val - a.val);
  const topK = activations.slice(0, K);

  // Step 4: L2-normalize the sparse vector
  let normSq = 0;
  for (const entry of topK) {
    normSq += entry.val * entry.val;
  }
  const norm = Math.sqrt(normSq) || 1e-10;

  const indices: number[] = [];
  const values: number[] = [];
  for (const entry of topK) {
    indices.push(entry.idx);
    values.push(entry.val / norm);
  }

  return { indices, values, dim: EXPANDED_DIM };
}

/**
 * Compute sparse overlap between two DG codes.
 *
 * This is the sparse equivalent of cosine similarity:
 * sum of min(a[i], b[i]) for shared active indices.
 *
 * Since both vectors are L2-normalized, this is bounded [0, 1].
 *
 * @returns Overlap score in [0, 1]
 */
export function sparseOverlap(a: SparseCode, b: SparseCode): number {
  // Build a map for the smaller code
  const [smaller, larger] =
    a.indices.length <= b.indices.length ? [a, b] : [b, a];

  const map = new Map<number, number>();
  for (let i = 0; i < smaller.indices.length; i++) {
    map.set(smaller.indices[i], smaller.values[i]);
  }

  let overlap = 0;
  for (let i = 0; i < larger.indices.length; i++) {
    const val = map.get(larger.indices[i]);
    if (val !== undefined) {
      overlap += Math.min(val, larger.values[i]);
    }
  }

  return overlap;
}

/**
 * Compute the Jaccard index of active neuron sets (index-level overlap).
 * Useful for understanding structural similarity independent of activation magnitudes.
 */
export function sparseJaccard(a: SparseCode, b: SparseCode): number {
  const setA = new Set(a.indices);
  const setB = new Set(b.indices);
  let intersection = 0;
  for (const idx of setA) {
    if (setB.has(idx)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Export constants for testing and configuration
export const DG_CONFIG = {
  INPUT_DIM,
  EXPANDED_DIM,
  SPARSITY_RATIO,
  K,
  SEED: DG_SEED,
} as const;
