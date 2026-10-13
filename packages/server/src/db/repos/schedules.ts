import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { PersonaSchedule, ScheduleSegment } from "../../types";
import { safeJsonParse, toJson } from "../../utils/json";

function map(row: any): PersonaSchedule {
  return {
    personaId: row.persona_id,
    date: row.date,
    segments: safeJsonParse<ScheduleSegment[]>(row.segments, []),
    createdAt: row.created_at,
  };
}

export const scheduleRepo = {
  db(): Database.Database {
    return getDb();
  },
  find(personaId: string, date: string): PersonaSchedule | null {
    const row = this.db()
      .prepare(`SELECT * FROM persona_schedules WHERE persona_id = ? AND date = ?`)
      .get(personaId, date);
    return row ? map(row) : null;
  },
  upsert(personaId: string, date: string, segments: ScheduleSegment[]): PersonaSchedule {
    this.db()
      .prepare(
        `INSERT INTO persona_schedules (persona_id, date, segments, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(persona_id, date) DO UPDATE SET segments = excluded.segments, created_at = excluded.created_at`,
      )
      .run(personaId, date, toJson(segments), Date.now());
    return this.find(personaId, date)!;
  },
  /** 删除早于 cutoffDate（YYYY-MM-DD）的日程，避免无限增长。 */
  removeBefore(personaId: string, cutoffDate: string): number {
    const info = this.db()
      .prepare(`DELETE FROM persona_schedules WHERE persona_id = ? AND date < ?`)
      .run(personaId, cutoffDate);
    return info.changes;
  },
};
