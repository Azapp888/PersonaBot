import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { DailyStats } from "../../types";

function map(row: any): DailyStats {
  return {
    date: row.date,
    personaId: row.persona_id,
    tokenConsumed: row.token_consumed,
    cacheHitTokens: row.cache_hit_tokens,
    cacheMissTokens: row.cache_miss_tokens,
    imagesGenerated: row.images_generated,
    messages: row.messages,
  };
}

export const statsRepo = {
  db(): Database.Database {
    return getDb();
  },
  ensureRow(date: string, personaId: string): void {
    this.db()
      .prepare(
        `INSERT OR IGNORE INTO stats (date, persona_id, token_consumed, cache_hit_tokens, cache_miss_tokens, images_generated, messages)
         VALUES (?, ?, 0, 0, 0, 0, 0)`,
      )
      .run(date, personaId);
  },
  increment(
    date: string,
    personaId: string,
    patch: Partial<Pick<DailyStats, "tokenConsumed" | "cacheHitTokens" | "cacheMissTokens" | "imagesGenerated" | "messages">>,
  ): void {
    this.ensureRow(date, personaId);
    this.db()
      .prepare(
        `UPDATE stats SET
           token_consumed = token_consumed + @tokenConsumed,
           cache_hit_tokens = cache_hit_tokens + @cacheHitTokens,
           cache_miss_tokens = cache_miss_tokens + @cacheMissTokens,
           images_generated = images_generated + @imagesGenerated,
           messages = messages + @messages
         WHERE date = @date AND persona_id = @personaId`,
      )
      .run({
        date,
        personaId,
        tokenConsumed: patch.tokenConsumed ?? 0,
        cacheHitTokens: patch.cacheHitTokens ?? 0,
        cacheMissTokens: patch.cacheMissTokens ?? 0,
        imagesGenerated: patch.imagesGenerated ?? 0,
        messages: patch.messages ?? 0,
      });
  },
  byDate(date: string): DailyStats[] {
    return this.db().prepare(`SELECT * FROM stats WHERE date = ?`).all(date).map(map);
  },
  range(startDate: string, endDate: string): DailyStats[] {
    return this.db()
      .prepare(`SELECT * FROM stats WHERE date >= ? AND date <= ? ORDER BY date ASC`)
      .all(startDate, endDate)
      .map(map);
  },
  rangeByPersona(personaId: string, startDate: string, endDate: string): DailyStats[] {
    return this.db()
      .prepare(`SELECT * FROM stats WHERE persona_id = ? AND date >= ? AND date <= ? ORDER BY date ASC`)
      .all(personaId, startDate, endDate)
      .map(map);
  },
  resetDate(date: string): void {
    this.db().prepare(`DELETE FROM stats WHERE date = ?`).run(date);
  },
};
