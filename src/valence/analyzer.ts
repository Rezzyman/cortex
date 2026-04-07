/**
 * Emotional Valence Analyzer
 *
 * Analyzes memory content to produce a multi-dimensional emotional vector.
 * Uses lexicon-based heuristics (fast, no API calls) with weighted signal
 * detection across all 6 emotional dimensions.
 *
 * This is Phase 1 — lexicon heuristics. Phase 2 would add LLM-based
 * analysis for nuanced understanding, but this handles 80% of cases
 * and adds zero latency to the ingestion pipeline.
 */

import type { EmotionalVector, EmotionalSalience, ValenceResult } from "./types.js";
import { NEUTRAL_VECTOR } from "./types.js";

// ─── Lexicons ───────────────────────────────────────────

const POSITIVE_SIGNALS = [
  "success", "won", "achieved", "excellent", "great", "improved", "growth",
  "opportunity", "excited", "breakthrough", "milestone", "profit", "revenue",
  "closed", "signed", "approved", "launched", "shipped", "delivered",
  "partnership", "celebrate", "congratulations", "thrilled", "impressive",
  "exceeded", "record", "best", "love", "thank", "grateful", "amazing",
  "perfect", "solved", "resolved", "completed", "accomplished",
];

const NEGATIVE_SIGNALS = [
  "failed", "lost", "risk", "problem", "issue", "concern", "warning",
  "decline", "dropped", "missed", "delayed", "blocked", "error", "bug",
  "complaint", "churn", "cancel", "frustrated", "angry", "disappointed",
  "worried", "threat", "crisis", "emergency", "urgent", "critical",
  "broken", "damage", "lawsuit", "violation", "incident", "outage",
  "regret", "mistake", "wrong", "terrible", "awful",
];

const HIGH_AROUSAL = [
  "urgent", "immediately", "asap", "emergency", "critical", "breaking",
  "now", "deadline", "overdue", "escalat", "fire", "crisis", "alert",
  "spike", "surge", "explod", "crash", "breakthrough", "massive",
  "incredible", "unbelievable", "shocked", "stunned",
];

const LOW_AROUSAL = [
  "routine", "standard", "normal", "scheduled", "regular", "typical",
  "background", "maintenance", "ongoing", "gradual", "steady", "stable",
  "calm", "quiet", "minor", "slight",
];

const DOMINANCE_HIGH = [
  "decided", "chose", "implemented", "built", "created", "launched",
  "led", "directed", "approved", "authorized", "committed", "owned",
  "controlled", "managed", "resolved", "fixed", "solved", "command",
  "strategy", "plan", "roadmap", "initiative",
];

const DOMINANCE_LOW = [
  "blocked", "waiting", "depends", "unclear", "unknown", "confused",
  "stuck", "helpless", "overwhelmed", "uncertain", "pending", "requested",
  "need approval", "can't", "unable", "prevented", "restricted",
];

const CERTAINTY_HIGH = [
  "confirmed", "verified", "proven", "data shows", "measured", "tested",
  "validated", "evidence", "fact", "certain", "definitely", "always",
  "guaranteed", "documented", "recorded", "established",
];

const CERTAINTY_LOW = [
  "maybe", "perhaps", "might", "could", "possibly", "uncertain",
  "unclear", "hypothesis", "speculate", "guess", "assume", "estimate",
  "approximately", "roughly", "seems", "appears", "likely", "unlikely",
  "question", "investigate",
];

const URGENCY_SIGNALS = [
  "today", "tonight", "this morning", "this afternoon", "asap", "immediately",
  "right now", "deadline", "overdue", "due", "expir", "before end of",
  "by eod", "by eow", "time-sensitive", "blocker", "blocking",
];

const RELEVANCE_CORE = [
  "cortex", "memory", "agent", "strategy", "revenue",
  "client", "customer", "product", "roadmap", "architecture", "mission",
  "vision", "goal", "okr", "kpi", "priority", "decision", "commitment",
  "promise", "contract", "agreement",
];

/**
 * Count signal matches in text (case-insensitive).
 */
function countSignals(text: string, signals: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const signal of signals) {
    if (lower.includes(signal)) count++;
  }
  return count;
}

/**
 * Analyze the emotional content of text and produce a 6-dimensional vector.
 *
 * Performance: <1ms (pure string matching, no API calls).
 */
export function analyzeValence(content: string): ValenceResult {
  const text = content.toLowerCase();
  const wordCount = text.split(/\s+/).length;

  // Density-normalized signal detection (signals per 100 words)
  const normFactor = Math.max(wordCount / 100, 1);

  // ── Valence ──
  const posCount = countSignals(text, POSITIVE_SIGNALS);
  const negCount = countSignals(text, NEGATIVE_SIGNALS);
  const valenceRaw = (posCount - negCount) / normFactor;
  const valence = Math.max(-1, Math.min(1, valenceRaw * 0.3));

  // ── Arousal ──
  const highArousal = countSignals(text, HIGH_AROUSAL);
  const lowArousal = countSignals(text, LOW_AROUSAL);
  const arousalRaw = (highArousal - lowArousal) / normFactor;
  const arousal = Math.max(-1, Math.min(1, arousalRaw * 0.4));

  // ── Dominance ──
  const domHigh = countSignals(text, DOMINANCE_HIGH);
  const domLow = countSignals(text, DOMINANCE_LOW);
  const dominanceRaw = (domHigh - domLow) / normFactor;
  const dominance = Math.max(-1, Math.min(1, dominanceRaw * 0.3));

  // ── Certainty ──
  const certHigh = countSignals(text, CERTAINTY_HIGH);
  const certLow = countSignals(text, CERTAINTY_LOW);
  const certaintyRaw = (certHigh - certLow) / normFactor;
  const certainty = Math.max(-1, Math.min(1, certaintyRaw * 0.4));

  // ── Relevance ──
  const relCount = countSignals(text, RELEVANCE_CORE);
  const relevance = Math.min(1, 0.2 + relCount * 0.15);

  // ── Urgency ──
  const urgCount = countSignals(text, URGENCY_SIGNALS);
  const urgency = Math.min(1, urgCount * 0.25);

  const vector: EmotionalVector = {
    valence,
    arousal,
    dominance,
    certainty,
    relevance,
    urgency,
  };

  const salience = computeSalience(vector);

  return { vector, salience };
}

/**
 * Compute emotional salience metrics from the vector.
 *
 * Intensity = magnitude of the vector (how emotionally charged)
 * Decay resistance = how much the emotion protects from pruning
 * Recall boost = how much the emotion enhances retrieval
 */
export function computeSalience(vector: EmotionalVector): EmotionalSalience {
  // Intensity: L2 norm of the vector (higher = more emotionally charged)
  const dims = [
    vector.valence,
    vector.arousal,
    vector.dominance,
    vector.certainty,
    vector.relevance,
    vector.urgency,
  ];
  const intensity = Math.sqrt(dims.reduce((sum, d) => sum + d * d, 0)) / Math.sqrt(6);

  // Decay resistance: emotionally salient memories resist pruning
  // High absolute valence (positive OR negative) + high relevance = resistant
  const absValence = Math.abs(vector.valence);
  const decayResistance = Math.min(
    1,
    0.2 * absValence + 0.15 * Math.abs(vector.arousal) + 0.3 * vector.relevance + 0.2 * vector.urgency + 0.15 * intensity
  );

  // Recall boost: emotionally charged + relevant memories surface faster
  const recallBoost = Math.min(
    1,
    0.25 * absValence + 0.2 * Math.abs(vector.arousal) + 0.3 * vector.relevance + 0.15 * vector.urgency + 0.1 * Math.abs(vector.dominance)
  );

  // Dominant dimension
  const dimMap: Record<string, number> = {
    valence: Math.abs(vector.valence),
    arousal: Math.abs(vector.arousal),
    dominance: Math.abs(vector.dominance),
    certainty: Math.abs(vector.certainty),
    relevance: vector.relevance,
    urgency: vector.urgency,
  };
  const dominantDimension = Object.entries(dimMap).sort(
    (a, b) => b[1] - a[1]
  )[0][0] as keyof EmotionalVector;

  return { intensity, decayResistance, recallBoost, dominantDimension };
}
