import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Skill } from "../../types";
import { now } from "../../utils/id";

function map(row: any): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    version: row.version,
    source: row.source,
    content: row.content,
    enabled: !!row.enabled,
    updatedAt: row.updated_at,
  };
}

export interface SkillInput {
  id: string;
  name: string;
  description?: string;
  type: Skill["type"];
  version?: string;
  source?: string | null;
  content?: string;
  enabled?: boolean;
}

export const skillRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): Skill[] {
    return this.db().prepare(`SELECT * FROM skills ORDER BY type ASC, name ASC`).all().map(map);
  },
  listEnabled(): Skill[] {
    return this.db().prepare(`SELECT * FROM skills WHERE enabled = 1`).all().map(map);
  },
  find(id: string): Skill | null {
    const row = this.db().prepare(`SELECT * FROM skills WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  upsert(input: SkillInput): Skill {
    this.db()
      .prepare(
        `INSERT INTO skills (id, name, description, type, version, source, content, enabled, updated_at)
         VALUES (@id, @name, @description, @type, @version, @source, @content, @enabled, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           type = excluded.type,
           version = excluded.version,
           source = excluded.source,
           content = excluded.content,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: input.id,
        name: input.name,
        description: input.description ?? "",
        type: input.type,
        version: input.version ?? "1.0.0",
        source: input.source ?? null,
        content: input.content ?? "",
        enabled: input.enabled === false ? 0 : 1,
        updatedAt: now(),
      });
    return this.find(input.id)!;
  },
  setEnabled(id: string, enabled: boolean): void {
    this.db().prepare(`UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, now(), id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  },
};
