import type Database from "better-sqlite3";
import { getDb } from "../index";
import { newId, now } from "../../utils/id";
import { encryptSecret } from "../../utils/crypto";
import type { SearchProvider, SearchVendor } from "../../types";

function map(row: any): SearchProvider {
  return {
    id: row.id,
    vendor: row.vendor,
    apiBase: row.api_base ?? null,
    model: row.model ?? null,
    apiKey: row.api_key ?? null,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface SearchProviderInput {
  vendor: SearchVendor;
  apiBase?: string | null;
  model?: string | null;
  apiKey?: string | null;
  enabled?: boolean;
}

export const searchProviderRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): SearchProvider[] {
    return this.db().prepare(`SELECT * FROM search_providers ORDER BY created_at ASC`).all().map(map);
  },
  listEnabled(): SearchProvider[] {
    return this.db().prepare(`SELECT * FROM search_providers WHERE enabled = 1 ORDER BY created_at ASC`).all().map(map);
  },
  find(id: string): SearchProvider | null {
    const row = this.db().prepare(`SELECT * FROM search_providers WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  findByVendor(vendor: SearchVendor): SearchProvider | null {
    const row = this.db().prepare(`SELECT * FROM search_providers WHERE vendor = ?`).get(vendor);
    return row ? map(row) : null;
  },
  create(input: SearchProviderInput): SearchProvider {
    const id = newId("srch_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO search_providers (id, vendor, api_base, model, api_key, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.vendor,
        input.apiBase ?? null,
        input.model ?? null,
        input.apiKey ? encryptSecret(input.apiKey) : null,
        input.enabled === false ? 0 : 1,
        ts,
        ts,
      );
    return this.find(id)!;
  },
  update(id: string, input: Partial<SearchProviderInput>): SearchProvider | null {
    const current = this.find(id);
    if (!current) return null;
    const nextKey =
      input.apiKey !== undefined && input.apiKey !== null && input.apiKey !== ""
        ? encryptSecret(input.apiKey)
        : current.apiKey;
    this.db()
      .prepare(
        `UPDATE search_providers SET api_base = ?, model = ?, api_key = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        input.apiBase !== undefined ? input.apiBase : current.apiBase,
        input.model !== undefined ? input.model : current.model,
        nextKey,
        input.enabled !== undefined ? (input.enabled ? 1 : 0) : current.enabled ? 1 : 0,
        now(),
        id,
      );
    return this.find(id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM search_providers WHERE id = ?`).run(id);
  },
};
