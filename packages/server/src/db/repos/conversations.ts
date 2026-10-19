import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { ChatMessage, Conversation } from "../../types";
import { newId, now } from "../../utils/id";
import { safeJsonParse, toJson } from "../../utils/json";

function map(row: any): Conversation {
  return {
    id: row.id,
    personaId: row.persona_id,
    userId: row.user_id,
    messages: safeJsonParse<ChatMessage[]>(row.messages, []),
    updatedAt: row.updated_at,
  };
}

export const conversationRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, userId: string): Conversation | null {
    const row = this.db()
      .prepare(`SELECT * FROM conversations WHERE persona_id = ? AND user_id = ?`)
      .get(personaId, userId);
    return row ? map(row) : null;
  },
  ensure(personaId: string, userId: string): Conversation {
    const existing = this.find(personaId, userId);
    if (existing) return existing;
    const id = newId("cnv_");
    this.db()
      .prepare(
        `INSERT INTO conversations (id, persona_id, user_id, messages, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, personaId, userId, toJson([]), now());
    return this.find(personaId, userId)!;
  },
  listByPersona(personaId: string): Conversation[] {
    return this.db()
      .prepare(`SELECT * FROM conversations WHERE persona_id = ? ORDER BY updated_at DESC`)
      .all(personaId)
      .map(map);
  },
  listRecent(limit = 20): Conversation[] {
    return this.db()
      .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?`)
      .all(limit)
      .map(map);
  },
  /** 管理端会话总览：可按角色/用户过滤，按最近更新时间倒序。 */
  listAll(filter: { personaId?: string | null; userId?: string | null } = {}, limit = 500): Conversation[] {
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
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    return this.db()
      .prepare(`SELECT * FROM conversations ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params, limit)
      .map(map);
  },
  append(personaId: string, userId: string, messages: ChatMessage[]): Conversation {
    const conv = this.ensure(personaId, userId);
    let merged = [...conv.messages, ...messages];
    // 裁剪最旧消息，避免单会话 JSON 无限增长；近期原文仍由滑动窗口 + 滚动摘要覆盖。
    const max = conversationRepo.maxMessages();
    if (max > 0 && merged.length > max) {
      merged = merged.slice(merged.length - max);
    }
    this.db()
      .prepare(`UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?`)
      .run(toJson(merged), now(), conv.id);
    return { ...conv, messages: merged, updatedAt: now() };
  },
  /** 读取限制（每次动态读取以支持热更新配置）。 */
  maxMessages(): number {
    try {
      // 延迟 require 避免与 settings 层循环依赖
      const { settingsService } = require("../../settings/service") as typeof import("../../settings/service");
      return Number(settingsService.get().conversationMaxMessages) || 400;
    } catch {
      return 400;
    }
  },
  /** 删除指定下标的一条消息，返回被删除的消息。 */
  deleteAt(personaId: string, userId: string, index: number): ChatMessage | null {
    const conv = this.ensure(personaId, userId);
    if (index < 0 || index >= conv.messages.length) return null;
    const messages = [...conv.messages];
    const [removed] = messages.splice(index, 1);
    this.replaceMessages(personaId, userId, messages);
    return removed ?? null;
  },
  /** 从指定下标起删除其后的所有消息，返回被删除的消息列表。 */
  deleteFrom(personaId: string, userId: string, index: number): ChatMessage[] {
    const conv = this.ensure(personaId, userId);
    const start = Math.max(0, Math.min(index, conv.messages.length));
    const removed = conv.messages.slice(start);
    if (!removed.length) return [];
    this.replaceMessages(personaId, userId, conv.messages.slice(0, start));
    return removed;
  },
  /** 清空会话原文（保留会话记录本身）。 */
  clear(personaId: string, userId: string): void {
    this.replaceMessages(personaId, userId, []);
  },
  replaceMessages(personaId: string, userId: string, messages: ChatMessage[]): void {
    const conv = this.ensure(personaId, userId);
    this.db()
      .prepare(`UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?`)
      .run(toJson(messages), now(), conv.id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  },
};
