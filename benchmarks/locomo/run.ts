/**
 * LoCoMo Benchmark Runner for CORTEX
 *
 * Evaluates CORTEX on the LoCoMo benchmark (ACL 2024):
 * 10 long conversations, 1,986 QA pairs across 5 categories.
 *
 * Methodology:
 *   1. Ingest all sessions for each conversation into CORTEX
 *   2. For each question, retrieve top-K relevant chunks
 *   3. Use retrieved context + LLM to generate an answer
 *   4. Score with token F1 against gold answer
 *
 * HONEST top-K: We use top_k=10, NOT top_k=50 (which would
 * retrieve everything and bypass retrieval entirely).
 *
 * Usage: npx tsx benchmarks/locomo/run.ts [--limit 50] [--topk 10] [--skip-cat5]
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  initBenchmark,
  clearBenchmarkData,
  ingestSession,
  search,
} from "../lib/cortex-client.js";
import { llmComplete } from "../../src/lib/llm.js";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LoCoMoConversation {
  sample_id: string;
  conversation: Record<string, unknown> & {
    speaker_a: string;
    speaker_b: string;
    // Sessions are stored as session_1, session_2, etc.
    // Each session is Array<{ speaker: string; text: string; dia_id: string }>
    // Date/time stored as session_1_date_time, etc.
  };
  qa: Array<{
    question: string;
    answer: string;
    evidence: string[];
    category: number;
  }>;
}

/** Extract sessions from LoCoMo conversation dict format */
function extractSessions(conversation: Record<string, unknown>): Array<{
  sessionId: string;
  dateTime: string;
  turns: Array<{ speaker: string; text: string; dia_id: string }>;
}> {
  const sessionKeys = Object.keys(conversation)
    .filter(k => k.startsWith("session_") && !k.endsWith("_date_time"))
    .sort((a, b) => {
      const numA = parseInt(a.replace("session_", ""));
      const numB = parseInt(b.replace("session_", ""));
      return numA - numB;
    });

  return sessionKeys.map(key => ({
    sessionId: key,
    dateTime: String(conversation[`${key}_date_time`] || ""),
    turns: conversation[key] as Array<{ speaker: string; text: string; dia_id: string }>,
  }));
}

interface QAResult {
  conversationId: string;
  question: string;
  goldAnswer: string;
  generatedAnswer: string;
  category: number;
  f1: number;
  exactMatch: boolean;
  retrievalHit: boolean;
}

// Parse args
const args = process.argv.slice(2);
const limitArg = args.includes("--limit") ? parseInt(args[args.indexOf("--limit") + 1]) : 0;
const topK = args.includes("--topk") ? parseInt(args[args.indexOf("--topk") + 1]) : 10;
const skipCat5 = args.includes("--skip-cat5");

/**
 * Normalize text for F1 scoring (LoCoMo standard).
 */
function normalize(text: string | undefined | null): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(a|an|the)\b/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Compute token-level F1 score.
 */
function computeF1(prediction: string, gold: string): number {
  const predTokens = normalize(prediction);
  const goldTokens = normalize(gold);

  if (goldTokens.length === 0 && predTokens.length === 0) return 1.0;
  if (goldTokens.length === 0 || predTokens.length === 0) return 0.0;

  const goldSet = new Set(goldTokens);
  const common = predTokens.filter((t) => goldSet.has(t)).length;

  if (common === 0) return 0.0;

  const precision = common / predTokens.length;
  const recall = common / goldTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Check exact match (set-based).
 */
function exactMatch(prediction: string, gold: string): boolean {
  const predNorm = normalize(prediction).join(" ");
  const goldNorm = normalize(gold).join(" ");
  return predNorm === goldNorm;
}

async function main() {
  console.log("============================================");
  console.log("  CORTEX V2.4 -- LoCoMo Benchmark");
  console.log("============================================");
  console.log(`Top-K: ${topK} | Skip Cat5: ${skipCat5} | Limit: ${limitArg || "all"}`);
  console.log();

  // Load dataset
  const dataFile = join(__dirname, "locomo10.json");
  console.log(`Loading dataset from ${dataFile}...`);
  const rawData = readFileSync(dataFile, "utf-8");
  const conversations: LoCoMoConversation[] = JSON.parse(rawData);
  console.log(`Loaded ${conversations.length} conversations\n`);

  const agentId = await initBenchmark("locomo");
  const allResults: QAResult[] = [];
  let totalQuestions = 0;

  for (let ci = 0; ci < conversations.length; ci++) {
    const conv = conversations[ci];
    const sessions = extractSessions(conv.conversation);
    console.log(`\n--- Conversation ${ci + 1}/${conversations.length}: ${conv.sample_id} (${sessions.length} sessions, ${conv.qa.length} questions) ---`);

    // Clear and ingest this conversation
    await clearBenchmarkData(agentId);

    for (let si = 0; si < sessions.length; si++) {
      const session = sessions[si];
      const sessionText = session.turns
        .map((turn) => `[${turn.speaker}] ${turn.text}`)
        .join("\n");

      await ingestSession(agentId, session.sessionId, sessionText, "locomo");

      if ((si + 1) % 10 === 0) {
        console.log(`  Ingested ${si + 1}/${sessions.length} sessions`);
      }
    }
    console.log(`  Ingested all ${sessions.length} sessions`);

    // Process QA pairs
    let qaList = conv.qa;
    if (skipCat5) {
      qaList = qaList.filter((q) => q.category !== 5);
    }
    if (limitArg > 0) {
      qaList = qaList.slice(0, limitArg);
    }

    for (let qi = 0; qi < qaList.length; qi++) {
      const qa = qaList[qi];
      totalQuestions++;

      // Retrieve context
      const results = await search(agentId, qa.question, topK);
      const context = results.map((r) => r.content).join("\n\n");

      // Check retrieval hit (did we find any evidence dialog?)
      const retrievedSources = results.map((r) => r.source || "").join(" ");
      const retrievalHit = qa.evidence.some((ev) => {
        const sessionNum = ev.split(":")[0].replace("D", "");
        return retrievedSources.includes(sessionNum);
      });

      // Generate answer using LLM
      let generatedAnswer = "";
      try {
        if (qa.category === 5) {
          // Adversarial: check if we should abstain
          const response = await llmComplete(
            [
              {
                role: "user",
                content: `Answer ONLY from the conversation context below. If the answer is NOT in the context, respond with exactly: "I don't have enough information to answer that question."

Context:
${context.slice(0, 6000)}

Question: ${qa.question}

Rules: If answerable, give ONLY the exact answer in the fewest possible words. No sentences. No explanation. Just the answer.
Answer:`,
              },
            ],
            { maxTokens: 50, temperature: 0 }
          );
          generatedAnswer = response.content.trim();
        } else {
          const response = await llmComplete(
            [
              {
                role: "user",
                content: `Answer the question using ONLY the conversation context below.

Context:
${context.slice(0, 6000)}

Question: ${qa.question}

Rules:
- Give ONLY the direct answer, nothing else
- Use the fewest words possible
- For dates: use the exact format from the conversation (e.g., "7 May 2023" not "May 7th, 2023")
- For names: just the name
- For lists: comma-separated, no "and"
- No sentences, no explanation, no "The answer is..."
- If asking "when": give only the date/time
- If asking "what": give only the thing
- If asking "who": give only the name
Answer:`,
              },
            ],
            { maxTokens: 100, temperature: 0 }
          );
          generatedAnswer = response.content.trim();
        }
      } catch (err) {
        console.error(`  Error generating answer for Q${qi + 1}:`, err);
        generatedAnswer = "Error generating answer";
      }

      // Score
      let f1: number;
      if (qa.category === 5) {
        // Category 5: binary abstention check
        const abstains =
          generatedAnswer.toLowerCase().includes("don't have enough information") ||
          generatedAnswer.toLowerCase().includes("not mentioned") ||
          generatedAnswer.toLowerCase().includes("no information available") ||
          generatedAnswer.toLowerCase().includes("cannot determine") ||
          generatedAnswer.toLowerCase().includes("not enough context");
        f1 = abstains ? 1.0 : 0.0;
      } else if (qa.category === 1) {
        // Category 1: multi-hop, compute partial F1 per sub-answer
        const subAnswers = String(qa.answer).split(",").map((a) => a.trim());
        const subF1s = subAnswers.map((sub) => computeF1(generatedAnswer, sub));
        f1 = subF1s.reduce((a, b) => a + b, 0) / subF1s.length;
      } else {
        f1 = computeF1(generatedAnswer, qa.answer);
      }

      const result: QAResult = {
        conversationId: conv.sample_id,
        question: qa.question,
        goldAnswer: qa.answer,
        generatedAnswer,
        category: qa.category,
        f1,
        exactMatch: exactMatch(generatedAnswer, qa.answer),
        retrievalHit,
      };
      allResults.push(result);

      const status = f1 >= 0.5 ? "PASS" : "FAIL";
      if (totalQuestions % 10 === 0 || f1 < 0.5) {
        console.log(
          `  [${totalQuestions}] Cat${qa.category} ${status} F1=${f1.toFixed(3)} | Q: "${String(qa.question).slice(0, 60)}..." | Gold: "${String(qa.answer).slice(0, 40)}"`
        );
      }
    }
  }

  // Cleanup
  await clearBenchmarkData(agentId);

  // Aggregate results
  console.log("\n============================================");
  console.log("  RESULTS");
  console.log("============================================\n");

  const avgF1 = allResults.reduce((s, r) => s + r.f1, 0) / allResults.length;
  const avgEM = allResults.filter((r) => r.exactMatch).length / allResults.length;
  const avgRetrieval = allResults.filter((r) => r.retrievalHit).length / allResults.length;

  console.log(`Total Questions: ${allResults.length}`);
  console.log(`Overall F1: ${(avgF1 * 100).toFixed(1)}%`);
  console.log(`Exact Match: ${(avgEM * 100).toFixed(1)}%`);
  console.log(`Retrieval Hit Rate: ${(avgRetrieval * 100).toFixed(1)}%`);

  // By category
  console.log("\n--- By Category ---\n");
  for (const cat of [1, 2, 3, 4, 5]) {
    const catResults = allResults.filter((r) => r.category === cat);
    if (catResults.length === 0) continue;
    const catF1 = catResults.reduce((s, r) => s + r.f1, 0) / catResults.length;
    const catEM = catResults.filter((r) => r.exactMatch).length / catResults.length;
    const catRetrieval = catResults.filter((r) => r.retrievalHit).length / catResults.length;
    const catLabels: Record<number, string> = {
      1: "Multi-hop",
      2: "Temporal",
      3: "Open-domain",
      4: "Single-hop",
      5: "Adversarial",
    };
    console.log(
      `Cat ${cat} (${catLabels[cat]}): F1=${(catF1 * 100).toFixed(1)}% | EM=${(catEM * 100).toFixed(1)}% | Retrieval=${(catRetrieval * 100).toFixed(1)}% | N=${catResults.length}`
    );
  }

  // Save results
  const outputPath = join(__dirname, `results-top${topK}.json`);
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        benchmark: "LoCoMo",
        topK,
        skipCat5,
        timestamp: new Date().toISOString(),
        system: "CORTEX V2.4",
        methodology: `Honest top_k=${topK} retrieval (not top_k=50 bypass). LLM-generated answers scored with token F1.`,
        overall: { avgF1, avgEM, avgRetrieval, total: allResults.length },
        byCategory: Object.fromEntries(
          [1, 2, 3, 4, 5].map((cat) => {
            const catR = allResults.filter((r) => r.category === cat);
            return [
              cat,
              {
                f1: catR.length > 0 ? catR.reduce((s, r) => s + r.f1, 0) / catR.length : 0,
                em: catR.length > 0 ? catR.filter((r) => r.exactMatch).length / catR.length : 0,
                retrieval: catR.length > 0 ? catR.filter((r) => r.retrievalHit).length / catR.length : 0,
                count: catR.length,
              },
            ];
          })
        ),
      },
      null,
      2
    )
  );
  console.log(`\nResults saved to ${outputPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
