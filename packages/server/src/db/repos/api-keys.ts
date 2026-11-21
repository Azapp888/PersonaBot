import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { ApiKey } from "../../types";
import { newId, now } from "../../utils/id";
import { generateToken, sha256Hex } from "../../utils/crypto";

function map(row: any): ApiKey {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    personaId: row.persona_id,
    userId: row.user_id,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at ?? null,
    usageCount: row.usage_count ?? 0,
  };
}

export interface ApiKeyInput {
  name: string;
  personaId: string;
  userId: string;
  enabled?: boolean;
}

/** 创建密钥时返回的明文只在这一次响应中出现，之后只保存 sha256 散列。 */
export interface ApiKeyCreated {
  key: ApiKey;
  plaintext: string;
}

/**
 * 开放 API 密钥表。
 *
 * 每条密钥绑定一个角色（personaId）与一个用户（userId=app_users.external_id），
 * 外部应用凭密钥调用 /api/v1/*，服务端据此决定用哪个角色、以谁的身份对话。
 */
export const apiKeyRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): ApiKey[] {
    return this.db().prepare(`SELECT * FROM api_keys ORDER BY created_at DESC`).all().map(map);
  },
  find(id: string): ApiKey | null {
    const row = this.db().prepare(`SELECT * FROM api_keys WHERE id = ?`).get(id) as any;
    return row ? map(row) : null;
  },
  findByHash(hash: string): ApiKey | null {
    const row = this.db().prepare(`SELECT * FROM api_keys WHERE key_hash = ?`).get(hash) as any;
    return row ? map(row) : null;
  },
  create(input: ApiKeyInput): ApiKeyCreated {
    const id = newId("key_");
    const plaintext = generateToken("pb_");
    const keyPrefix = plaintext.slice(0, 8);
    this.db()
      .prepare(
        `INSERT INTO api_keys (id, name, key_prefix, key_hash, persona_id, user_id, enabled, created_at, last_used_at, usage_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
      )
      .run(
        id,
        input.name,
        keyPrefix,
        sha256Hex(plaintext),
        input.personaId,
        input.userId,
        input.enabled === false ? 0 : 1,
        now(),
      );
    return { key: this.find(id)!, plaintext };
  },
  update(id: string, patch: { name?: string; personaId?: string; userId?: string; enabled?: boolean }): ApiKey | null {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      values.push(patch.name);
    }
    if (patch.personaId !== undefined) {
      sets.push("persona_id = ?");
      values.push(patch.personaId);
    }
    if (patch.userId !== undefined) {
      sets.push("user_id = ?");
      values.push(patch.userId);
    }
    if (patch.enabled !== undefined) {
      sets.push("enabled = ?");
      values.push(patch.enabled ? 1 : 0);
    }
    if (!sets.length) return this.find(id);
    values.push(id);
    this.db().prepare(`UPDATE api_keys SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.find(id);
  },
  /** 记录一次成功调用（用于列表展示最近使用时间与调用次数）。 */
  touch(id: string): void {
    this.db()
      .prepare(`UPDATE api_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?`)
      .run(now(), id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
  },
};
