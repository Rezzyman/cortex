# CORTEX v2.4 Benchmark Reproducer

Scripts that reproduce every number reported in
[`paper/drafts/cortex-v2-4-technical-note.md`](../drafts/cortex-v2-4-technical-note.md).

## Quick start

```bash
# 1. Environment
cp .env.example .env
# Edit .env and fill in VOYAGE_API_KEY and DATABASE_URL

# 2. Postgres + pgvector (optional if you point DATABASE_URL at an external instance)
docker compose up -d db

# 3. Run the benchmark chain
bash paper/reproducer/run_full.sh
```

## What it runs

`run_full.sh` executes, in order:

1. **LongMemEval-s**, full haystack, 500 questions. Writes
   `paper/artifacts/v2-baseline/v2_ts_lme_s_top10_<TS>.json`.
2. **LoCoMo retrieval**, 1,536 questions. Writes
   `paper/artifacts/v2-baseline/v2_ts_locomo_top10_<TS>.json`.

Each stage is timed and logged to
`paper/artifacts/v2-baseline/run_full_<TS>.log`.

## Resource expectations

- **Time:** 4–5 hours wall-clock on a MacBook Pro M-series. The
  `longmemeval_s` full-haystack stage is the long pole (~4 hours due
  to per-question ingestion of 40–50 conversational sessions). LoCoMo
  retrieval is ~15 minutes.
- **Voyage spend:** $1–$3 at current pricing. The retry wrapper on
  embeddings (`src/ingestion/embeddings.ts`) handles transient
  `UND_ERR_SOCKET` failures without manual intervention.
- **Disk:** ~1 GB of Postgres data after ingestion.

## Shorter validation path

If you only want to confirm the retrieval pipeline is wired correctly,
the oracle split finishes in roughly 15 minutes and is expected to
return R@1/5/10/MRR near 1.0 across all 500 oracle questions:

```bash
npx tsx benchmarks/longmemeval/run.ts --topk 10 --dataset oracle
```

## Determinism

- The dentate-gyrus random-projection matrix is deterministic
  (Mulberry32 PRNG seeded with a fixed constant).
- Embedding responses are **not** cached by default; benchmarks
  exercise the live Voyage path to measure production latency
  honestly. Set `CORTEX_EMBED_CACHE=1` to enable local caching for
  faster re-runs during development.

## Questions or verification requests

File an issue on the public repository or email
[`ajuarez@aterna.ai`](mailto:ajuarez@aterna.ai). Pull requests that
improve the reproducer are welcome.
