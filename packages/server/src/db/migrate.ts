import type Database from "better-sqlite3";
import { getDb } from "./index";
import { logger } from "../logger";

interface Migration {
  id: string;
  sql: string;
}

/**
 * 迁移脚本按顺序执行，已执行的记录在 _migrations 表，保证幂等。
 */
const migrations: Migration[] = [
  {
    id: "001_init",
    sql: `
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  app_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  access_token TEXT,
  token_expires_at INTEGER,
  persona_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS personas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT,
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '{}',
  skills TEXT NOT NULL DEFAULT '[]',
  commands TEXT NOT NULL DEFAULT '[]',
  painting_config TEXT NOT NULL DEFAULT '{}',
  model_config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT,
  api_base TEXT,
  model_id TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.8,
  max_tokens INTEGER NOT NULL DEFAULT 2048,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  source_date TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_lookup ON memories(persona_id, user_id, type, created_at);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  UNIQUE(persona_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  habits TEXT NOT NULL DEFAULT '{}',
  last_interaction_at INTEGER,
  last_proactive_at INTEGER,
  UNIQUE(user_id, persona_id)
);

CREATE TABLE IF NOT EXISTS stats (
  date TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  token_consumed INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  images_generated INTEGER NOT NULL DEFAULT 0,
  messages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, persona_id)
);

CREATE TABLE IF NOT EXISTS message_logs (
  id TEXT PRIMARY KEY,
  persona_id TEXT,
  bot_id TEXT,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_logs_user ON message_logs(persona_id, user_id, created_at);

CREATE TABLE IF NOT EXISTS token_usage (
  id TEXT PRIMARY KEY,
  model_id TEXT,
  persona_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS painting_logs (
  id TEXT PRIMARY KEY,
  persona_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_painting_lookup ON painting_logs(persona_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'custom',
  version TEXT NOT NULL DEFAULT '1.0.0',
  source TEXT,
  content TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
`,
  },
  {
    id: "002_bot_persona_fk",
    sql: `
CREATE INDEX IF NOT EXISTS idx_bots_persona ON bots(persona_id);
CREATE INDEX IF NOT EXISTS idx_stats_persona ON stats(persona_id, date);
`,
  },
  {
    id: "003_conversation_context",
    sql: `
CREATE TABLE IF NOT EXISTS conversation_context (
  persona_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  summarized_upto INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (persona_id, user_id)
);
`,
  },
  {
    id: "004_bot_agent",
    sql: `
ALTER TABLE bots ADD COLUMN agent_enabled INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    id: "005_daily_memory_files",
    sql: `
ALTER TABLE user_profiles ADD COLUMN last_daily_at INTEGER;

CREATE TABLE IF NOT EXISTS memory_files (
  persona_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  user_edited INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (persona_id, user_id, name)
);
`,
  },
  {
    id: "006_memory_file_append",
    sql: `
ALTER TABLE memory_files ADD COLUMN append_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memory_files ADD COLUMN base_content TEXT NOT NULL DEFAULT '';
`,
  },
  {
    id: "007_model_supports_vision",
    sql: `
ALTER TABLE models ADD COLUMN supports_vision INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    id: "008_memory_importance",
    sql: `
ALTER TABLE memories ADD COLUMN importance INTEGER NOT NULL DEFAULT 5;
ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'event';
ALTER TABLE memories ADD COLUMN consolidated_into TEXT;
CREATE INDEX IF NOT EXISTS idx_memories_core ON memories(persona_id, user_id, pinned, importance);
`,
  },
  {
    id: "009_daily_message_count",
    sql: `
ALTER TABLE user_profiles ADD COLUMN daily_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN daily_count_date TEXT;
ALTER TABLE memories ADD COLUMN origin TEXT NOT NULL DEFAULT 'daily';
`,
  },
  {
    id: "010_persona_schedule",
    sql: `
ALTER TABLE personas ADD COLUMN schedule_template TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS persona_schedules (
  persona_id TEXT NOT NULL,
  date TEXT NOT NULL,
  segments TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (persona_id, date)
);
`,
  },
  {
    id: "011_bot_model",
    sql: `
ALTER TABLE bots ADD COLUMN model_id TEXT;
`,
  },
  {
    id: "012_providers",
    sql: `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_base TEXT,
  api_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_name ON providers(name);
`,
  },
  {
    id: "013_system_logs",
    sql: `
CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  category TEXT NOT NULL,
  persona_id TEXT,
  bot_id TEXT,
  user_id TEXT,
  model_id TEXT,
  provider TEXT,
  stage TEXT,
  message TEXT NOT NULL,
  detail TEXT,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_system_logs_time ON system_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_persona ON system_logs(persona_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_user ON system_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_category ON system_logs(category, created_at DESC);
`,
  },
  {
    id: "014_message_logs_invalid",
    sql: `
ALTER TABLE message_logs ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_message_logs_valid ON message_logs(persona_id, user_id, invalid, created_at);
`,
  },
  {
    id: "015_bot_proactive",
    sql: `
ALTER TABLE bots ADD COLUMN proactive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bots ADD COLUMN proactive_max_messages INTEGER NOT NULL DEFAULT 3;
`,
  },
];

export function runMigrations(database?: Database.Database): void {
  const db = database ?? getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  const applied = new Set(
    db.prepare(`SELECT id FROM _migrations`).all().map((r: any) => r.id as string),
  );
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare(`INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`).run(migration.id, Date.now());
    });
    tx();
    logger.info({ migration: migration.id }, "migration applied");
  }
  logger.info({ count: migrations.length }, "migrations up to date");
}

export const migrationList = migrations;
