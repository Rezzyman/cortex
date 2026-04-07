import express from "express";
import cors from "cors";
import "dotenv/config";
import { initDatabase } from "./db/index.js";
import { searchRouter } from "./api/search.js";
import { recallRouter } from "./api/recall.js";
import { ingestRouter } from "./api/ingest.js";
import { healthRouter } from "./api/health.js";
import { reconsolidateRouter } from "./api/reconsolidate.js";
import { proceduralRouter } from "./api/procedural.js";
import { graphRouter } from "./api/graph.js";
import { dreamRouter } from "./api/dream.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3100", 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/v1/search", searchRouter);
app.use("/api/v1/recall", recallRouter);
app.use("/api/v1/ingest", ingestRouter);
app.use("/api/v1/reconsolidate", reconsolidateRouter);
app.use("/api/v1/procedural", proceduralRouter);
app.use("/api/v1/graph", graphRouter);
app.use("/api/v1/dream", dreamRouter);
app.use("/api/v1", healthRouter);

// Root
app.get("/", (_req, res) => {
  res.json({
    service: "CORTEX V2",
    description: "Synthetic cognition infrastructure for AI agents",
    version: "2.2.0",
    endpoints: {
      health: "GET /api/v1/health",
      status: "GET /api/v1/status",
      search: "POST /api/v1/search",
      recall: "POST /api/v1/recall",
      ingest: "POST /api/v1/ingest",
      reconsolidate: "POST /api/v1/reconsolidate",
      labileMemories: "GET /api/v1/reconsolidate/labile?agentId=xxx",
      proceduralStore: "POST /api/v1/procedural",
      proceduralRetrieve: "POST /api/v1/procedural/retrieve",
      proceduralExecute: "POST /api/v1/procedural/:id/execute",
      proceduralRefine: "PATCH /api/v1/procedural/:id",
      graph: "GET /api/v1/graph?agentId=xxx",
      dream: "POST /api/v1/dream",
    },
  });
});

// Start
async function start() {
  try {
    await initDatabase();
    console.log("[cortex] Database connected");
  } catch (err) {
    console.error("[cortex] Database connection failed:", err);
    console.log("[cortex] Starting without database — some endpoints will fail");
  }

  app.listen(PORT, () => {
    console.log(`[cortex] CORTEX V2 running on http://localhost:${PORT}`);
  });
}

start();

export default app;
