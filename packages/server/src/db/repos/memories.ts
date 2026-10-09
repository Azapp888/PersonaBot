import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Memory, MemoryType } from "../../types";
import { newId, now } from "../../utils/id";

function map(row: any): Memory {
  return {
    id: row.id,
    personaId: row.persona_id,
    userId: row.user_id,
    type: row.type,
    content: row.content,
    sourceDate: row.source_date,
    createdAt: row.created_at,
  };
}

export interface MemoryInput {
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
}

export const memoryRepo = {
  db(): Database.Database {
    return getDb();
  },
  listByPersona(personaId: string): Memory[] {
    return this.db()
      .prepare(`SELECT * FROM memories WHERE persona_id = ? ORDER BY created_at DESC`)
      .all(personaId)
      .map(map);
  },
  listByUser(personaId: string, userId: string): Memory[] {
    return this.db()
      .prepare(`SELECT * FROM memories WHERE persona_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(personaId, userId)
      .map(map);
  },
  latest(personaId: string, userId: string, type: MemoryType): Memory | null {
    const row = this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(personaId, userId, type);
    return row ? map(row) : null;
  },
  listByTypeSince(personaId: string, userId: string, type: MemoryType, since: number): Memory[] {
    return this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND created_at >= ? ORDER BY created_at ASC`,
      )
      .all(personaId, userId, type, since)
      .map(map);
  },
  upsert(input: MemoryInput): Memory {
    const existing = this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND source_date = ?`,
      )
      .get(input.personaId, input.userId, input.type, input.sourceDate) as any;
    if (existing) {
      this.db()
        .prepare(`UPDATE memories SET content = ?, created_at = ? WHERE id = ?`)
        .run(input.content, now(), existing.id);
      return map(this.db().prepare(`SELECT * FROM memories WHERE id = ?`).get(existing.id));
    }
    const id = newId("mem_");
    this.db()
      .prepare(
        `INSERT INTO memories (id, persona_id, user_id, type, content, source_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.personaId, input.userId, input.type, input.content, input.sourceDate, now());
    return map(this.db().prepare(`SELECT * FROM memories WHERE id = ?`).get(id));
  },
  updateContent(id: string, content: string): void {
    this.db().prepare(`UPDATE memories SET content = ? WHERE id = ?`).run(content, id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  },
  distinctUsers(personaId: string): string[] {
    return this.db()
      .prepare(`SELECT DISTINCT user_id FROM memories WHERE persona_id = ?`)
      .all(personaId)
      .map((r: any) => r.user_id as string);
  },
};
