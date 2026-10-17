import type Database from "better-sqlite3";
import { getDb } from "../index";
import { newId, now } from "../../utils/id";
import { encryptSecret } from "../../utils/crypto";

/**
 * 提供商级配置：把「名称 / API Base / API Key」从单个模型上抽出来独立存储。
 *
 * 这样即使一个提供商下暂时没有任何模型，也能作为一条记录存在并展示，
 * 满足「先建提供商、再加模型」的使用路径。模型表仍然保存自身快照，
 * 创建模型时从提供商配置继承。
 */
export interface ProviderRecord {
  id: string;
  name: string;
  apiBase: string | null;
  apiKey: string | null;
  createdAt: number;
  updatedAt: number;
}

function map(row: any): ProviderRecord {
  return {
    id: row.id,
    name: row.name,
    apiBase: row.api_base,
    apiKey: row.api_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProviderInput {
  name: string;
  apiBase?: string | null;
  apiKey?: string | null;
}

export const providerRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): ProviderRecord[] {
    return this.db().prepare(`SELECT * FROM providers ORDER BY created_at DESC`).all().map(map);
  },
  find(id: string): ProviderRecord | null {
    const row = this.db().prepare(`SELECT * FROM providers WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  /** 按「提供商名称」查找最新一条配置。 */
  findByName(name: string): ProviderRecord | null {
    const row = this.db()
      .prepare(`SELECT * FROM providers WHERE name = ? ORDER BY created_at DESC`)
      .get(name);
    return row ? map(row) : null;
  },
  create(input: ProviderInput): ProviderRecord {
    const id = newId("prv_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO providers (id, name, api_base, api_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.apiBase ?? null,
        input.apiKey ? encryptSecret(input.apiKey) : null,
        ts,
        ts,
      );
    return this.find(id)!;
  },
  update(id: string, input: Partial<ProviderInput>): ProviderRecord | null {
    const current = this.find(id);
    if (!current) return null;
    const nextKey =
      input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== ""
        ? encryptSecret(input.apiKey)
        : current.apiKey;
    this.db()
      .prepare(`UPDATE providers SET name = ?, api_base = ?, api_key = ?, updated_at = ? WHERE id = ?`)
      .run(
        input.name ?? current.name,
        input.apiBase !== undefined ? input.apiBase : current.apiBase,
        nextKey,
        now(),
        id,
      );
    return this.find(id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  },
};
