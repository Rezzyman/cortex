/**
 * CORTEX V2 — Meta-Cognition: Weekly Audit
 *
 * Analyzes reasoning traces from the past week for:
 * - Consistency
 * - Confidence calibration
 * - Pattern detection
 * - SOUL.md / PRIME-CONTEXT.md alignment
 */
import { db, schema } from "../db/index.js";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";

interface AuditResult {
  period: string;
  tracesAnalyzed: number;
  avgConfidence: number;
  confidenceDistribution: Record<string, number>;
  patterns: string[];
  biasIndicators: string[];
  alignmentNotes: string[];
  recommendations: string[];
}

export async function runWeeklyAudit(agentId: number, period?: string): Promise<AuditResult> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const periodLabel = period || `${weekAgo.toISOString().split("T")[0]} to ${now.toISOString().split("T")[0]}`;

  // Get reasoning traces from the past week
  const traces = await db
    .select()
    .from(schema.cognitiveArtifacts)
    .where(and(
      eq(schema.cognitiveArtifacts.agentId, agentId),
      eq(schema.cognitiveArtifacts.artifactType, "reasoning_trace"),
      gte(schema.cognitiveArtifacts.createdAt, weekAgo)
    ))
    .orderBy(desc(schema.cognitiveArtifacts.createdAt));

  const patterns: string[] = [];
  const biasIndicators: string[] = [];
  const alignmentNotes: string[] = [];
  const recommendations: string[] = [];

  // Confidence analysis
  const confidences = traces.map(t => {
    const content = t.content as { confidence?: number };
    return content.confidence ?? 0.5;
  });

  const avgConfidence = confidences.length > 0
    ? confidences.reduce((s, c) => s + c, 0) / confidences.length
    : 0;

  const confidenceDistribution: Record<string, number> = {
    "high (>0.8)": confidences.filter(c => c > 0.8).length,
    "medium (0.5-0.8)": confidences.filter(c => c >= 0.5 && c <= 0.8).length,
    "low (<0.5)": confidences.filter(c => c < 0.5).length,
  };

  // Pattern detection
  if (avgConfidence > 0.85) {
    biasIndicators.push("Overconfidence bias: average confidence is unusually high. Consider whether uncertainty is being properly acknowledged.");
  }
  if (avgConfidence < 0.35) {
    patterns.push("Low confidence trend: may indicate operating in unfamiliar territory or insufficient context.");
  }
  if (confidences.filter(c => c > 0.8).length === confidences.length && confidences.length > 3) {
    biasIndicators.push("Uniform high confidence across all decisions. Real-world decisions should show variance.");
  }

  // Check for decision reversals or contradictions
  const decisions = traces.map(t => {
    const content = t.content as { decision?: string; chosen?: string };
    return { decision: content.decision || "", chosen: content.chosen || "" };
  });

  // Simple contradiction check: same decision topic, different choice
  const decisionTopics = new Map<string, string[]>();
  for (const d of decisions) {
    const key = d.decision.toLowerCase().slice(0, 50);
    if (!decisionTopics.has(key)) decisionTopics.set(key, []);
    decisionTopics.get(key)!.push(d.chosen);
  }
  for (const [topic, choices] of decisionTopics) {
    const unique = new Set(choices);
    if (unique.size > 1) {
      patterns.push(`Potential inconsistency on "${topic}": chose ${[...unique].join(" vs ")}`);
    }
  }

  // Alignment check: read SOUL.md and PRIME-CONTEXT.md for reference
  const workspaceDir = process.env.CORTEX_WORKSPACE || process.cwd();
  try {
    const soul = await readFile(join(workspaceDir, "SOUL.md"), "utf-8");
    const prime = await readFile(join(workspaceDir, "PRIME-CONTEXT.md"), "utf-8");

    // Check if any reasoning traces mention or align with core values
    const coreValues = ["protect", "truth", "genuine", "loyalty", "harm"];
    for (const trace of traces) {
      const content = JSON.stringify(trace.content).toLowerCase();
      const mentionedValues = coreValues.filter(v => content.includes(v));
      if (mentionedValues.length > 0) {
        alignmentNotes.push(`Trace #${trace.id} references core values: ${mentionedValues.join(", ")}`);
      }
    }

    // Check for em-dash usage in traces (STANDING-ORDERS violation)
    for (const trace of traces) {
      const content = JSON.stringify(trace.content);
      if (content.includes("\u2014")) {
        biasIndicators.push(`Trace #${trace.id} contains em-dash (writing style violation)`);
      }
    }
  } catch {
    alignmentNotes.push("Could not read SOUL.md or PRIME-CONTEXT.md for alignment check");
  }

  // Recommendations
  if (traces.length === 0) {
    recommendations.push("No reasoning traces recorded this week. Consider logging significant decisions.");
  }
  if (traces.length < 3) {
    recommendations.push("Very few reasoning traces. Increase usage for better self-awareness.");
  }
  if (biasIndicators.length > 2) {
    recommendations.push("Multiple bias indicators detected. Review recent decisions with fresh eyes.");
  }

  const result: AuditResult = {
    period: periodLabel,
    tracesAnalyzed: traces.length,
    avgConfidence,
    confidenceDistribution,
    patterns,
    biasIndicators,
    alignmentNotes,
    recommendations,
  };

  // Store audit as cognitive artifact
  await db.insert(schema.cognitiveArtifacts).values({
    agentId,
    artifactType: "audit",
    content: result,
    resonanceScore: 6.0,
  });

  // ── Feedback Loop: Store actionable findings as high-priority memories ──
  // When the audit detects bias or inconsistency, inject corrective memories
  // so they surface in future cortex_init and influence future decisions.
  if (biasIndicators.length > 0 || patterns.length > 0) {
    const feedbackContent = [
      biasIndicators.length > 0 ? `BIAS DETECTED: ${biasIndicators.join("; ")}` : "",
      patterns.length > 0 ? `PATTERNS: ${patterns.join("; ")}` : "",
      recommendations.length > 0 ? `CORRECTIVE ACTION: ${recommendations.join("; ")}` : "",
    ].filter(Boolean).join("\n");

    await db.insert(schema.cognitiveArtifacts).values({
      agentId,
      artifactType: "correction",
      content: {
        type: "audit_feedback",
        period: periodLabel,
        feedbackContent,
        biasCount: biasIndicators.length,
        patternCount: patterns.length,
        actionRequired: recommendations.length > 0,
        timestamp: new Date().toISOString(),
      },
      // P1 priority equivalent resonance — ensures this surfaces in future cortex_init
      resonanceScore: 8.0,
    });

    console.log(
      `[audit] Feedback loop: stored ${biasIndicators.length} bias indicators and ${patterns.length} patterns as P1 corrective artifact`
    );
  }

  return result;
}

export function formatAuditResult(result: AuditResult): string {
  let output = `# Weekly Reasoning Audit\n`;
  output += `Period: ${result.period}\n`;
  output += `Traces Analyzed: ${result.tracesAnalyzed}\n`;
  output += `Avg Confidence: ${(result.avgConfidence * 100).toFixed(0)}%\n\n`;

  output += `## Confidence Distribution\n`;
  for (const [range, count] of Object.entries(result.confidenceDistribution)) {
    output += `- ${range}: ${count}\n`;
  }
  output += "\n";

  if (result.patterns.length > 0) {
    output += `## Patterns\n`;
    for (const p of result.patterns) output += `- ${p}\n`;
    output += "\n";
  }

  if (result.biasIndicators.length > 0) {
    output += `## Bias Indicators\n`;
    for (const b of result.biasIndicators) output += `- ${b}\n`;
    output += "\n";
  }

  if (result.alignmentNotes.length > 0) {
    output += `## Alignment Notes\n`;
    for (const a of result.alignmentNotes) output += `- ${a}\n`;
    output += "\n";
  }

  if (result.recommendations.length > 0) {
    output += `## Recommendations\n`;
    for (const r of result.recommendations) output += `- ${r}\n`;
    output += "\n";
  }

  return output;
}
