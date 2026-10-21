import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Bot } from "../../types";
import { newId, now } from "../../utils/id";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

const PROACTIVE_MAX_LIMIT = 10;

/** 主动消息条数收敛到 1..10，避免误填 0 或过大值。 */
function clampProactiveMax(value: number | undefined): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 3;
  return Math.min(PROACTIVE_MAX_LIMIT, Math.max(1, n));
}

function map(row: any): Bot {
  return {
    id: row.id,
    name: row.name,
    appId: row.app_id,
    clientSecret: row.client_secret,
    accessToken: row.access_token,
    tokenExpiresAt: row.token_expires_at,
    personaId: row.persona_id,
    modelId: row.model_id ?? null,
    enabled: !!row.enabled,
    agentEnabled: !!row.agent_enabled,
    proactiveEnabled: !!row.proactive_enabled,
    proactiveMaxMessages: row.proactive_max_messages ?? 3,
    searchEnabled: !!row.search_enabled,
    searchProviderId: row.search_provider_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BotInput {
  name: string;
  appId: string;
  clientSecret: string;
  personaId?: string | null;
  modelId?: string | null;
  enabled?: boolean;
  agentEnabled?: boolean;
  proactiveEnabled?: boolean;
  proactiveMaxMessages?: number;
  searchEnabled?: boolean;
  searchProviderId?: string | null;
}

export const botRepo = {
  db(): Database.Database {
    return getDb();
  },
  list(): Bot[] {
    return this.db().prepare(`SELECT * FROM bots ORDER BY created_at DESC`).all().map(map);
  },
  listEnabled(): Bot[] {
    return this.db().prepare(`SELECT * FROM bots WHERE enabled = 1 ORDER BY created_at DESC`).all().map(map);
  },
  find(id: string): Bot | null {
    const row = this.db().prepare(`SELECT * FROM bots WHERE id = ?`).get(id);
    return row ? map(row) : null;
  },
  findByAppId(appId: string): Bot | null {
    const row = this.db().prepare(`SELECT * FROM bots WHERE app_id = ?`).get(appId);
    return row ? map(row) : null;
  },
  create(input: BotInput): Bot {
    const id = newId("bot_");
    const ts = now();
    this.db()
      .prepare(
        `INSERT INTO bots (id, name, app_id, client_secret, persona_id, model_id, enabled, agent_enabled, proactive_enabled, proactive_max_messages, search_enabled, search_provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.appId,
        encryptSecret(input.clientSecret),
        input.personaId ?? null,
        input.modelId ?? null,
        input.enabled === false ? 0 : 1,
        input.agentEnabled ? 1 : 0,
        input.proactiveEnabled ? 1 : 0,
        clampProactiveMax(input.proactiveMaxMessages),
        input.searchEnabled ? 1 : 0,
        input.searchProviderId ?? null,
        ts,
        ts,
      );
    return this.find(id)!;
  },
  update(id: string, input: Partial<BotInput>): Bot | null {
    const current = this.find(id);
    if (!current) return null;
    const next = {
      name: input.name ?? current.name,
      appId: input.appId ?? current.appId,
      clientSecret:
        input.clientSecret && input.clientSecret !== current.clientSecret
          ? encryptSecret(input.clientSecret)
          : current.clientSecret,
      personaId: input.personaId !== undefined ? input.personaId : current.personaId,
      modelId: input.modelId !== undefined ? input.modelId : current.modelId,
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
      agentEnabled: input.agentEnabled !== undefined ? input.agentEnabled : current.agentEnabled,
      proactiveEnabled: input.proactiveEnabled !== undefined ? input.proactiveEnabled : current.proactiveEnabled,
      proactiveMaxMessages:
        input.proactiveMaxMessages !== undefined ? clampProactiveMax(input.proactiveMaxMessages) : current.proactiveMaxMessages,
      searchEnabled: input.searchEnabled !== undefined ? input.searchEnabled : current.searchEnabled,
      searchProviderId: input.searchProviderId !== undefined ? input.searchProviderId : current.searchProviderId,
    };
    this.db()
      .prepare(
        `UPDATE bots SET name = ?, app_id = ?, client_secret = ?, persona_id = ?, model_id = ?, enabled = ?, agent_enabled = ?, proactive_enabled = ?, proactive_max_messages = ?, search_enabled = ?, search_provider_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        next.name,
        next.appId,
        next.clientSecret,
        next.personaId,
        next.modelId,
        next.enabled ? 1 : 0,
        next.agentEnabled ? 1 : 0,
        next.proactiveEnabled ? 1 : 0,
        next.proactiveMaxMessages,
        next.searchEnabled ? 1 : 0,
        next.searchProviderId,
        now(),
        id,
      );
    return this.find(id);
  },
  updateToken(id: string, accessToken: string, expiresAt: number): void {
    this.db()
      .prepare(`UPDATE bots SET access_token = ?, token_expires_at = ?, updated_at = ? WHERE id = ?`)
      .run(accessToken, expiresAt, now(), id);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM bots WHERE id = ?`).run(id);
  },
  decryptedSecret(bot: Bot): string {
    return decryptSecret(bot.clientSecret);
  },
};
