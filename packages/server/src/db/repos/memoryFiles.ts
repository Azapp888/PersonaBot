import type Database from "better-sqlite3";
import { getDb } from "../index";
import { now } from "../../utils/id";

export interface MemoryFileRecord {
  personaId: string;
  userId: string;
  name: string;
  content: string;
  /**
   * 用户手动编辑的原文基准（不含 AI 追加区）。
   * 为空时表示 content 即为用户原文（尚未发生 AI 追加）。
   */
  baseContent: string;
  userEdited: boolean;
  /** 是否允许 AI 在该文件上自动追加内容（需全局开关同时开启）。 */
  appendEnabled: boolean;
  updatedAt: number;
}

function map(row: any): MemoryFileRecord {
  return {
    personaId: row.persona_id,
    userId: row.user_id,
    name: row.name,
    content: row.content,
    baseContent: row.base_content ?? "",
    userEdited: !!row.user_edited,
    appendEnabled: !!row.append_enabled,
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
        `INSERT INTO memory_files (persona_id, user_id, name, content, user_edited, base_content, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(persona_id, user_id, name)
         DO UPDATE SET content = excluded.content,
                       user_edited = excluded.user_edited,
                       base_content = excluded.base_content,
                       updated_at = excluded.updated_at`,
      )
      .run(personaId, userId, name, content, userEdited ? 1 : 0, content, now());
  },
  /** 仅更新追加开关，不影响内容。 */
  setAppendEnabled(personaId: string, userId: string, name: string, enabled: boolean): void {
    this.db()
      .prepare(
        `INSERT INTO memory_files (persona_id, user_id, name, content, user_edited, append_enabled, updated_at)
         VALUES (?, ?, ?, '', 0, ?, ?)
         ON CONFLICT(persona_id, user_id, name)
         DO UPDATE SET append_enabled = excluded.append_enabled, updated_at = excluded.updated_at`,
      )
      .run(personaId, userId, name, enabled ? 1 : 0, now());
  },
  /**
   * 写入 AI 追加后的内容，同时保留 base_content（用户原文基准）不动。
   * baseContent 为 null 表示不修改既有 base_content。
   */
  saveAppended(
    personaId: string,
    userId: string,
    name: string,
    content: string,
    baseContent: string | null,
  ): void {
    if (baseContent === null) {
      this.db()
        .prepare(
          `UPDATE memory_files SET content = ?, updated_at = ? WHERE persona_id = ? AND user_id = ? AND name = ?`,
        )
        .run(content, now(), personaId, userId, name);
      return;
    }
    this.db()
      .prepare(
        `INSERT INTO memory_files (persona_id, user_id, name, content, user_edited, base_content, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(persona_id, user_id, name)
         DO UPDATE SET content = excluded.content,
                       base_content = excluded.base_content,
                       updated_at = excluded.updated_at`,
      )
      .run(personaId, userId, name, content, baseContent, now());
  },
};
