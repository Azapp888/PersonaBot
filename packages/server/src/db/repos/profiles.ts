import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { UserHabits, UserProfile } from "../../types";
import { newId } from "../../utils/id";
import { safeJsonParse, toJson } from "../../utils/json";

const emptyHabits: UserHabits = {
  activeHours: [],
  expressions: [],
  interests: [],
  emotionTriggers: [],
  summary: "",
};

function map(row: any): UserProfile {
  return {
    id: row.id,
    userId: row.user_id,
    personaId: row.persona_id,
    habits: safeJsonParse<UserHabits>(row.habits, emptyHabits),
    lastInteractionAt: row.last_interaction_at,
    lastProactiveAt: row.last_proactive_at,
    lastDailyAt: row.last_daily_at ?? null,
    dailyCount: row.daily_count ?? 0,
    dailyCountDate: row.daily_count_date ?? null,
  };
}

export const profileRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, userId: string): UserProfile | null {
    const row = this.db()
      .prepare(`SELECT * FROM user_profiles WHERE persona_id = ? AND user_id = ?`)
      .get(personaId, userId);
    return row ? map(row) : null;
  },
  ensure(personaId: string, userId: string): UserProfile {
    const existing = this.find(personaId, userId);
    if (existing) return existing;
    const id = newId("usr_");
    this.db()
      .prepare(
        `INSERT INTO user_profiles (id, user_id, persona_id, habits, last_interaction_at, last_proactive_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, personaId, toJson(emptyHabits), null, null);
    return this.find(personaId, userId)!;
  },
  listByPersona(personaId: string): UserProfile[] {
    return this.db().prepare(`SELECT * FROM user_profiles WHERE persona_id = ?`).all(personaId).map(map);
  },
  updateHabits(personaId: string, userId: string, habits: Partial<UserHabits>): UserProfile {
    const profile = this.ensure(personaId, userId);
    const merged = { ...profile.habits, ...habits };
    this.db()
      .prepare(`UPDATE user_profiles SET habits = ? WHERE id = ?`)
      .run(toJson(merged), profile.id);
    return { ...profile, habits: merged };
  },
  touchInteraction(personaId: string, userId: string, ts = Date.now()): void {
    const profile = this.ensure(personaId, userId);
    this.db().prepare(`UPDATE user_profiles SET last_interaction_at = ? WHERE id = ?`).run(ts, profile.id);
  },
  touchProactive(personaId: string, userId: string, ts = Date.now()): void {
    const profile = this.ensure(personaId, userId);
    this.db().prepare(`UPDATE user_profiles SET last_proactive_at = ? WHERE id = ?`).run(ts, profile.id);
  },
  touchDaily(personaId: string, userId: string, ts = Date.now()): void {
    const profile = this.ensure(personaId, userId);
    this.db().prepare(`UPDATE user_profiles SET last_daily_at = ? WHERE id = ?`).run(ts, profile.id);
  },
  /**
   * 记录一次每日问候发送：跨天自动把计数归零后再 +1，并返回新的当日计数。
   */
  recordDailySend(personaId: string, userId: string, date: string, ts = Date.now()): number {
    const profile = this.ensure(personaId, userId);
    const next = profile.dailyCountDate === date ? profile.dailyCount + 1 : 1;
    this.db()
      .prepare(`UPDATE user_profiles SET last_daily_at = ?, daily_count = ?, daily_count_date = ? WHERE id = ?`)
      .run(ts, next, date, profile.id);
    return next;
  },
};
