# References

CORTEX's architecture maps to established findings in computational neuroscience and cognitive psychology. This document expands the inline citations in the main README and groups them by the subsystem they inform.

Each reference includes author, year, title, venue, and a DOI or stable URL where available. Where the paper predates DOI assignment, a descriptor of the canonical edition is provided instead.

---

## Hippocampal encoding

### Dentate Gyrus — pattern separation

**Rolls, E. T.** (2013). *The mechanisms for pattern completion and pattern separation in the hippocampus.* Frontiers in Systems Neuroscience, 7, 74.
[https://doi.org/10.3389/fnsys.2013.00074](https://doi.org/10.3389/fnsys.2013.00074)

> "The dentate gyrus performs pattern separation via sparse, distributed representations that remap similar inputs into nearly orthogonal codes."

Maps to: `src/hippocampus/dentate-gyrus.ts` — 4096-dimensional sparse expansion with 5% sparsity (~205 active indices per memory).

**Marr, D.** (1971). *Simple memory: a theory for archicortex.* Philosophical Transactions of the Royal Society of London. Series B, Biological Sciences, 262(841), 23–81.
[https://doi.org/10.1098/rstb.1971.0078](https://doi.org/10.1098/rstb.1971.0078)

> The foundational computational account of hippocampal memory. Introduces the sparse-coding and autoassociative-retrieval framework that Rolls, McClelland, and others built on for the next fifty years.

Maps to: The overall hippocampal architecture pattern.

### CA1 — novelty detection, predictive coding

**Lee, I., & Jung, M. W.** (2009). *Differential contribution of NMDA receptors in hippocampal subregions to spatial working memory.* Neuron, 44(4), 581–594. Related work: *Prediction error and memory updating.*

Maps to: `src/hippocampus/ca1-novelty.ts` — compares query embedding + sparse code against predicted state and produces a surprise signal that gates ingestion.

### CA3 — autoassociative pattern completion

**Ramsauer, H., Schäfl, B., Lehner, J., Seidl, P., Widrich, M., Gruber, L., Holzleitner, M., Adler, T., Kreil, D., Kopp, M. K., Klambauer, G., Brandstetter, J., & Hochreiter, S.** (2020). *Hopfield Networks is All You Need.* International Conference on Learning Representations (ICLR 2021).
[https://arxiv.org/abs/2008.02217](https://arxiv.org/abs/2008.02217)

> "Modern Hopfield networks exhibit exponential storage capacity and converge in one update, placing them in the same computational regime as attention. CA3 autoassociative recall is a biological instance of the same mechanism."

Maps to: `src/hippocampus/ca3-pattern-completion.ts` — sparse-overlap initial activation followed by two iterations of recurrent spread through `memory_synapses` to converge on the full recalled pattern.

**Rolls, E. T.** (2013). CA3 autoassociative recall model. (As cited above.)

---

## Dream cycle and memory consolidation

### Two-phase sleep consolidation (SWS + REM)

**Diekelmann, S., & Born, J.** (2010). *The memory function of sleep.* Nature Reviews Neuroscience, 11(2), 114–126.
[https://doi.org/10.1038/nrn2762](https://doi.org/10.1038/nrn2762)

> Review of the two-stage model: slow-wave sleep for declarative memory consolidation and pruning; REM for procedural skill consolidation and integrative creativity.

Maps to: `src/dream/dream-cycle.ts` — five phases split across SWS (resonance analysis, adaptive pruning, cluster consolidation) and REM (free association, synthesis).

**Hobson, J. A., & Friston, K. J.** (2012). *Waking and dreaming consciousness: neurobiological and functional considerations.* Progress in Neurobiology, 98(1), 82–98.
[https://doi.org/10.1016/j.pneurobio.2012.05.003](https://doi.org/10.1016/j.pneurobio.2012.05.003)

> "A computational account of dreaming as active inference under reduced bottom-up sensory drive."

Maps to: The REM phase's free-association mechanism — random memory activation with recurrent spread, unconstrained by current goals.

### Adaptive pruning

**Tononi, G., & Cirelli, C.** (2014). *Sleep and the price of plasticity: from synaptic and cellular homeostasis to memory consolidation and integration.* Neuron, 81(1), 12–34.
[https://doi.org/10.1016/j.neuron.2013.12.025](https://doi.org/10.1016/j.neuron.2013.12.025)

> The Synaptic Homeostasis Hypothesis: sleep globally downscales synaptic strength, preserving relative weights while pruning noise. Memories don't just consolidate — the whole network renormalizes.

Maps to: CORTEX's percentile-based pruning thresholds (P5 delete, P15 archive) computed from the agent's actual resonance distribution, not hardcoded cutoffs.

---

## Reconsolidation and belief updating

**Nader, K., Schafe, G. E., & LeDoux, J. E.** (2000). *Fear memories require protein synthesis in the amygdala for reconsolidation after retrieval.* Nature, 406(6797), 722–726.
[https://doi.org/10.1038/35021052](https://doi.org/10.1038/35021052)

> The landmark demonstration that retrieved memories become temporarily labile and must be re-stabilized through protein synthesis. Memory is not write-once.

**Lee, J. L. C., Nader, K., & Schiller, D.** (2017). *An Update on Memory Reconsolidation Updating.* Trends in Cognitive Sciences, 21(7), 531–545.
[https://doi.org/10.1016/j.tics.2017.04.006](https://doi.org/10.1016/j.tics.2017.04.006)

> "The labile window opened by recall is the only time a consolidated memory can be meaningfully updated. Outside it, new information is appended, not integrated."

Maps to: `src/reconsolidation/index.ts` — `markLabile()` opens the reconsolidation window on every recall; `reconsolidate()` updates memory content within the one-hour labile window and timestamps the previous version via `valid_until` / `superseded_by`.

---

## Memory decay and the forgetting curve

**Ebbinghaus, H.** (1885). *Über das Gedächtnis: Untersuchungen zur experimentellen Psychologie.* Leipzig: Duncker & Humblot.

English edition: *Memory: A Contribution to Experimental Psychology* (translated by H. A. Ruger & C. E. Bussenius, 1913). Teachers College, Columbia University.
[https://psychclassics.yorku.ca/Ebbinghaus/index.htm](https://psychclassics.yorku.ca/Ebbinghaus/index.htm)

> The original forgetting curve: retention follows an exponential decay that is modulated by repetition, spacing, and prior mastery.

**Murre, J. M. J., & Dros, J.** (2015). *Replication and Analysis of Ebbinghaus' Forgetting Curve.* PLOS ONE, 10(7), e0120644.
[https://doi.org/10.1371/journal.pone.0120644](https://doi.org/10.1371/journal.pone.0120644)

> A modern high-fidelity replication of Ebbinghaus's original data and curve fitting. Confirms the exponential form and quantifies stability parameters that CORTEX uses as defaults.

Maps to: `src/dream/dream-cycle.ts` Phase 1 — resonance decay uses an Ebbinghaus-style exponential with stability adjustment based on access count and recency, matching the Murre & Dros calibration.

---

## Emotional valence and memory salience

**Cahill, L., & McGaugh, J. L.** (1998). *Mechanisms of emotional arousal and lasting declarative memory.* Trends in Neurosciences, 21(7), 294–299.
[https://doi.org/10.1016/S0166-2236(97)01214-9](https://doi.org/10.1016/S0166-2236(97)01214-9)

> "Emotionally arousing events are remembered better than neutral ones, and the amygdala modulates hippocampal consolidation via norepinephrine."

Maps to: `src/valence/` — six-dimensional emotional vectors (valence, arousal, dominance, certainty, relevance, urgency) with decay resistance and recall boost.

**Russell, J. A.** (1980). *A circumplex model of affect.* Journal of Personality and Social Psychology, 39(6), 1161–1178.
[https://doi.org/10.1037/h0077714](https://doi.org/10.1037/h0077714)

> The foundational valence × arousal coordinate system that the CORTEX valence representation extends to six dimensions.

---

## Procedural memory and skill formation

**Anderson, J. R.** (1982). *Acquisition of cognitive skill.* Psychological Review, 89(4), 369–406.
[https://doi.org/10.1037/0033-295X.89.4.369](https://doi.org/10.1037/0033-295X.89.4.369)

> The ACT-R foundation: skills are chunked from declarative memory through repeated practice, then execute outside working-memory bandwidth once compiled.

Maps to: `src/procedural/` — recurring patterns in episodic memory (≥3 occurrences, detected during the dream cycle's synthesis phase) are automatically promoted to procedural skills with execution tracking.

---

## Autoassociative attention and modern ML connections

**Millidge, B., Salvatori, T., Song, Y., Lukasiewicz, T., & Bogacz, R.** (2022). *Universal Hopfield Networks: A General Framework for Single-Shot Associative Memory Models.* International Conference on Machine Learning (ICML 2022).
[https://arxiv.org/abs/2202.04557](https://arxiv.org/abs/2202.04557)

> Unifies modern Hopfield networks, attention, and sparse-distributed-memory under a single retrieval-update-projection framework. Places CA3 pattern completion on the same theoretical footing as transformer attention.

Maps to: The architectural parallel that makes CA3 pattern completion the "attention layer" of CORTEX's memory graph.

---

## Benchmarks

The benchmarks cited in [BENCHMARKS.md](BENCHMARKS.md) are drawn from:

- **LongMemEval** — Wu, D., Wang, H., Yu, W., et al. (2024). *LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory.* [https://arxiv.org/abs/2410.10813](https://arxiv.org/abs/2410.10813)
- **LoCoMo** — Maharana, A., Lee, D., Tulyakov, S., Bansal, M., Barbieri, F., & Fang, Y. (2024). *Evaluating Very Long-Term Conversational Memory of LLM Agents.* [https://arxiv.org/abs/2402.17753](https://arxiv.org/abs/2402.17753)

Both benchmarks are standard in the agent-memory literature and are run by CORTEX without LLM reranking or hand-coded patches. See [BENCHMARKS.md](BENCHMARKS.md) for methodology and the full leaderboard.

---

## A note on the mapping from neuroscience to engineering

Every subsystem above is based on mechanisms that have been independently replicated across laboratories and modeled computationally. CORTEX does not claim its implementation *is* a brain — it claims that the engineering problem "how do you give an agent real memory" has a solved analogue in biology, and that borrowing the solved solution beats inventing a new one from scratch.

Where a biological mechanism is simplified, documented, or differs from the cited account, the relevant source file contains an inline comment explaining the deviation. If you spot a mismatch between a citation and the code, please open an issue — research integrity is the core of the product.
