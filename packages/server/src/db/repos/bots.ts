import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Bot } from "../../types";
import { newId, now } from "../../utils/id";
import { decryptSecret, encryptSecret } from "../../utils/crypto";

function map(row: any): Bot {
  return {
    id: row.id,
    name: row.name,
    appId: row.app_id,
    clientSecret: row.client_secret,
    accessToken: row.access_token,
    tokenExpiresAt: row.token_expires_at,
    personaId: row.persona_id,
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface BotInput {
  name: string;
  appId: string;
  clientSecret: string;
  personaId?: string | null;
  enabled?: boolean;
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
        `INSERT INTO bots (id, name, app_id, client_secret, persona_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.appId,
        encryptSecret(input.clientSecret),
        input.personaId ?? null,
        input.enabled === false ? 0 : 1,
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
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
    };
    this.db()
      .prepare(
        `UPDATE bots SET name = ?, app_id = ?, client_secret = ?, persona_id = ?, enabled = ?, updated_at = ? WHERE id = ?`,
      )
      .run(next.name, next.appId, next.clientSecret, next.personaId, next.enabled ? 1 : 0, now(), id);
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
