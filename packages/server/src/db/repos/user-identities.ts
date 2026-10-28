import type Database from "better-sqlite3";
import { getDb } from "../index";
import { now } from "../../utils/id";
import type { UserIdentity } from "../../types";

function map(row: any): UserIdentity {
  return {
    personaId: row.persona_id,
    userId: row.user_id,
    nickname: row.nickname ?? "",
    realName: row.real_name ?? "",
    relationship: row.relationship ?? "",
    addressPreference: row.address_preference ?? "",
    boundaries: row.boundaries ?? "",
    updatedAt: row.updated_at,
  };
}

export interface UserIdentityInput {
  personaId: string;
  userId: string;
  nickname?: string;
  realName?: string;
  relationship?: string;
  addressPreference?: string;
  boundaries?: string;
}

/**
 * 用户层身份存储。所有字段按 (personaId, userId) 隔离，
 * 不做任何跨用户回退，避免一个用户的称呼/关系泄漏给另一个用户。
 */
export const userIdentityRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, userId: string): UserIdentity | null {
    const row = this.db()
      .prepare(`SELECT * FROM user_identities WHERE persona_id = ? AND user_id = ?`)
      .get(personaId, userId);
    return row ? map(row) : null;
  },
  listByPersona(personaId: string): UserIdentity[] {
    return this.db()
      .prepare(`SELECT * FROM user_identities WHERE persona_id = ? ORDER BY updated_at DESC`)
      .all(personaId)
      .map(map);
  },
  upsert(input: UserIdentityInput): UserIdentity {
    const existing = this.find(input.personaId, input.userId);
    const next = {
      nickname: input.nickname ?? existing?.nickname ?? "",
      realName: input.realName ?? existing?.realName ?? "",
      relationship: input.relationship ?? existing?.relationship ?? "",
      addressPreference: input.addressPreference ?? existing?.addressPreference ?? "",
      boundaries: input.boundaries ?? existing?.boundaries ?? "",
    };
    this.db()
      .prepare(
        `INSERT INTO user_identities (persona_id, user_id, nickname, real_name, relationship, address_preference, boundaries, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(persona_id, user_id) DO UPDATE SET
           nickname = excluded.nickname,
           real_name = excluded.real_name,
           relationship = excluded.relationship,
           address_preference = excluded.address_preference,
           boundaries = excluded.boundaries,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.personaId,
        input.userId,
        next.nickname,
        next.realName,
        next.relationship,
        next.addressPreference,
        next.boundaries,
        now(),
      );
    return this.find(input.personaId, input.userId)!;
  },
  remove(personaId: string, userId: string): void {
    this.db().prepare(`DELETE FROM user_identities WHERE persona_id = ? AND user_id = ?`).run(personaId, userId);
  },
};
