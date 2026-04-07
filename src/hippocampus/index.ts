/**
 * Digital Hippocampus — Entry Point
 *
 * The hippocampal encoding layer sits between embedding and storage:
 *
 *   embed(chunk) → hippocampalEncode(DG + CA1) → store → form synapses
 *
 * DG (Dentate Gyrus): Pattern separation via sparse coding
 * CA1: Novelty detection via predictive coding comparator
 * CA3: Pattern completion at recall time (separate module)
 */

export { dgEncode, sparseOverlap, sparseJaccard, DG_CONFIG } from "./dentate-gyrus.js";
export { computeNovelty } from "./ca1-novelty.js";
export { patternComplete } from "./ca3-pattern-completion.js";
export type {
  SparseCode,
  NoveltyResult,
  HippocampalEncoding,
  CompletionResult,
} from "./types.js";

import { dgEncode } from "./dentate-gyrus.js";
import { computeNovelty } from "./ca1-novelty.js";
import type { HippocampalEncoding } from "./types.js";

/**
 * Full hippocampal encoding pipeline for a single memory chunk.
 *
 * Called during ingestion after Voyage embedding, before DB storage.
 * Adds ~2-10ms latency (negligible vs ~200-500ms embedding API call).
 *
 * @param agentId - Agent ID for network comparison
 * @param denseEmbedding - 1024-dim Voyage-3 embedding
 * @param basePriority - Starting priority level (0-4)
 * @returns Sparse code + novelty result for storage
 */
export async function hippocampalEncode(
  agentId: number,
  denseEmbedding: number[],
  basePriority: number
): Promise<HippocampalEncoding> {
  // Step 1: DG pattern separation (pure math, ~1-5ms)
  const sparseCode = dgEncode(denseEmbedding);

  // Step 2: CA1 novelty detection (1 DB query, ~5-20ms)
  const noveltyResult = await computeNovelty(
    agentId,
    denseEmbedding,
    sparseCode,
    basePriority
  );

  return { sparseCode, noveltyResult };
}
