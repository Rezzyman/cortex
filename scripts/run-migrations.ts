import { initDatabase } from "../src/db/index.js";

async function main() {
  console.log("[migrations] Running CORTEX V2.4 migrations...");
  await initDatabase();
  console.log("[migrations] All migrations applied successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrations] Failed:", err);
  process.exit(1);
});
