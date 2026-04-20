#!/usr/bin/env bash
# CORTEX v2.4 — Benchmark reproducer.
# Reproduces the LongMemEval and LoCoMo retrieval numbers reported in
# paper/drafts/cortex-v2-4-technical-note.md.
#
# Prerequisites:
#   - Postgres + pgvector reachable via DATABASE_URL in .env
#   - VOYAGE_API_KEY in .env (for embeddings)
#   - Node.js satisfying package.json's engines field
#
# Usage:
#   bash paper/reproducer/run_full.sh [--limit N]
#
# The optional --limit N argument runs a subset for smoke-testing.

set -e
set -o pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ART_DIR="$REPO_ROOT/paper/artifacts/v2-baseline"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$ART_DIR/run_full_${TS}.log"

mkdir -p "$ART_DIR"
exec > >(tee "$LOG") 2>&1

LIMIT_ARG=""
for a in "$@"; do
  case "$a" in
    --limit)
      shift
      LIMIT_ARG="--limit $1"
      ;;
  esac
done

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Reproducer start: ${LIMIT_ARG:-full 500Q}"

cd "$REPO_ROOT"

# --- Preflight ---
if [ ! -f ".env" ]; then
  echo "ERROR: missing .env (copy from .env.example and fill VOYAGE_API_KEY + DATABASE_URL)"
  exit 1
fi
if ! grep -q "^VOYAGE_API_KEY=" .env; then
  echo "ERROR: VOYAGE_API_KEY not set in .env"
  exit 1
fi
if ! grep -q "^DATABASE_URL=" .env; then
  echo "ERROR: DATABASE_URL not set in .env"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "WARN: docker not found; assuming external Postgres + pgvector is already reachable via DATABASE_URL"
else
  if ! docker compose ps db 2>/dev/null | grep -q running; then
    echo "Starting Postgres via docker compose..."
    docker compose up -d db
    sleep 5
  fi
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

# --- Datasets ---
LME_FILE="benchmarks/longmemeval/longmemeval_s.json"
LOCOMO_FILE="benchmarks/locomo/locomo10.json"

if [ ! -f "$LME_FILE" ]; then
  echo "Downloading LongMemEval (cleaned, s split)..."
  curl -sL \
    "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s.json" \
    -o "$LME_FILE"
fi

if [ ! -f "$LOCOMO_FILE" ]; then
  echo "Downloading LoCoMo..."
  curl -sL \
    "https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json" \
    -o "$LOCOMO_FILE"
fi

# --- Stage 1: LongMemEval-s full haystack ---
echo ""
echo "=== [1/2] LongMemEval-s (500 questions, full haystack) ==="
time npx tsx benchmarks/longmemeval/run.ts --topk 10 --dataset s $LIMIT_ARG
cp benchmarks/longmemeval/results-s-top10.json \
   "$ART_DIR/v2_ts_lme_s_top10_${TS}.json"

# --- Stage 2: LoCoMo retrieval ---
echo ""
echo "=== [2/2] LoCoMo retrieval (1,536 questions) ==="
time npx tsx benchmarks/locomo/run-retrieval.ts --topk 10
cp benchmarks/locomo/results-retrieval-top10.json \
   "$ART_DIR/v2_ts_locomo_top10_${TS}.json"

# --- Summary ---
echo ""
echo "========================================================"
echo "  Reproducer complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================================"
echo ""
echo "Artifacts written to $ART_DIR:"
ls -la "$ART_DIR/"*"${TS}"*
