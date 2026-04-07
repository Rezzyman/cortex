/**
 * Entity extraction from text.
 *
 * Two modes:
 *   - Fast (default): Known-entity matching + proper noun regex. No API calls.
 *   - LLM: Claude API call for semantic NER with co-reference resolution.
 *     Set CORTEX_LLM_ENTITIES=true to enable (costs ~0.001 per ingest).
 *
 * The fast mode always runs first. LLM mode supplements with entities
 * that regex can't catch ("the CEO" → "Jane Smith").
 */
import { llmComplete } from "../lib/llm.js";

// Add your known entities here for fast matching.
// Format: "Canonical Name": ["alias1", "alias2", ...]
const KNOWN_ENTITIES: Record<string, string[]> = {
  // Example:
  // "Acme Corp": ["Acme Corp", "Acme", "ACME"],
  // "John Smith": ["John Smith", "Smith", "John"],
};

const USE_LLM_ENTITIES = process.env.CORTEX_LLM_ENTITIES === "true";

/**
 * Fast entity extraction: known-entity matching + proper noun regex.
 */
function extractEntitiesFast(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();

  for (const [canonical, aliases] of Object.entries(KNOWN_ENTITIES)) {
    for (const alias of aliases) {
      if (lower.includes(alias.toLowerCase())) {
        found.add(canonical);
        break;
      }
    }
  }

  // Also extract capitalized multi-word phrases (proper nouns)
  const properNouns = text.match(/(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g);
  if (properNouns) {
    for (const noun of properNouns) {
      if (!found.has(noun) && noun.split(" ").length <= 3) {
        found.add(noun);
      }
    }
  }

  return Array.from(found);
}

/**
 * LLM-based entity extraction with co-reference resolution.
 * Returns canonical entity names, resolving aliases and references.
 */
async function extractEntitiesLLM(text: string, fastEntities: string[]): Promise<string[]> {
  try {
    const response = await llmComplete(
      [
        {
          role: "user",
          content: `Extract all named entities (people, companies, products, places) from this text. Resolve co-references ("the CEO" → "Jane Smith", "the parent company" → "Acme Corp"). Return ONLY a JSON array of canonical entity names, no explanation.

Known entities for disambiguation: ${Object.keys(KNOWN_ENTITIES).join(", ")}

Text:
${text.slice(0, 2000)}`,
        },
      ],
      { maxTokens: 256, temperature: 0 }
    );

    const match = response.content.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as string[];
      // Merge with fast entities, deduplicate
      const merged = new Set([...fastEntities, ...parsed.filter((e) => typeof e === "string" && e.length > 0)]);
      return Array.from(merged);
    }
  } catch (err) {
    console.error("[entities] LLM extraction failed, using fast-only:", err);
  }

  return fastEntities;
}

/**
 * Extract entities from text. Uses fast mode by default,
 * LLM mode if CORTEX_LLM_ENTITIES=true.
 */
export async function extractEntities(text: string): Promise<string[]> {
  const fast = extractEntitiesFast(text);

  if (USE_LLM_ENTITIES) {
    return extractEntitiesLLM(text, fast);
  }

  return fast;
}

/** Synchronous fast-only extraction (for backward compatibility in hot paths) */
export function extractEntitiesSync(text: string): string[] {
  return extractEntitiesFast(text);
}

/**
 * Extract simple semantic tags from text based on content patterns.
 */
export function extractSemanticTags(text: string): string[] {
  const tags = new Set<string>();
  const lower = text.toLowerCase();

  const patterns: [RegExp, string][] = [
    [/\bdecision\b|\bdecided\b|\bagreed\b/, "decision"],
    [/\btask\b|\btodo\b|\baction item\b/, "task"],
    [/\bmeeting\b|\bcall\b|\bsync\b/, "meeting"],
    [/\bprice\b|\bcost\b|\bpayment\b|\binvoice\b|\bbudget\b/, "financial"],
    [/\bbug\b|\bfix\b|\berror\b|\bissue\b/, "technical"],
    [/\bidea\b|\bconcept\b|\bbrainstorm\b/, "ideation"],
    [/\blearn\b|\blesson\b|\binsight\b/, "learning"],
    [/\bdeadline\b|\burgent\b|\basap\b/, "urgent"],
    [/\bfeedback\b|\breview\b/, "feedback"],
    [/\bpersonal\b|\bfamily\b|\bkids?\b/, "personal"],
    [/\bapi\b|\bcode\b|\bdeploy\b|\bserver\b/, "engineering"],
    [/\bstrategy\b|\bplan\b|\broadmap\b/, "strategy"],
  ];

  for (const [pattern, tag] of patterns) {
    if (pattern.test(lower)) {
      tags.add(tag);
    }
  }

  return Array.from(tags);
}
