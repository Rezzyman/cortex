# CORTEX

**Synthetic cognition infrastructure for AI agents.**

Memory that thinks. Not a vector database. Not a RAG pipeline. A cognitive architecture with learning, consolidation, decay, emotion, and reconsolidation, grounded in computational neuroscience.

---

## What Makes CORTEX Different

Most agent memory systems store and retrieve. CORTEX **learns**.

| Feature | Vector DBs | RAG Pipelines | CORTEX |
|---------|-----------|---------------|--------|
| Store memories | Yes | Yes | Yes |
| Semantic search | Yes | Yes | Yes |
| Temporal validity (when was this true?) | No | No | **Yes** |
| Novelty detection (is this actually new?) | No | No | **Yes** |
| Memory consolidation (dream cycles) | No | No | **Yes** |
| Emotional weighting (what matters?) | No | No | **Yes** |
| Belief reconsolidation (update, don't append) | No | No | **Yes** |
| Adaptive forgetting (prune what doesn't matter) | No | No | **Yes** |
| Pattern separation (don't confuse similar memories) | No | No | **Yes** |
| Procedural learning (skills improve with practice) | No | No | **Yes** |

## Architecture

CORTEX implements a biologically-grounded cognitive architecture:

```
                    Ingestion Pipeline
                         |
        chunk -> embed -> entities -> valence
                         |
                 Hippocampal Encoding
                    |          |
              DG (separate)  CA1 (novelty)
                    |          |
              Sparse codes   Surprise gating
                         |
                   Memory Storage
                   (PostgreSQL + pgvector)
                         |
            ┌────────────┼────────────┐
            |            |            |
         Search       Recall      Reconsolidate
      (hybrid 7-factor) (token-budget)  (labile window)
            |            |            |
            └────────────┼────────────┘
                         |
                   Dream Cycle (nightly)
                    |    |    |    |    |
                 Resonance Prune Consolidate Associate Synthesize
                  (SWS)   (SWS)   (SWS)      (REM)     (REM)
```

### Core Subsystems

**Hippocampus** — Pattern separation via Dentate Gyrus sparse coding (4096-dim expansion, 5% sparsity), CA1 novelty detection with sparse gating, CA3 autoassociative pattern completion.

**Dream Cycle** — Five-phase synthetic sleep: resonance decay (Ebbinghaus stability-adjusted), adaptive pruning (percentile-based), cluster consolidation (LLM abstractive summaries), free association (random activation), and synthesis (novel insight generation).

**Emotional Valence** — Six-dimensional emotional vectors (valence, arousal, dominance, certainty, relevance, urgency) that modulate memory decay resistance and recall priority.

**Reconsolidation** — Retrieved memories enter a labile window where they can be updated with new information. Old versions get temporal validity markers. Beliefs evolve, not just accumulate.

**Temporal Validity** — Every memory tracks `valid_from`, `valid_until`, and `superseded_by`. CORTEX knows when facts were true, not just when they were stored.

**Procedural Memory** — Skills, workflows, and habits stored separately from episodic memory. Proficiency tracked through execution count and success rate.

**Autonomous Cognition** — Background reasoning threads (strategic, operational, relational) that run independently and surface insights.

**Proprioception** — Self-diagnostic system that monitors cognitive integrity: orphaned memories, synaptic collapse, embedding consistency, learning rate stalls.

**Metacognition** — Reasoning traces, weekly audits with bias detection, and a feedback loop that stores corrective artifacts when inconsistencies are found.

## Quick Start

### Prerequisites

- Node.js 22+
- PostgreSQL 15+ with [pgvector](https://github.com/pgvector/pgvector) extension
- An embedding API key (VoyageAI recommended, OpenAI supported)

### Install

```bash
git clone https://github.com/aterna-ai/cortex.git
cd cortex
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and API keys
```

### Initialize Database

```bash
npx tsx scripts/run-migrations.ts
```

### Run the MCP Server

CORTEX exposes its tools via the [Model Context Protocol](https://modelcontextprotocol.io/), making it available to any MCP-compatible agent (Claude Code, OpenClaw, etc.):

```bash
npx tsx src/mcp/server.ts
```

### MCP Configuration

Add to your agent's `.mcp.json`:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["tsx", "/path/to/cortex/src/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "your-connection-string",
        "VOYAGE_API_KEY": "your-key"
      }
    }
  }
}
```

### Run the REST API

```bash
npx tsx src/index.ts
# Server starts on port 3100
```

## MCP Tools

CORTEX exposes 20+ tools via MCP:

### Core Memory
| Tool | Description |
|------|-------------|
| `cortex_init` | Session boot: load top memories + system stats |
| `cortex_search` | Hybrid 7-factor search (semantic + text + recency + resonance + priority + emotion + CA3) |
| `cortex_recall` | Token-budget-aware context retrieval |
| `cortex_ingest` | Store new memory with hippocampal encoding |
| `cortex_status` | System health and statistics |
| `cortex_dream` | Run dream cycle (full, SWS-only, REM-only) |

### Reconsolidation
| Tool | Description |
|------|-------------|
| `cortex_reconsolidate` | Update a memory within its labile window |
| `cortex_labile` | List currently modifiable memories |

### Procedural
| Tool | Description |
|------|-------------|
| `cortex_procedural_store` | Store a skill, workflow, or habit |
| `cortex_procedural_retrieve` | Find relevant procedures for a context |

### Proprioception (Phase 1)
| Tool | Description |
|------|-------------|
| `cortex_self_check` | Run cognitive integrity diagnostics |
| `cortex_journal` | Log agent state (energy, confidence, concerns) |

### Empathic Modeling (Phase 2)
| Tool | Description |
|------|-------------|
| `cortex_assess_state` | Infer principal's energy/stress/focus from messages |

### Autonomous Cognition (Phase 3)
| Tool | Description |
|------|-------------|
| `cortex_bg_thread` | Run strategic/operational/relational reasoning |
| `cortex_synthesize` | Generate insights from novel synaptic connections |

### Perception (Phase 4)
| Tool | Description |
|------|-------------|
| `cortex_observe` | Capture and analyze screen state (macOS) |

### Social Intelligence (Phase 5)
| Tool | Description |
|------|-------------|
| `cortex_relationship` | Lookup contact profile |
| `cortex_relationships` | List/filter contacts |
| `cortex_relationship_update` | Update contact status |

### Metacognition (Phase 6)
| Tool | Description |
|------|-------------|
| `cortex_reason` | Store structured decision trace |
| `cortex_audit` | Weekly reasoning consistency check |
| `cortex_monologue` | Record inner thoughts |

## Database Schema

16 tables across 6 cognitive layers:

- `agents` — Multi-agent isolation
- `memory_nodes` — Episodic memory with embeddings, temporal validity, resonance
- `memory_synapses` — Associative connections (semantic, temporal, causal, entity-shared)
- `hippocampal_codes` — DG sparse representations for pattern separation
- `emotional_valence` — 6-dimensional emotional context per memory
- `procedural_memories` — Skills/workflows with proficiency tracking
- `cognitive_artifacts` — Decisions, learnings, corrections, insights
- `dream_cycle_logs` — Maintenance audit trail
- `self_diagnostics` — Cognitive integrity snapshots
- `agent_state_logs` — Agent energy/confidence tracking
- `principal_state` — Empathic modeling of the human
- `background_threads` — Autonomous reasoning status
- `relationship_graph` — Social intelligence contacts

## Search Scoring

CORTEX uses a 7-factor hybrid scoring system:

```
score = 0.50 * cosine_similarity    (semantic relevance)
      + 0.20 * text_match           (exact keyword match)
      + 0.15 * recency              (exponential decay, 30-day half-life)
      + 0.10 * resonance            (Ebbinghaus stability-adjusted)
      + 0.05 * priority_boost       (P0=1.0, P4=0.1)
```

With optional CA3 pattern completion boost and emotional recall boost via `--verbose` mode.

## Dream Cycle

The dream cycle runs nightly (or on demand) with five phases:

**SWS (Slow-Wave Sleep):**
1. **Resonance Analysis** — Ebbinghaus stability-adjusted decay across all active memories
2. **Pruning** — Adaptive percentile-based thresholds (P5 delete, P15 archive). P0/P1 and emotionally salient memories are protected.
3. **Consolidation** — Connected component clustering of high-resonance memories, LLM-generated abstractive summaries

**REM (Rapid Eye Movement):**
4. **Free Association** — Random activation for novel cross-domain connections
5. **Synthesis** — Generate insights from newly formed synapses

## Neuroscience References

CORTEX draws from established computational neuroscience:

- **Dentate Gyrus pattern separation**: Rolls (2013) "The mechanisms for pattern completion and pattern separation in the hippocampus"
- **CA1 predictive coding**: Lee et al. (2009) "Prediction error and memory reconsolidation"
- **Memory reconsolidation**: Nader et al. (2000) "Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval"
- **Ebbinghaus forgetting curve**: Ebbinghaus (1885), extended with stability-adjusted decay from Huawei's Memory-Augmented Transformers (2025)
- **Two-phase sleep consolidation**: Diekelmann & Born (2010) "The memory function of sleep"

## Testing

```bash
npm test
```

36 tests covering:
- Dentate Gyrus encoding (sparsity, determinism, normalization, pattern separation)
- Entity extraction (known entities, aliases, semantic tags)
- Text chunking (splitting, indexing, content preservation)

## Contributing

We welcome contributions. Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache 2.0. See [LICENSE](LICENSE).

---

Built by [Atanasio Juarez](https://github.com/Rezzyman) at [ATERNA.AI](https://aterna.ai).
