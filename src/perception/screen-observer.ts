/**
 * CORTEX V2 — Perceptual Integration: Screen Observer
 *
 * Captures screenshots via Peekaboo, extracts context,
 * and stores observations in CORTEX memory.
 */
import { db, schema } from "../db/index.js";
import { eq, sql } from "drizzle-orm";
import { execSync } from "child_process";
import { extractEntitiesSync as extractEntities, extractSemanticTags } from "../ingestion/entities.js";
import { formSynapses } from "../ingestion/synapse-formation.js";
import { embedTexts } from "../ingestion/embeddings.js";

interface ScreenObservation {
  activeApp: string;
  windowTitle: string;
  description: string;
  entities: string[];
  timestamp: string;
}

function runCommand(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim();
  } catch {
    return "";
  }
}

export async function captureAndAnalyze(): Promise<ScreenObservation> {
  // Get active window info via Peekaboo
  const windowList = runCommand("peekaboo list 2>/dev/null");
  const imageData = runCommand("peekaboo image --json 2>/dev/null");

  // Parse window info
  let activeApp = "Unknown";
  let windowTitle = "Unknown";

  if (windowList) {
    const lines = windowList.split("\n").filter(l => l.trim());
    // First line is usually the frontmost app
    if (lines.length > 0) {
      const parts = lines[0].split(" - ");
      if (parts.length >= 2) {
        activeApp = parts[0].trim();
        windowTitle = parts.slice(1).join(" - ").trim();
      } else {
        activeApp = lines[0].trim();
      }
    }
  }

  // If Peekaboo not available, fall back to AppleScript
  if (activeApp === "Unknown") {
    activeApp = runCommand(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null`) || "Unknown";
    windowTitle = runCommand(`osascript -e 'tell application "System Events" to get name of first window of first application process whose frontmost is true' 2>/dev/null`) || "Unknown";
  }

  // Build description
  const description = `Screen observation: ${activeApp} is active with window "${windowTitle}".`;

  // Extract entities from the description and window context
  const contextText = `${activeApp} ${windowTitle} ${description}`;
  const entities = extractEntities(contextText);

  return {
    activeApp,
    windowTitle,
    description,
    entities,
    timestamp: new Date().toISOString(),
  };
}

export async function ingestObservation(agentId: number, observation: ScreenObservation): Promise<number[]> {
  const content = `[Screen Observation ${observation.timestamp}] App: ${observation.activeApp}, Window: "${observation.windowTitle}". ${observation.description}`;

  const entities = observation.entities;
  const tags = ["observation", ...extractSemanticTags(content)];
  const embeddings = await embedTexts([content]);

  const [inserted] = await db
    .insert(schema.memoryNodes)
    .values({
      agentId,
      content,
      source: "screen-observer",
      sourceType: "observation",
      chunkIndex: 0,
      embedding: embeddings[0],
      entities,
      semanticTags: tags,
      priority: 3, // Low priority, ephemeral
      resonanceScore: 3.0,
      status: "active",
    })
    .returning({ id: schema.memoryNodes.id });

  // Form synapses with existing memories
  await formSynapses(agentId, [inserted.id]);

  return [inserted.id];
}

export function formatObservation(observation: ScreenObservation): string {
  let output = `# Screen Observation\n`;
  output += `- Time: ${observation.timestamp}\n`;
  output += `- Active App: ${observation.activeApp}\n`;
  output += `- Window: ${observation.windowTitle}\n`;
  output += `- Description: ${observation.description}\n`;
  if (observation.entities.length > 0) {
    output += `- Entities: ${observation.entities.join(", ")}\n`;
  }
  return output;
}
