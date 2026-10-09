import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { LLMUsage } from "../../types";
import { newId } from "../../utils/id";

export const logRepo = {
  db(): Database.Database {
    return getDb();
  },
  message(entry: {
    personaId?: string | null;
    botId?: string | null;
    userId: string;
    direction: "in" | "out";
    content: string;
  }): void {
    this.db()
      .prepare(
        `INSERT INTO message_logs (id, persona_id, bot_id, user_id, direction, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("msg_"),
        entry.personaId ?? null,
        entry.botId ?? null,
        entry.userId,
        entry.direction,
        entry.content,
        Date.now(),
      );
  },
  messagesSince(personaId: string, userId: string, since: number): any[] {
    return this.db()
      .prepare(
        `SELECT * FROM message_logs WHERE persona_id = ? AND user_id = ? AND created_at >= ? ORDER BY created_at ASC`,
      )
      .all(personaId, userId, since);
  },
  allMessagesBetween(personaId: string, userId: string, since: number, until: number): any[] {
    return this.db()
      .prepare(
        `SELECT * FROM message_logs WHERE persona_id = ? AND user_id = ? AND created_at >= ? AND created_at < ? ORDER BY created_at ASC`,
      )
      .all(personaId, userId, since, until);
  },
  usage(entry: {
    modelId?: string | null;
    personaId?: string | null;
    usage: LLMUsage;
  }): void {
    this.db()
      .prepare(
        `INSERT INTO token_usage (id, model_id, persona_id, input_tokens, output_tokens, cache_hit_tokens, cache_miss_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("tok_"),
        entry.modelId ?? null,
        entry.personaId ?? null,
        entry.usage.inputTokens,
        entry.usage.outputTokens,
        entry.usage.cacheHitTokens,
        entry.usage.cacheMissTokens,
        Date.now(),
      );
  },
  painting(entry: { personaId: string; userId: string; prompt: string; imageUrl?: string | null }): void {
    this.db()
      .prepare(
        `INSERT INTO painting_logs (id, persona_id, user_id, prompt, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId("img_"), entry.personaId, entry.userId, entry.prompt, entry.imageUrl ?? null, Date.now());
  },
  paintingCountSince(personaId: string, userId: string, since: number): number {
    const row = this.db()
      .prepare(`SELECT COUNT(*) AS c FROM painting_logs WHERE persona_id = ? AND user_id = ? AND created_at >= ?`)
      .get(personaId, userId, since) as any;
    return row.c;
  },
  paintingCountGlobalSince(since: number): number {
    const row = this.db()
      .prepare(`SELECT COUNT(*) AS c FROM painting_logs WHERE created_at >= ?`)
      .get(since) as any;
    return row.c;
  },
};
