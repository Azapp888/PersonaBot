import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { AppUser } from "../../types";
import { newId, now } from "../../utils/id";

function map(row: any): AppUser {
  return {
    id: row.id,
    externalId: row.external_id,
    displayName: row.display_name ?? "",
    note: row.note ?? "",
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AppUserInput {
  externalId: string;
  displayName?: string;
  note?: string;
  enabled?: boolean;
}

export interface AppUserPatch {
  displayName?: string;
  note?: string;
  enabled?: boolean;
}

/**
 * 开放 API 的用户表。
 *
 * 一个服务器可以服务多个外部用户：每个用户一行，externalId 就是会话与记忆中使用的
 * userId，因此不同外部用户之间的会话、记忆、状态天然隔离。
 */
export const appUserRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): AppUser[] {
    return this.db().prepare(`SELECT * FROM app_users ORDER BY created_at DESC`).all().map(map);
  },
  find(id: string): AppUser | null {
    const row = this.db().prepare(`SELECT * FROM app_users WHERE id = ?`).get(id) as any;
    return row ? map(row) : null;
  },
  findByExternalId(externalId: string): AppUser | null {
    const row = this.db().prepare(`SELECT * FROM app_users WHERE external_id = ?`).get(externalId) as any;
    return row ? map(row) : null;
  },
  create(input: AppUserInput): AppUser {
    const id = newId("usr_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO app_users (id, external_id, display_name, note, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.externalId, input.displayName ?? "", input.note ?? "", input.enabled === false ? 0 : 1, ts, ts);
    return this.find(id)!;
  },
  update(id: string, patch: AppUserPatch): AppUser | null {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.displayName !== undefined) {
      sets.push("display_name = ?");
      values.push(patch.displayName);
    }
    if (patch.note !== undefined) {
      sets.push("note = ?");
      values.push(patch.note);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      values.push(patch.enabled ? 1 : 0);
    }
    if (!sets.length) return this.find(id);
    sets.push("updated_at = ?");
    values.push(now(), id);
    this.db().prepare(`UPDATE app_users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.find(id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM app_users WHERE id = ?`).run(id);
  },
};
