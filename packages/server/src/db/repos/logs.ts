import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { LLMUsage } from "../../types";
import { newId } from "../../utils/id";

export interface MessageLogFilter {
  personaId?: string | null;
  userId?: string | null;
  direction?: "in" | "out" | null;
  /** 内容关键字（模糊匹配） */
  q?: string | null;
  /** 起始时间戳（含） */
  since?: number | null;
  /** 结束时间戳（不含） */
  until?: number | null;
  /** 是否只看已标记无效的记录；不传表示两者都要 */
  invalid?: boolean | null;
}

function buildLogWhere(filter: MessageLogFilter): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.personaId) {
    conds.push("persona_id = ?");
    params.push(filter.personaId);
  }
  if (filter.userId) {
    conds.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.direction) {
    conds.push("direction = ?");
    params.push(filter.direction);
  }
  if (filter.q) {
    conds.push("content LIKE ?");
    params.push(`%${filter.q}%`);
  }
  if (filter.since != null) {
    conds.push("created_at >= ?");
    params.push(filter.since);
  }
  if (filter.until != null) {
    conds.push("created_at < ?");
    params.push(filter.until);
  }
  if (filter.invalid != null) {
    conds.push("invalid = ?");
    params.push(filter.invalid ? 1 : 0);
  }
  return { clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

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
        `SELECT * FROM message_logs WHERE persona_id = ? AND user_id = ? AND created_at >= ? AND invalid = 0 ORDER BY created_at ASC`,
      )
      .all(personaId, userId, since);
  },
  allMessagesBetween(personaId: string, userId: string, since: number, until: number): any[] {
    return this.db()
      .prepare(
        `SELECT * FROM message_logs WHERE persona_id = ? AND user_id = ? AND created_at >= ? AND created_at < ? AND invalid = 0 ORDER BY created_at ASC`,
      )
      .all(personaId, userId, since, until);
  },
  /** 按条件分页查询消息日志（时间倒序）。 */
  messageLogs(filter: MessageLogFilter, limit: number, offset: number): any[] {
    const { clause, params } = buildLogWhere(filter);
    return this.db()
      .prepare(`SELECT * FROM message_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
  },
  /** 统计符合条件的消息日志总数。 */
  countMessageLogs(filter: MessageLogFilter): number {
    const { clause, params } = buildLogWhere(filter);
    const row = this.db().prepare(`SELECT COUNT(*) AS c FROM message_logs ${clause}`).get(...params) as any;
    return row.c;
  },
  /** 按条件导出消息日志（时间正序，便于阅读）。 */
  exportMessageLogs(filter: MessageLogFilter, limit: number): any[] {
    const { clause, params } = buildLogWhere(filter);
    return this.db()
      .prepare(`SELECT * FROM message_logs ${clause} ORDER BY created_at ASC LIMIT ?`)
      .all(...params, limit);
  },
  /** 聚合出现过的用户 ID（可按角色过滤），用于日志筛选下拉。 */
  distinctUsers(personaId?: string | null): string[] {
    const conds = ["user_id IS NOT NULL", "user_id != ''"];
    const params: unknown[] = [];
    if (personaId) {
      conds.push("persona_id = ?");
      params.push(personaId);
    }
    const rows = this.db()
      .prepare(`SELECT DISTINCT user_id FROM message_logs WHERE ${conds.join(" AND ")}`)
      .all(...params) as any[];
    return rows.map((r) => r.user_id as string).sort();
  },
  /**
   * 把与被删除会话消息最近的一条流水标记为无效。
   * 记忆整理任务只读取 invalid = 0 的记录，因此错误回复不会再次进入日记忆。
   */
  invalidateByContent(
    personaId: string,
    userId: string,
    direction: "in" | "out",
    content: string,
    nearMs: number,
  ): number {
    const row = this.db()
      .prepare(
        `SELECT id FROM message_logs WHERE persona_id = ? AND user_id = ? AND direction = ? AND content = ? AND invalid = 0 ORDER BY ABS(created_at - ?) ASC LIMIT 1`,
      )
      .get(personaId, userId, direction, content, nearMs) as { id: string } | undefined;
    if (!row) return 0;
    this.db().prepare(`UPDATE message_logs SET invalid = 1 WHERE id = ?`).run(row.id);
    return 1;
  },
  /** 将某个时间区间内的流水全部标记为无效（用于清空会话/重置上下文）。 */
  invalidateBetween(personaId: string, userId: string, since: number, until: number): number {
    const info = this.db()
      .prepare(
        `UPDATE message_logs SET invalid = 1 WHERE persona_id = ? AND user_id = ? AND created_at >= ? AND created_at < ? AND invalid = 0`,
      )
      .run(personaId, userId, since, until);
    return info.changes;
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
