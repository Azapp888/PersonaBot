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
  append(personaId: string, userId: string, messages: ChatMessage[]): Conversation {
    const conv = this.ensure(personaId, userId);
    const merged = [...conv.messages, ...messages];
    this.db()
      .prepare(`UPDATE conversations SET messages = ?, updated_at = ? WHERE id = ?`)
      .run(toJson(merged), now(), conv.id);
    return { ...conv, messages: merged, updatedAt: now() };
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
