import { llmComplete } from "../../src/lib/llm.js";
import "dotenv/config";

async function main() {
  console.log("Testing LLM call via OpenRouter...");
  console.log("Provider:", process.env.CORTEX_LLM_PROVIDER);
  console.log("Model:", process.env.CORTEX_LLM_MODEL);

  const r = await llmComplete(
    [{ role: "user", content: "What is 2+2? Answer with just the number." }],
    { maxTokens: 10, temperature: 0 }
  );
  console.log("Response:", JSON.stringify(r));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
