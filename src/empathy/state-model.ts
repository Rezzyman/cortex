/**
 * CORTEX V2 — Empathic Modeling: Principal State Assessment
 *
 * Infers the principal's energy, stress, focus, and ADHD state from
 * message patterns, time of day, and contextual signals.
 */
import { db, schema } from "../db/index.js";
import { eq, desc, gte, sql } from "drizzle-orm";

interface StateAssessment {
  energy: number;
  stress: number;
  focusState: "hyperfocus" | "flow" | "normal" | "scattered" | "executive_dysfunction";
  emotionalValence: number;
  adhdState: "hyperfocus" | "managed" | "restless" | "overwhelmed" | "shutdown";
  rawSignals: Record<string, unknown>;
  inferredFrom: string;
  confidenceScore: number;
  communicationGuidance: string;
}

function analyzeMessagePatterns(messages: string[]): {
  avgLength: number;
  frequency: number;
  terseCount: number;
  frustrationSignals: number;
  topicSwitches: number;
  enthusiasmSignals: number;
} {
  if (messages.length === 0) {
    return { avgLength: 0, frequency: 0, terseCount: 0, frustrationSignals: 0, topicSwitches: 0, enthusiasmSignals: 0 };
  }

  const avgLength = messages.reduce((s, m) => s + m.length, 0) / messages.length;
  const terseCount = messages.filter(m => m.length < 20).length;

  const frustrationPatterns = /\b(ugh|damn|wtf|broken|stuck|frustrated|annoying|hate)\b/gi;
  const enthusiasmPatterns = /\b(awesome|great|perfect|love it|nice|hell yeah|let's go|brilliant)\b/gi;

  let frustrationSignals = 0;
  let enthusiasmSignals = 0;

  for (const msg of messages) {
    frustrationSignals += (msg.match(frustrationPatterns) || []).length;
    enthusiasmSignals += (msg.match(enthusiasmPatterns) || []).length;
  }

  // Estimate topic switches by checking consecutive message similarity
  let topicSwitches = 0;
  for (let i = 1; i < messages.length; i++) {
    const prevWords = new Set(messages[i - 1].toLowerCase().split(/\s+/));
    const currWords = new Set(messages[i].toLowerCase().split(/\s+/));
    const overlap = [...currWords].filter(w => prevWords.has(w)).length;
    const minSize = Math.min(prevWords.size, currWords.size);
    if (minSize > 2 && overlap / minSize < 0.15) topicSwitches++;
  }

  return {
    avgLength,
    frequency: messages.length,
    terseCount,
    frustrationSignals,
    topicSwitches,
    enthusiasmSignals,
  };
}

function getTimeBasedBaseline(hour: number, dayOfWeek: number): {
  energyBaseline: number;
  stressBaseline: number;
  notes: string;
} {
  // Principal's known patterns (from STANDING-ORDERS)
  const isWorkoutDay = [1, 3, 5].includes(dayOfWeek); // Mon, Wed, Fri
  let energyBaseline = 0.5;
  let stressBaseline = 0.3;
  let notes = "";

  if (hour >= 5 && hour < 7) {
    energyBaseline = 0.6;
    notes = "Early morning, building energy";
  } else if (hour >= 7 && hour < 9) {
    if (isWorkoutDay) {
      energyBaseline = 0.8;
      notes = "Post-workout energy boost (M/W/F)";
    } else {
      energyBaseline = 0.6;
      notes = "Morning ramp-up (school drop-off day)";
    }
  } else if (hour >= 9 && hour < 12) {
    energyBaseline = 0.75;
    notes = "Peak morning focus window";
  } else if (hour >= 13 && hour < 15) {
    energyBaseline = 0.4;
    stressBaseline = 0.4;
    notes = "Afternoon dip (1-3 PM), watch for dehydration";
  } else if (hour >= 15 && hour < 17) {
    energyBaseline = 0.55;
    notes = "Afternoon recovery, approaching hard stop";
  } else if (hour >= 17 && hour < 18) {
    energyBaseline = 0.5;
    stressBaseline = 0.2;
    notes = "Commute / transition to family time";
  } else if (hour >= 18 && hour < 21) {
    energyBaseline = 0.4;
    stressBaseline = 0.2;
    notes = "Family time (PROTECTED)";
  } else if (hour >= 21) {
    energyBaseline = 0.3;
    notes = "Wind-down, approaching bedtime";
  }

  return { energyBaseline, stressBaseline, notes };
}

function generateGuidance(assessment: Omit<StateAssessment, "communicationGuidance" | "rawSignals" | "inferredFrom" | "confidenceScore">): string {
  const parts: string[] = [];

  if (assessment.stress > 0.7) {
    parts.push("Keep communications concise and action-oriented. Avoid adding new items.");
  } else if (assessment.stress > 0.4) {
    parts.push("Be direct but supportive. Prioritize what needs attention now.");
  }

  switch (assessment.adhdState) {
    case "hyperfocus":
      parts.push("In hyperfocus: do NOT interrupt unless urgent. Batch non-urgent items for later.");
      break;
    case "overwhelmed":
      parts.push("Overwhelmed state: offer to break tasks down. Keep messages short. Suggest one next step.");
      break;
    case "restless":
      parts.push("Restless: offer structure. List clear options. Help channel energy productively.");
      break;
    case "shutdown":
      parts.push("Executive dysfunction detected: minimize demands. Offer gentle, low-friction actions.");
      break;
    case "managed":
      parts.push("ADHD well-managed: normal communication patterns appropriate.");
      break;
  }

  switch (assessment.focusState) {
    case "flow":
      parts.push("In flow state: protect this. Only interrupt for truly urgent items.");
      break;
    case "scattered":
      parts.push("Scattered focus: help prioritize. Offer clear next action.");
      break;
    case "executive_dysfunction":
      parts.push("Executive dysfunction: reduce cognitive load. Offer binary choices, not open-ended questions.");
      break;
  }

  if (assessment.energy < 0.3) {
    parts.push("Low energy: keep interactions minimal. Suggest breaks if appropriate.");
  }

  if (assessment.emotionalValence < -0.3) {
    parts.push("Negative mood detected: be empathetic but not patronizing. Acknowledge, then help.");
  } else if (assessment.emotionalValence > 0.5) {
    parts.push("Positive mood: good time for ambitious tasks or creative work.");
  }

  return parts.length > 0 ? parts.join(" ") : "Normal operating conditions. Standard communication appropriate.";
}

export async function assessPrincipalState(
  agentId: number,
  recentMessages: string[],
  timeOfDay?: string,
  dayOfWeek?: number,
  calendarContext?: string
): Promise<StateAssessment> {
  const hour = timeOfDay ? parseInt(timeOfDay.split(":")[0]) : new Date().getHours();
  const dow = dayOfWeek ?? new Date().getDay();

  const signals = analyzeMessagePatterns(recentMessages);
  const baseline = getTimeBasedBaseline(hour, dow);

  // Energy: baseline adjusted by message patterns
  let energy = baseline.energyBaseline;
  if (signals.terseCount > signals.frequency * 0.6) energy -= 0.15; // Many terse messages = low energy
  if (signals.enthusiasmSignals > 2) energy += 0.1;
  energy = Math.max(0, Math.min(1, energy));

  // Stress: baseline adjusted by frustration signals
  let stress = baseline.stressBaseline;
  stress += signals.frustrationSignals * 0.1;
  if (signals.terseCount > 3 && signals.avgLength < 30) stress += 0.1;
  stress = Math.max(0, Math.min(1, stress));

  // ADHD State
  let adhdState: StateAssessment["adhdState"] = "managed";
  if (signals.topicSwitches > 3) adhdState = "restless";
  if (signals.topicSwitches > 5) adhdState = "overwhelmed";
  if (signals.avgLength > 200 && signals.topicSwitches === 0 && signals.frequency >= 3) adhdState = "hyperfocus";
  if (signals.frequency === 0 || (signals.terseCount === signals.frequency && stress > 0.6)) adhdState = "shutdown";

  // Focus State
  let focusState: StateAssessment["focusState"] = "normal";
  if (adhdState === "hyperfocus") focusState = "hyperfocus";
  else if (signals.avgLength > 150 && signals.topicSwitches <= 1) focusState = "flow";
  else if (signals.topicSwitches > 3) focusState = "scattered";
  else if (adhdState === "shutdown") focusState = "executive_dysfunction";

  // Emotional Valence
  let emotionalValence = 0;
  emotionalValence += signals.enthusiasmSignals * 0.15;
  emotionalValence -= signals.frustrationSignals * 0.2;
  emotionalValence = Math.max(-1, Math.min(1, emotionalValence));

  // Confidence in our assessment
  let confidenceScore = 0.4; // Base confidence
  if (recentMessages.length >= 3) confidenceScore += 0.15;
  if (recentMessages.length >= 6) confidenceScore += 0.1;
  if (timeOfDay) confidenceScore += 0.1;
  confidenceScore = Math.min(0.9, confidenceScore);

  const coreAssessment = { energy, stress, focusState, emotionalValence, adhdState };
  const communicationGuidance = generateGuidance(coreAssessment);

  const assessment: StateAssessment = {
    ...coreAssessment,
    rawSignals: { ...signals, timeBaseline: baseline },
    inferredFrom: `${recentMessages.length} messages, time: ${hour}:00, day: ${dow}${calendarContext ? ", calendar: " + calendarContext : ""}`,
    confidenceScore,
    communicationGuidance,
  };

  // Store assessment
  await db.insert(schema.principalState).values({
    agentId,
    energy: assessment.energy,
    stress: assessment.stress,
    focusState: assessment.focusState,
    emotionalValence: assessment.emotionalValence,
    adhdState: assessment.adhdState,
    rawSignals: assessment.rawSignals,
    inferredFrom: assessment.inferredFrom,
    confidenceScore: assessment.confidenceScore,
  });

  return assessment;
}

export async function getStateHistory(agentId: number, hours = 24): Promise<Array<{
  id: number;
  timestamp: Date;
  energy: number | null;
  stress: number | null;
  focusState: string | null;
  adhdState: string | null;
  confidenceScore: number | null;
}>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const entries = await db
    .select()
    .from(schema.principalState)
    .where(eq(schema.principalState.agentId, agentId))
    .orderBy(desc(schema.principalState.timestamp))
    .limit(50);

  return entries.filter(e => e.timestamp >= since).map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    energy: e.energy,
    stress: e.stress,
    focusState: e.focusState,
    adhdState: e.adhdState,
    confidenceScore: e.confidenceScore,
  }));
}

export function formatStateAssessment(assessment: StateAssessment): string {
  let output = `# Principal State Assessment\n\n`;
  output += `- Energy: ${(assessment.energy * 100).toFixed(0)}%\n`;
  output += `- Stress: ${(assessment.stress * 100).toFixed(0)}%\n`;
  output += `- Focus: ${assessment.focusState}\n`;
  output += `- ADHD State: ${assessment.adhdState}\n`;
  output += `- Emotional Valence: ${assessment.emotionalValence > 0 ? "+" : ""}${assessment.emotionalValence.toFixed(2)}\n`;
  output += `- Confidence: ${(assessment.confidenceScore * 100).toFixed(0)}%\n\n`;
  output += `## Communication Guidance\n${assessment.communicationGuidance}\n\n`;
  output += `*Inferred from: ${assessment.inferredFrom}*\n`;
  return output;
}

export function formatStateHistory(entries: Awaited<ReturnType<typeof getStateHistory>>): string {
  if (entries.length === 0) return "No state history found.\n";

  let output = `# Principal State History (${entries.length} entries)\n\n`;
  for (const e of entries) {
    const time = e.timestamp.toISOString().replace("T", " ").slice(0, 19);
    output += `- ${time}: energy=${((e.energy || 0) * 100).toFixed(0)}% stress=${((e.stress || 0) * 100).toFixed(0)}% focus=${e.focusState} adhd=${e.adhdState}\n`;
  }
  return output;
}
