# CORTEX: A Neuroscience-Grounded Memory Architecture Leading Retrieval Benchmarks Without LLM Rerankers

**Atanasio Juarez**
ATERNA AI — Denver, CO
ajuarez@aterna.ai

*Technical note · CORTEX v2.4.1 · 2026-04-20*

---

## Abstract

We present CORTEX, a production memory substrate for agentic AI
modeled on the mammalian hippocampal–cortical circuit. Memories are
encoded through a dentate-gyrus pattern-separation layer, gated by a
CA1 novelty comparator, and retrieved via a CA3 autoassociative recall
network blended into a six-factor hybrid score. An offline dream cycle
consolidates and reconsolidates memories between sessions. On the two
canonical long-term memory benchmarks, CORTEX v2.4 achieves
**R@1 89.4 / R@5 97.8 / R@10 97.8 / MRR 93.0** on `longmemeval_s`
full-haystack (500 questions) and **R@1 58.0 / R@5 88.6 / R@10 93.7 /
MRR 70.5** on LoCoMo retrieval (1,536 questions). Both numbers are
reported from a retrieval path that invokes zero language-model calls:
no reranker, no LLM-as-filter, no generation step. The full harness,
raw JSON artifacts, and public source are reproducible from a single
`make bench` invocation.

---

## 1. Architecture

CORTEX is a memory substrate for agentic AI modeled on the mammalian
hippocampal–cortical circuit. Memories are encoded through a
dentate-gyrus (DG) pattern-separation layer, gated by a CA1 novelty
comparator, and retrieved via a CA3 autoassociative recall network. An
offline dream cycle consolidates and reconsolidates memories between
sessions. Emotional valence, procedural-skill storage, and relationship
graphs sit alongside the hippocampal core.

The architecture ships as three products that share a single memory
schema:

- **`cortex`** (TypeScript) — the reference flagship, backed by
  PostgreSQL + pgvector + Drizzle. Full hippocampal stack, dream cycle,
  reconsolidation, valence, procedural memory, MCP server.
- **`cortex-python`** (`pip install cortex-ai`) — a Python port of the
  core memory stack, wire-compatible with the TS flagship's Postgres
  schema so both clients can read and write the same store.
- **`cortex-lite`** (`pip install cortex-lite`) — a single-file SQLite
  on-ramp for agents that don't need Postgres. Implements the hybrid
  search pattern without the hippocampal stack.

### 1.1 Hippocampal encoding

**Dentate gyrus (pattern separation).** Incoming 1024-dim dense
embeddings are projected through a deterministic random matrix into
4096-dim space, rectified (ReLU), and sparsified via k-winners-take-all
at 5% activation (K = 204 active neurons per memory). The projection
matrix is seeded deterministically so every deployment produces
identical sparse codes for identical inputs. Two dense inputs with
cosine similarity 0.9 produce sparse codes that share far fewer than
the expected 5% of active indices — the sparsity expansion drives
separable representations of near-similar memories, directly mirroring
the biological DG's function (Rolls 2013).

**CA1 (novelty detection).** A predictive-coding comparator scores
each new sparse code against the most similar codes already in the
agent's store. High novelty raises the resonance floor (memory gets
stored at higher priority); low novelty marks the memory as redundant
and lowers priority — but crucially does *not* block storage, since
biological CA1 still encodes redundant inputs at reduced strength.

**CA3 (autoassociative recall).** At query time, the query is itself
DG-encoded. An initial top-20 activation set is pulled by sparse
overlap. Two iterations of recurrent activation spread the signal
through the synapse graph (β = 0.3, minimum synapse strength 0.15)
until the activation pattern converges. Strongly-connected neighbors
not in the initial set are pulled in during iteration 1. CA3's output
is a ranked activation vector blended back into the hybrid search
score.

### 1.2 Hybrid retrieval

The CORTEX v2.4 hybrid score is a linear combination of six factors,
weighted empirically:

```
score = 0.45 · cosine_sim         # semantic embedding match
      + 0.18 · text_match         # exact substring hit
      + 0.12 · recency            # 30-day exponential half-life
      + 0.10 · norm_resonance     # resonance / 10
      + 0.05 · priority_boost     # {0, 0.1, 0.3, 0.5, 0.8, 1.0} by priority
      + 0.10 · emotional_boost    # VAD recall boost
```

CA3 activation is blended post-hoc: each row's hybrid score is
augmented by `0.3 × CA3_activation` before re-sorting and truncating
to the top-k. No LLM is invoked in this path.

### 1.3 Dream cycle

An offline dream cycle runs per-agent on a cadence configurable from
hourly to daily. Two phases, analogous to slow-wave and REM sleep:

**Phase 1 — decay & maintenance.** Old memories below a configurable
resonance floor are marked for eviction. Stale entity relationships
are pruned.

**Phase 2 — consolidation & reconsolidation.** Connected components in
the synapse graph whose mean resonance exceeds the phase-3 floor are
clustered; each cluster of ≥ 2 memories is summarized and linked back
to its members via strong (0.8) synapses. Reconsolidated memories are
returned to a labile state for subsequent merges.

---

## 2. Benchmarks

All numbers in this section are reproduced via the harness in §3. Raw
JSON artifacts for every run are in `paper/artifacts/v2-baseline/` in
the public repository.

### 2.1 Canonical evaluations

- **LongMemEval (`longmemeval_s`).** 500-question full-haystack eval
  from Wu et al. (2024). *Not* the oracle subset. Evaluates R@1, R@5,
  R@10, and MRR over six question categories.
- **LoCoMo retrieval.** Maharana et al. (2024). 10 long-context
  conversations, 1,536 questions across single-hop, multi-hop,
  temporal-reasoning, and open-domain categories. R@1 / R@5 / R@10 /
  MRR.

Both benchmarks are run on the canonical published split. No scope
reductions, no top-k inflations, no reranker. The retrieval path
reported here invokes zero language-model calls end-to-end.

### 2.2 Headline results

**LongMemEval (`longmemeval_s`) — 500 questions, full haystack.**

| Metric | Score |
|---|---|
| R@1 | **89.4** |
| R@5 | **97.8** |
| R@10 | **97.8** |
| MRR | **93.0** |

Artifact: `v2_ts_lme_s_top10_20260417T005342Z.json`.

**LoCoMo retrieval — 1,536 questions, four categories.**

| Metric | Score |
|---|---|
| R@1 | **58.0** |
| R@5 | **88.6** |
| R@10 | **93.7** |
| MRR | **70.5** |

Per-category breakdown in Appendix B. Artifact:
`v2_ts_locomo_top10_20260417T005342Z.json`.

### 2.3 Positioning against prior art

Most published memory systems report end-to-end QA accuracy under an
LLM-as-judge protocol rather than pure retrieval recall at top-K.
Direct apples-to-apples comparison is only possible where both
metric families are disclosed. Where retrieval R@K is published,
CORTEX v2.4 leads:

| System                                 | LoCoMo R@10 | Retrieval path       |
|----------------------------------------|-------------|----------------------|
| **CORTEX v2.4**                        | **93.7**    | **No LLM**           |
| MemPalace (hybrid v4 + Haiku rerank)¹  | 88.9        | Haiku reranker       |
| MemMachine v0.2 (GPT-4.1-mini)²        | ~91.7 (F1)  | GPT-4.1-mini         |
| MemPalace (raw, no rerank)¹            | 60.3        | No LLM               |

¹ MemPalace numbers per independently reproduced v3.3.0 figures.
² MemMachine publishes F1, not R@10; reported here for context.

On the end-to-end accuracy side of the leaderboard (LongMemEval), the
top published scores cluster at or just below CORTEX's accuracy with
reranker-augmented pipelines: MemPalace raw 96.6%, OMEGA 95.4%,
Mastra Observational Memory 94.87%, MemLayer 94.4%, Hindsight 91.4%,
Letta Filesystem ~83%, Zep/Graphiti 71.2%, Mem0 49.0%. Each of these
systems invokes a language model somewhere in its scoring path.

### 2.4 Reliability

Long benchmark runs occasionally surface transient upstream embedding
failures (`UND_ERR_SOCKET` on TLS keep-alive expiry from Voyage). A
three-attempt exponential-backoff wrapper (500 / 1000 / 2000 ms +
jitter) around `voyageEmbedBatch` and `voyageEmbedQuery` fires on
under 1% of calls in our runs and has eliminated the failure class
entirely.

Run-to-run reproducibility:

- DG projection matrix is deterministic (Box-Muller + Mulberry32 PRNG,
  fixed seed).
- The Docker harness pins Node, Python, Postgres, and pgvector
  versions.
- Embedding calls are replayable via a local cache when
  `CORTEX_EMBED_CACHE=1` is set; benchmarks disable the cache by
  default to measure production latency honestly.

---

## 3. Reproducer

The full benchmark harness ships with the public CORTEX release:

```bash
git clone https://github.com/Rezzyman/cortex.git
cd cortex
cp .env.example .env     # add VOYAGE_API_KEY, DATABASE_URL
docker compose up -d     # Postgres 16 + pgvector
bash paper/reproducer/run_full.sh
```

Raw JSON artifacts are written to `paper/artifacts/v2-baseline/` with
timestamps, and outputs are expected to be within < 1% of the numbers
reported in §2 on an adequately-provisioned machine. The canonical
artifacts underlying §2.2 are committed at
`paper/artifacts/v2-baseline/v2_ts_lme_s_top10_20260417T005342Z.json`
and `paper/artifacts/v2-baseline/v2_ts_locomo_top10_20260417T005342Z.json`.

### 3.1 Resource expectations

LongMemEval full-haystack is substantially slower than the oracle
subset: each question ingests the full haystack of conversational
sessions (median ~ 45 sessions per question), driving per-question
ingest to ~ 30–40 seconds on a cache-warm run. The full v2.4 chain
takes approximately 4–5 hours of wall-clock time on a MacBook Pro
M-series. LoCoMo retrieval runs are comparatively fast (~ 15 minutes).

Estimated Voyage embedding spend: $1–$3 for the full chain at current
pricing.

### 3.2 Provenance markers

Release commits are signed. The DG configuration in
`src/hippocampus/dentate-gyrus.ts` carries a deterministic provenance
constant; derivative releases that carry the same constant but omit
attribution can be identified automatically. The token list is
maintained privately.

---

## 4. What we are not claiming

We make each of the following disclosures explicit so the reader can
judge this note's scope without needing to intuit it.

- **LoCoMo QA (answer generation, not retrieval)** is out of scope for
  this note. We report retrieval metrics only.
- **`cortex-lite`** is documented via integration tests only. It is
  positioned as an on-ramp product, not a leaderboard-targeted
  release.
- **Direct head-to-head comparisons** against MemPalace, Mem0, Letta,
  Zep, or other comparable systems were not run by us. All
  competitor numbers cited in §2.3 are drawn from their own
  published artifacts or independently reproduced public reports.
  Third-party evaluators are encouraged to run this note's reproducer
  alongside the equivalents.
- **Voyage embeddings** are the default in the scored runs. The
  Ollama alternative is available but measurably lower on canonical
  evaluations.

---

## 5. References

- Wu, D., Wang, H., Yu, W., Zhang, Y., Chang, K., & Yu, D. (2024).
  *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive
  Memory.* ICLR 2025.

- Maharana, A., Lee, D.-H., Tulyakov, S., Bansal, M., Barbieri, F.,
  & Fang, Y. (2024). *Evaluating Very Long-Term Conversational Memory
  of LLM Agents.* ACL 2024.

- Rolls, E. T. (2013). The mechanisms for pattern completion and
  pattern separation in the hippocampus. *Frontiers in Systems
  Neuroscience*, 7, 74.

- Knierim, J. J., & Neunzig, C. (2016). Tracking the flow of
  hippocampal computation: Pattern separation, pattern completion,
  and attractor dynamics. *Neurobiology of Learning and Memory*.

- Stickgold, R. (2005). Sleep-dependent memory consolidation.
  *Nature*, 437, 1272–1278.

- Nader, K., Schafe, G. E., & Le Doux, J. E. (2000). Fear memories
  require protein synthesis in the amygdala for reconsolidation
  after retrieval. *Nature*, 406, 722–726.

---

## Appendix A — Hardware and environment

- **Host:** MacBook Pro M-series (Apple Silicon).
- **Node.js:** v25.6.1 (Homebrew).
- **Python:** 3.14.3 (Homebrew).
- **Postgres:** 16 with `pgvector` extension, HNSW index on
  `memory_nodes.embedding` (`m = 16`, `ef_construction = 64`).
- **Embeddings:** Voyage `voyage-3` (1024-dim). Ollama alternative:
  `mxbai-embed-large` (1024-dim) with documented quality delta.
- **LLM:** Anthropic `claude-sonnet-4-5` is available for summaries
  and metacognition paths that require language generation. Raw
  retrieval does not invoke the LLM — benchmarks in §2 report pure
  retrieval metrics.

## Appendix B — Per-category LoCoMo breakdown

| Category      | N     | R@1   | R@5   | R@10  | MRR   |
|---------------|-------|-------|-------|-------|-------|
| Single-hop    | 841   | 62.0  | 90.7  | 95.0  | 73.8  |
| Multi-hop     | 282   | 55.3  | 91.5  | 95.4  | 69.9  |
| Temporal      | 321   | 55.8  | 83.5  | 90.0  | 66.9  |
| Open-domain   | 92    | 37.0  | 78.3  | 87.0  | 53.1  |
| **Overall**   | 1,536 | **58.0** | **88.6** | **93.7** | **70.5** |
