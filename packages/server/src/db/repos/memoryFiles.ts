import type Database from "better-sqlite3";
import { getDb } from "../index";
import { now } from "../../utils/id";

export interface MemoryFileRecord {
  personaId: string;
  userId: string;
  name: string;
  content: string;
  userEdited: boolean;
  updatedAt: number;
}

function map(row: any): MemoryFileRecord {
  return {
    personaId: row.persona_id,
    userId: row.user_id,
    name: row.name,
    content: row.content,
    userEdited: !!row.user_edited,
    updatedAt: row.updated_at,
  };
}

export const memoryFileRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, userId: string, name: string): MemoryFileRecord | null {
    const row = this.db()
      .prepare(`SELECT * FROM memory_files WHERE persona_id = ? AND user_id = ? AND name = ?`)
      .get(personaId, userId, name);
    return row ? map(row) : null;
  },
  listByUser(personaId: string, userId: string): MemoryFileRecord[] {
    return this.db()
      .prepare(`SELECT * FROM memory_files WHERE persona_id = ? AND user_id = ?`)
      .all(personaId, userId)
      .map(map);
  },
  save(personaId: string, userId: string, name: string, content: string, userEdited: boolean): void {
    this.db()
      .prepare(
        `INSERT INTO memory_files (persona_id, user_id, name, content, user_edited, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(persona_id, user_id, name)
         DO UPDATE SET content = excluded.content, user_edited = excluded.user_edited, updated_at = excluded.updated_at`,
      )
      .run(personaId, userId, name, content, userEdited ? 1 : 0, now());
  },
};
