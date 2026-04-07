import {
  pgTable,
  serial,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  real,
  index,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Custom pgvector type for 1024-dim Voyage embeddings
const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    const str = value as string;
    return str
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});

// ─── Agents ─────────────────────────────────────────────
export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  externalId: varchar("external_id", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  ownerId: varchar("owner_id", { length: 255 }),
  config: jsonb("config").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ─── Memory Nodes ───────────────────────────────────────
export const memoryNodes = pgTable(
  "memory_nodes",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    content: text("content").notNull(),
    summary: text("summary"),
    source: text("source"), // file path, URL, etc.
    sourceType: varchar("source_type", { length: 64 }).default("markdown"), // markdown, telegram, limitless, api
    chunkIndex: integer("chunk_index").default(0),
    embedding: vector("embedding"),
    entities: text("entities")
      .array()
      .default(sql`'{}'::text[]`),
    semanticTags: text("semantic_tags")
      .array()
      .default(sql`'{}'::text[]`),
    priority: integer("priority").default(2), // P0 (critical) - P4 (ephemeral)
    resonanceScore: real("resonance_score").default(5.0),
    accessCount: integer("access_count").default(0),
    lastAccessedAt: timestamp("last_accessed_at").defaultNow(),
    status: varchar("status", { length: 32 }).default("active"), // active, archived, compressed, deleted
    // Temporal validity: when was this fact true?
    validFrom: timestamp("valid_from"), // when this fact became true (null = since creation)
    validUntil: timestamp("valid_until"), // when this fact stopped being true (null = still true)
    supersededBy: integer("superseded_by"), // ID of the memory that replaced this one
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_memory_nodes_agent").on(table.agentId),
    statusIdx: index("idx_memory_nodes_status").on(table.status),
    priorityIdx: index("idx_memory_nodes_priority").on(table.priority),
    resonanceIdx: index("idx_memory_nodes_resonance").on(table.resonanceScore),
    sourceTypeIdx: index("idx_memory_nodes_source_type").on(table.sourceType),
    createdAtIdx: index("idx_memory_nodes_created_at").on(table.createdAt),
    entitiesIdx: index("idx_memory_nodes_entities").using("gin", table.entities),
    semanticTagsIdx: index("idx_memory_nodes_semantic_tags").using(
      "gin",
      table.semanticTags
    ),
  })
);

// ─── Memory Synapses ────────────────────────────────────
export const memorySynapses = pgTable(
  "memory_synapses",
  {
    id: serial("id").primaryKey(),
    memoryA: integer("memory_a")
      .references(() => memoryNodes.id, { onDelete: "cascade" })
      .notNull(),
    memoryB: integer("memory_b")
      .references(() => memoryNodes.id, { onDelete: "cascade" })
      .notNull(),
    connectionType: varchar("connection_type", { length: 32 }).notNull(), // causal, temporal, semantic, entity_shared
    connectionStrength: real("connection_strength").default(0.5).notNull(),
    activationCount: integer("activation_count").default(0),
    decayRate: real("decay_rate").default(0.01),
    lastActivatedAt: timestamp("last_activated_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    memoryAIdx: index("idx_synapses_memory_a").on(table.memoryA),
    memoryBIdx: index("idx_synapses_memory_b").on(table.memoryB),
    typeIdx: index("idx_synapses_type").on(table.connectionType),
    strengthIdx: index("idx_synapses_strength").on(table.connectionStrength),
    pairIdx: uniqueIndex("idx_synapses_pair").on(
      table.memoryA,
      table.memoryB,
      table.connectionType
    ),
  })
);

// ─── Hippocampal Codes (DG Sparse Representations) ─────
export const hippocampalCodes = pgTable(
  "hippocampal_codes",
  {
    id: serial("id").primaryKey(),
    memoryId: integer("memory_id")
      .references(() => memoryNodes.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    sparseIndices: integer("sparse_indices")
      .array()
      .notNull(),
    sparseValues: real("sparse_values")
      .array()
      .notNull(),
    sparseDim: integer("sparse_dim").default(4096),
    noveltyScore: real("novelty_score"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_hc_agent").on(table.agentId),
    memoryIdx: index("idx_hc_memory").on(table.memoryId),
    indicesIdx: index("idx_hc_indices").using("gin", table.sparseIndices),
  })
);

// ─── Emotional Valence (Multi-Dimensional Emotional Context) ─
export const emotionalValence = pgTable(
  "emotional_valence",
  {
    id: serial("id").primaryKey(),
    memoryId: integer("memory_id")
      .references(() => memoryNodes.id, { onDelete: "cascade" })
      .notNull()
      .unique(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    valence: real("valence").default(0).notNull(), // -1 to 1
    arousal: real("arousal").default(0).notNull(), // -1 to 1
    dominance: real("dominance").default(0).notNull(), // -1 to 1
    certainty: real("certainty").default(0).notNull(), // -1 to 1
    relevance: real("relevance").default(0.3).notNull(), // 0 to 1
    urgency: real("urgency").default(0).notNull(), // 0 to 1
    intensity: real("intensity").default(0).notNull(), // derived: vector magnitude
    decayResistance: real("decay_resistance").default(0).notNull(), // 0 to 1
    recallBoost: real("recall_boost").default(0).notNull(), // 0 to 1
    dominantDimension: varchar("dominant_dimension", { length: 32 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_ev_agent").on(table.agentId),
    memoryIdx: index("idx_ev_memory").on(table.memoryId),
    intensityIdx: index("idx_ev_intensity").on(table.intensity),
    decayResistIdx: index("idx_ev_decay_resistance").on(table.decayResistance),
  })
);

// ─── Procedural Memories (Skills/Workflows/Habits) ──────
export const proceduralMemories = pgTable(
  "procedural_memories",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").notNull(),
    proceduralType: varchar("procedural_type", { length: 32 }).notNull(), // skill, workflow, pattern, preference, heuristic
    triggerContext: text("trigger_context").notNull(), // when does this apply
    steps: text("steps").array().default(sql`'{}'::text[]`),
    embedding: vector("embedding"),
    proficiency: varchar("proficiency", { length: 32 }).default("novice"), // novice, competent, proficient, expert
    executionCount: integer("execution_count").default(0),
    successCount: integer("success_count").default(0),
    successRate: real("success_rate").default(0),
    domainTags: text("domain_tags").array().default(sql`'{}'::text[]`),
    sourceMemoryIds: integer("source_memory_ids").array().default(sql`'{}'::int[]`),
    version: integer("version").default(1),
    status: varchar("status", { length: 32 }).default("active"),
    lastExecutedAt: timestamp("last_executed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_proc_agent").on(table.agentId),
    typeIdx: index("idx_proc_type").on(table.proceduralType),
    proficiencyIdx: index("idx_proc_proficiency").on(table.proficiency),
    domainTagsIdx: index("idx_proc_domain_tags").using("gin", table.domainTags),
    statusIdx: index("idx_proc_status").on(table.status),
  })
);

// ─── Cognitive Artifacts ────────────────────────────────
export const cognitiveArtifacts = pgTable(
  "cognitive_artifacts",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    sessionId: varchar("session_id", { length: 128 }),
    artifactType: varchar("artifact_type", { length: 32 }).notNull(), // decision, learning, correction, insight
    content: jsonb("content").notNull(),
    embedding: vector("embedding"),
    resonanceScore: real("resonance_score").default(5.0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_artifacts_agent").on(table.agentId),
    typeIdx: index("idx_artifacts_type").on(table.artifactType),
    createdAtIdx: index("idx_artifacts_created_at").on(table.createdAt),
  })
);

// ─── Dream Cycle Logs ───────────────────────────────────
export const dreamCycleLogs = pgTable(
  "dream_cycle_logs",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    cycleType: varchar("cycle_type", { length: 32 }).notNull(), // full, resonance_only, pruning_only, consolidation_only
    stats: jsonb("stats").default({}),
    insightsDiscovered: jsonb("insights_discovered").default([]),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    agentIdx: index("idx_dream_logs_agent").on(table.agentId),
    startedAtIdx: index("idx_dream_logs_started_at").on(table.startedAt),
  })
);

// ─── Self Diagnostics (Phase 1: Proprioception) ────────
export const selfDiagnostics = pgTable(
  "self_diagnostics",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    skillsStatus: jsonb("skills_status").default({}),
    cronStatus: jsonb("cron_status").default({}),
    channelsStatus: jsonb("channels_status").default({}),
    driftScore: real("drift_score").default(0),
    driftDetails: jsonb("drift_details").default({}),
    alerts: text("alerts")
      .array()
      .default(sql`'{}'::text[]`),
    overallHealth: varchar("overall_health", { length: 32 }).default("healthy"), // healthy, degraded, critical
  },
  (table) => ({
    agentIdx: index("idx_self_diagnostics_agent").on(table.agentId),
    timestampIdx: index("idx_self_diagnostics_timestamp").on(table.timestamp),
    healthIdx: index("idx_self_diagnostics_health").on(table.overallHealth),
  })
);

// ─── Agent State Logs (Phase 1: Proprioception) ────────
export const agentStateLogs = pgTable(
  "agent_state_logs",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    sessionId: varchar("session_id", { length: 128 }),
    energyState: varchar("energy_state", { length: 32 }).default("normal"), // high, normal, low, depleted
    activeThreads: jsonb("active_threads").default([]),
    confidence: real("confidence").default(0.5),
    memoryQuality: real("memory_quality").default(0.5),
    concerns: text("concerns")
      .array()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
  },
  (table) => ({
    agentIdx: index("idx_agent_state_logs_agent").on(table.agentId),
    timestampIdx: index("idx_agent_state_logs_timestamp").on(table.timestamp),
    sessionIdx: index("idx_agent_state_logs_session").on(table.sessionId),
  })
);

// ─── Principal State (Phase 2: Empathic Modeling) ──────
export const principalState = pgTable(
  "principal_state",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
    energy: real("energy").default(0.5),
    stress: real("stress").default(0.3),
    focusState: varchar("focus_state", { length: 32 }).default("normal"), // hyperfocus, flow, normal, scattered, executive_dysfunction
    emotionalValence: real("emotional_valence").default(0), // -1 to 1
    adhdState: varchar("adhd_state", { length: 32 }).default("managed"), // hyperfocus, managed, restless, overwhelmed, shutdown
    rawSignals: jsonb("raw_signals").default({}),
    inferredFrom: text("inferred_from"),
    confidenceScore: real("confidence_score").default(0.5),
  },
  (table) => ({
    agentIdx: index("idx_principal_state_agent").on(table.agentId),
    timestampIdx: index("idx_principal_state_timestamp").on(table.timestamp),
  })
);

// ─── Background Threads (Phase 3: Autonomous Cognition) ─
export const backgroundThreads = pgTable(
  "background_threads",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    threadType: varchar("thread_type", { length: 32 }).notNull(), // strategic, operational, relational
    status: varchar("status", { length: 32 }).default("idle"), // idle, running, completed, error
    lastRun: timestamp("last_run"),
    findings: jsonb("findings").default({ insights: [], actions: [], questions: [] }),
    nextAction: text("next_action"),
    priority: integer("priority").default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index("idx_bg_threads_agent").on(table.agentId),
    typeIdx: index("idx_bg_threads_type").on(table.threadType),
    statusIdx: index("idx_bg_threads_status").on(table.status),
  })
);

// ─── Relationship Graph (Phase 5: Social Intelligence) ──
export const relationshipGraph = pgTable(
  "relationship_graph",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id")
      .references(() => agents.id)
      .notNull(),
    personName: varchar("person_name", { length: 255 }).notNull(),
    personEmail: varchar("person_email", { length: 255 }),
    relationshipType: varchar("relationship_type", { length: 32 }), // family, client, partner, vendor, friend, professional
    lastContact: timestamp("last_contact"),
    contactFrequency: varchar("contact_frequency", { length: 32 }).default("as_needed"), // daily, weekly, biweekly, monthly, quarterly, as_needed
    importanceScore: real("importance_score").default(5),
    personalityModel: jsonb("personality_model").default({}),
    openItems: jsonb("open_items").default([]),
    communicationPrefs: jsonb("communication_prefs").default({}),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    agentPersonIdx: uniqueIndex("idx_relationship_agent_person").on(
      table.agentId,
      table.personName
    ),
    agentIdx: index("idx_relationship_agent").on(table.agentId),
    personIdx: index("idx_relationship_person").on(table.personName),
    typeIdx: index("idx_relationship_type").on(table.relationshipType),
    importanceIdx: index("idx_relationship_importance").on(table.importanceScore),
  })
);

// ─── Type exports ───────────────────────────────────────
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type MemoryNode = typeof memoryNodes.$inferSelect;
export type NewMemoryNode = typeof memoryNodes.$inferInsert;
export type MemorySynapse = typeof memorySynapses.$inferSelect;
export type NewMemorySynapse = typeof memorySynapses.$inferInsert;
export type HippocampalCode = typeof hippocampalCodes.$inferSelect;
export type EmotionalValenceRow = typeof emotionalValence.$inferSelect;
export type NewEmotionalValenceRow = typeof emotionalValence.$inferInsert;
export type ProceduralMemoryRow = typeof proceduralMemories.$inferSelect;
export type NewProceduralMemoryRow = typeof proceduralMemories.$inferInsert;
export type NewHippocampalCode = typeof hippocampalCodes.$inferInsert;
export type CognitiveArtifact = typeof cognitiveArtifacts.$inferSelect;
export type NewCognitiveArtifact = typeof cognitiveArtifacts.$inferInsert;
export type DreamCycleLog = typeof dreamCycleLogs.$inferSelect;
export type NewDreamCycleLog = typeof dreamCycleLogs.$inferInsert;
export type SelfDiagnostic = typeof selfDiagnostics.$inferSelect;
export type NewSelfDiagnostic = typeof selfDiagnostics.$inferInsert;
export type AgentStateLog = typeof agentStateLogs.$inferSelect;
export type NewAgentStateLog = typeof agentStateLogs.$inferInsert;
export type PrincipalState = typeof principalState.$inferSelect;
export type NewPrincipalState = typeof principalState.$inferInsert;
export type BackgroundThread = typeof backgroundThreads.$inferSelect;
export type NewBackgroundThread = typeof backgroundThreads.$inferInsert;
export type RelationshipEntry = typeof relationshipGraph.$inferSelect;
export type NewRelationshipEntry = typeof relationshipGraph.$inferInsert;
