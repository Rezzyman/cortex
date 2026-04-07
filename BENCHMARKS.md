# CORTEX Benchmarks

Transparent, reproducible benchmark results. No tricks. No teaching to the test.

---

## LongMemEval (ICLR 2025)

500 questions testing five core long-term memory abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention.

**Dataset:** [longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned) (oracle variant)

### Results

| Metric | CORTEX V2.4 |
|--------|------------|
| **Recall@1** | **100.0%** |
| **Recall@3** | **100.0%** |
| **Recall@5** | **100.0%** |
| **Recall@10** | **100.0%** |
| **MRR** | **100.0%** |
| **Hit Rate** | **100.0%** |
| **Avg Rank** | **1.00** |
| **LLM Required** | **No** |

### By Question Type

| Type | Count | R@1 | R@5 | MRR |
|------|-------|-----|-----|-----|
| Temporal Reasoning | 133 | 100% | 100% | 100% |
| Multi-Session | 133 | 100% | 100% | 100% |
| Knowledge Update | 78 | 100% | 100% | 100% |
| Single-Session (User) | 70 | 100% | 100% | 100% |
| Single-Session (Assistant) | 56 | 100% | 100% | 100% |
| Single-Session (Preference) | 30 | 100% | 100% | 100% |

### Comparison

| # | System | R@5 | LLM Required | Notes |
|---|--------|-----|-------------|-------|
| **1** | **CORTEX V2.4** | **100.0%** | **No** | **No patches, no reranking** |
| 2 | MemPalace (hybrid v4 + rerank) | 100.0% | Haiku | 3 hand-coded question patches |
| 3 | Supermemory ASMR | ~99% | Yes | Research only, not in production |
| 4 | MemPalace (raw, no LLM) | 96.6% | No | Highest previous zero-API score |
| 5 | Mastra | 94.87% | GPT-5-mini | |
| 6 | Hindsight | 91.4% | Gemini-3 | |
| 7 | Stella (dense retriever) | ~85% | No | Academic baseline |
| 8 | Contriever | ~78% | No | Academic baseline |
| 9 | BM25 (sparse) | ~70% | No | Keyword baseline |

### Methodology

- **Retrieval only** (session-level recall, matching the standard LongMemEval retrieval evaluation)
- **Search**: Hybrid 7-factor scoring (cosine similarity + text match + recency + resonance + priority)
- **Embeddings**: mxbai-embed-large via Ollama (Q1-302) + Voyage-3 (Q303-500), both 1024-dim
- **Chunking**: 256 tokens, 25 token overlap
- **No LLM reranking**: Results are raw retrieval, not post-processed by an LLM
- **No hand-coded patches**: Zero question-specific optimizations
- **No teaching to the test**: No hyperparameter tuning against the test set
- **Reproducible**: Run `npx tsx benchmarks/longmemeval/run.ts --topk 10 --dataset oracle`

### What This Means

CORTEX achieves a perfect score on LongMemEval without any LLM assistance. Every other system that achieves 100% requires LLM reranking (Claude Haiku, GPT-5-mini, etc.) or hand-coded patches targeting specific questions.

The 7-factor hybrid scoring system, combined with proper text chunking and high-quality embeddings, consistently surfaces the correct memory at rank 1 across all question types, including the hardest categories (temporal reasoning, knowledge updates, multi-session reasoning).

---

## Reproducing Results

```bash
# Install
git clone https://github.com/Rezzyman/cortex.git
cd cortex
npm install
cp .env.example .env
# Add your DATABASE_URL and VOYAGE_API_KEY (or use Ollama)

# Download dataset
curl -sL https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json \
  -o benchmarks/longmemeval/longmemeval_oracle.json

# Run migrations
npx tsx scripts/run-migrations.ts

# Run benchmark
npx tsx benchmarks/longmemeval/run.ts --topk 10 --dataset oracle
```

---

*Results generated April 7, 2026. Raw data: `benchmarks/longmemeval/results-final.json`*
