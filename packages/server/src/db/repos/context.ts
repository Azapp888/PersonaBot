import type Database from "better-sqlite3";
import { getDb } from "../index";
import { now } from "../../utils/id";
import { safeJsonParse, toJson } from "../../utils/json";
import { emptyState, type ConversationState } from "../../context/state";

export interface ConversationContext {
  personaId: string;
  userId: string;
  summary: string;
  summarizedUpto: number;
  state: ConversationState;
  updatedAt: number;
}

function map(row: any): ConversationContext {
  return {
    personaId: row.persona_id,
    userId: row.user_id,
    summary: row.summary ?? "",
    summarizedUpto: row.summarized_upto ?? 0,
    state: { ...emptyState(), ...safeJsonParse<Partial<ConversationState>>(row.state, {}) },
    updatedAt: row.updated_at,
  };
}

export interface ContextInput {
  personaId: string;
  userId: string;
  summary: string;
  summarizedUpto: number;
  state: ConversationState;
}

export const contextRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, userId: string): ConversationContext | null {
    const row = this.db()
      .prepare(`SELECT * FROM conversation_context WHERE persona_id = ? AND user_id = ?`)
      .get(personaId, userId);
    return row ? map(row) : null;
  },
  upsert(input: ContextInput): ConversationContext {
    const existing = this.find(input.personaId, input.userId);
    if (existing) {
      this.db()
        .prepare(
          `UPDATE conversation_context SET summary = ?, summarized_upto = ?, state = ?, updated_at = ? WHERE persona_id = ? AND user_id = ?`,
        )
        .run(input.summary, input.summarizedUpto, toJson(input.state), now(), input.personaId, input.userId);
    } else {
      this.db()
        .prepare(
          `INSERT INTO conversation_context (persona_id, user_id, summary, summarized_upto, state, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.personaId, input.userId, input.summary, input.summarizedUpto, toJson(input.state), now());
    }
    return this.find(input.personaId, input.userId)!;
  },
  saveState(personaId: string, userId: string, state: ConversationState): void {
    const existing = this.find(personaId, userId);
    if (existing) {
      this.db()
        .prepare(`UPDATE conversation_context SET state = ?, updated_at = ? WHERE persona_id = ? AND user_id = ?`)
        .run(toJson(state), now(), personaId, userId);
    } else {
      this.db()
        .prepare(
          `INSERT INTO conversation_context (persona_id, user_id, summary, summarized_upto, state, updated_at) VALUES (?, ?, '', 0, ?, ?)`,
        )
        .run(personaId, userId, toJson(state), now());
    }
  },
  remove(personaId: string, userId: string): void {
    this.db().prepare(`DELETE FROM conversation_context WHERE persona_id = ? AND user_id = ?`).run(personaId, userId);
  },
};
