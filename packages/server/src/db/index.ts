import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { logger } from "../logger";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  if (!existsSync(config.dataDir)) {
    mkdirSync(config.dataDir, { recursive: true });
  }
  const file = resolve(config.dataDir, "personabot.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  logger.info({ file }, "sqlite database opened");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
