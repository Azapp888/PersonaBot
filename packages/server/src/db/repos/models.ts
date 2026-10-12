import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { ModelRecord, ModelProvider } from "../../types";
import { newId, now } from "../../utils/id";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

function map(row: any): ModelRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    apiKey: row.api_key,
    apiBase: row.api_base,
    modelId: row.model_id,
    temperature: row.temperature,
    maxTokens: row.max_tokens,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ModelInput {
  name: string;
  provider: ModelProvider;
  apiKey?: string | null;
  apiBase?: string | null;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  enabled?: boolean;
}

export const modelRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): ModelRecord[] {
    return this.db().prepare(`SELECT * FROM models ORDER BY created_at DESC`).all().map(map);
  },
  listEnabled(): ModelRecord[] {
    return this.db().prepare(`SELECT * FROM models WHERE enabled = 1`).all().map(map);
  },
  find(id: string): ModelRecord | null {
    const row = this.db().prepare(`SELECT * FROM models WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  create(input: ModelInput): ModelRecord {
    const id = newId("mdl_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO models (id, name, provider, api_key, api_base, model_id, temperature, max_tokens, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.provider,
        input.apiKey ? encryptSecret(input.apiKey) : null,
        input.apiBase ?? null,
        input.modelId,
        input.temperature ?? 0.8,
        input.maxTokens ?? 2048,
        input.enabled === false ? 0 : 1,
        ts,
        ts,
      );
    return this.find(id)!;
  },
  update(id: string, input: Partial<ModelInput>): ModelRecord | null {
    const current = this.find(id);
    if (!current) return null;
    const nextKey =
      input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== current.apiKey
        ? encryptSecret(input.apiKey)
        : current.apiKey;
    this.db()
      .prepare(
        `UPDATE models SET name = ?, provider = ?, api_key = ?, api_base = ?, model_id = ?, temperature = ?, max_tokens = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.name ?? current.name,
        input.provider ?? current.provider,
        nextKey,
        input.apiBase !== undefined ? input.apiBase : current.apiBase,
        input.modelId ?? current.modelId,
        input.temperature ?? current.temperature,
        input.maxTokens ?? current.maxTokens,
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled ? 1 : 0,
        now(),
        id,
      );
    return this.find(id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM models WHERE id = ?`).run(id);
  },
  decryptedKey(model: ModelRecord): string {
    return decryptSecret(model.apiKey ?? "");
  },
  /** 同一提供商下已存储的第一个可用密钥（明文），用于新模型复用。 */
  findProviderKey(provider: string): string | null {
    const rows = this.db()
      .prepare(`SELECT * FROM models WHERE provider = ? AND api_key IS NOT NULL AND api_key != '' ORDER BY created_at DESC`)
      .all(provider) as any[];
    for (const row of rows) {
      const key = decryptSecret(row.api_key ?? "");
      if (key) return key;
    }
    return null;
  },
  /** 同一提供商下已存储的 API Base，用于新模型复用。 */
  findProviderApiBase(provider: string): string | null {
    const row = this.db()
      .prepare(`SELECT api_base FROM models WHERE provider = ? AND api_base IS NOT NULL AND api_base != '' ORDER BY created_at DESC`)
      .get(provider) as any;
    return row ? (row.api_base as string) : null;
  },
};
