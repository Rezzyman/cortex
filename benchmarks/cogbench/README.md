# CogBench: A Benchmark for Cognitive Memory Architectures

**Version:** 1.0.0  
**Target venue:** ICLR 2026 MemAgents Workshop (April 26–27)  
**Authors:** Atanasio Juarez (ATERNA)

---

## Motivation

Existing memory benchmarks — LongMemEval (ICLR 2025), LoCoMo (ACL 2024), MemBench (ACL 2025), MemoryAgentBench (ICLR 2026) — evaluate only **retrieval accuracy**: can the system find the right document given a query?

This framing misses the cognitive capabilities that distinguish advanced memory architectures from simple vector databases. A system that scores 100% on LongMemEval may still fail to:

- Refuse expired information (temporal validity)
- Update beliefs when facts change (reconsolidation)
- Prioritize novel information over redundant input (novelty detection)
- Recall emotionally salient memories preferentially (emotional recall)
- Transfer knowledge between agent instances (cross-agent transfer)
- Improve retrieval through offline consolidation (compounding intelligence)
- Learn and refine skills through repeated execution (procedural learning)

CogBench tests these 7 capabilities with 49 scenarios and 135 evaluation queries. No existing benchmark measures any of them.

## Tasks

| # | Task | Scenarios | What It Tests | Cognitive Basis |
|---|------|-----------|---------------|-----------------|
| 1 | **Temporal Validity** | 11 | Time-scoped memory retrieval and expiry compliance | Episodic memory temporal indexing |
| 2 | **Reconsolidation** | 10 | Belief updates via labile recall window | Nader et al. 2000; Lee 2009 |
| 3 | **Novelty Detection** | 5 | Distinguishing novel from redundant information | Hippocampal CA1 comparator |
| 4 | **Emotional Recall** | 8 | Preferential recall of emotionally salient memories | Amygdala–hippocampal modulation |
| 5 | **Cross-Agent Transfer** | 5 | Knowledge transfer between agent instances | Social learning / cultural transmission |
| 6 | **Compounding Intelligence** | 5 | Retrieval improvement through consolidation | Sleep-dependent memory consolidation |
| 7 | **Procedural Learning** | 6 | Skill acquisition through repeated execution | Basal ganglia procedural memory |

## Metrics

### Per-Task Metrics

- **Temporal Validity:** Temporal Precision, Temporal Recall, Expiry Compliance Rate
- **Reconsolidation:** Update Success Rate, Labile Window Compliance, Content Accuracy
- **Novelty Detection:** Novelty AUC (ROC area under curve), True Positive Rate, False Positive Rate
- **Emotional Recall:** Emotional Recall Advantage (ERA), Decay Resistance Ratio
- **Cross-Agent Transfer:** Transfer Recall, Knowledge Loss Rate
- **Compounding Intelligence:** Compound Gain (post-consolidation improvement), Synapse Utilization
- **Procedural Learning:** Proficiency Accuracy, Context Retrieval Precision

### Composite Score

Geometric mean of per-task mean scores. This ensures:
- All capabilities contribute equally (no single high score masks weakness)
- A score of 0 on any task yields a composite of 0
- Perfect score requires excellence across all 7 capabilities

### Confidence Intervals

Bootstrap 95% CI (2000 resamples) reported for all aggregate metrics.

## Running CogBench

### Prerequisites

```bash
# Clone and install CORTEX
git clone https://github.com/aterna-ai/cortex.git
cd cortex
npm install
cp .env.example .env
# Configure DATABASE_URL and VOYAGE_API_KEY (or use Ollama for embeddings)
```

### Step 1: Generate Dataset

```bash
npx tsx benchmarks/cogbench/generate.ts --seed 42

# Options:
#   --seed <n>     Random seed for reproducibility (default: 42)
#   --count <n>    Override per-task scenario count
#   --out <path>   Output path (default: benchmarks/cogbench/dataset/cogbench-v1.json)
```

### Step 2: Run Benchmark

```bash
npx tsx benchmarks/cogbench/run.ts

# Options:
#   --dataset <path>   Path to dataset JSON
#   --task <id>        Run only one task (e.g., --task reconsolidation)
#   --limit <n>        Max scenarios per task
#   --skip-dream       Skip tasks requiring dream cycles (faster)
#   --verbose          Print per-scenario detail
```

### Step 3: Results

Results are saved to `benchmarks/cogbench/results.json` with full per-scenario detail.

## Methodology

### Dataset Generation

All scenarios are synthetically generated from curated templates with seeded randomization. Templates cover diverse domains (sales, engineering, HR, finance, healthcare, etc.) to prevent domain overfitting.

Each scenario contains:
- **Memory fixtures:** Pre-written memories to ingest into the system under test
- **Queries:** Evaluation queries with expected outcomes
- **Expected outcomes:** Ground truth for automated scoring

### Evaluation Protocol

1. For each scenario, a fresh benchmark agent is created (isolated from production data)
2. Memory fixtures are ingested through the system's full pipeline
3. Queries are executed and results compared against expected outcomes
4. Agent data is cleared between scenarios (clean slate)

### Scoring

Scores are computed at three levels:
1. **Query-level:** Binary pass/fail + continuous score [0, 1]
2. **Scenario-level:** Mean of query scores within the scenario
3. **Task-level:** Mean/median of scenario scores + task-specific metrics

### Anti-Gaming

- Dataset is synthetic and can be regenerated with different seeds
- No hyperparameter tuning against the test set
- Scoring formulas are deterministic and auditable
- Full scenario results saved for manual inspection

## Comparison to Existing Benchmarks

| Capability | CogBench | LongMemEval | LoCoMo | MemBench | MemAgentBench |
|------------|----------|-------------|--------|----------|---------------|
| Temporal validity | yes | partial | no | no | no |
| Reconsolidation | yes | no | no | no | partial |
| Novelty detection | yes | no | no | no | no |
| Emotional recall | yes | no | no | no | no |
| Cross-agent transfer | yes | no | no | no | no |
| Compounding intelligence | yes | no | no | no | no |
| Procedural learning | yes | no | no | no | no |
| Retrieval accuracy | implicit | yes | yes | yes | yes |
| Multi-session reasoning | yes | yes | yes | no | yes |

## File Structure

```
benchmarks/cogbench/
  types.ts              # Shared type definitions
  scoring.ts            # Scoring engine and report formatting
  client.ts             # Extended CORTEX benchmark client
  generate.ts           # Dataset generator (no DB needed)
  run.ts                # Evaluation harness (needs CORTEX DB)
  README.md             # This file
  tasks/
    temporal-validity.ts
    reconsolidation.ts
    novelty-detection.ts
    emotional-recall.ts
    cross-agent-transfer.ts
    compounding-intelligence.ts
    procedural-learning.ts
  dataset/
    cogbench-v1.json    # Generated dataset (after running generate.ts)
```

## Citation

```bibtex
@inproceedings{juarez2026cogbench,
  title     = {CogBench: Benchmarking Cognitive Capabilities in AI Memory Architectures},
  author    = {Juarez, Atanasio},
  booktitle = {ICLR 2026 Workshop on Memory in Agentic AI Systems (MemAgents)},
  year      = {2026},
  url       = {https://github.com/aterna-ai/cortex}
}
```

## License

Apache 2.0 — same as CORTEX.
