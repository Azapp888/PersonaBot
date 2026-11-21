import type Database from "better-sqlite3";
import { getDb } from "../index";
import type { Memory, MemoryKind, MemoryType } from "../../types";
import { newId, now } from "../../utils/id";

const KINDS: MemoryKind[] = ["agreement", "preference", "fact", "event", "trivial"];

function toKind(value: unknown): MemoryKind {
  return KINDS.includes(value as MemoryKind) ? (value as MemoryKind) : "event";
}

function map(row: any): Memory {
  return {
    id: row.id,
    personaId: row.persona_id,
    userId: row.user_id,
    type: row.type,
    content: row.content,
    sourceDate: row.source_date,
    importance: row.importance ?? 5,
    pinned: !!row.pinned,
    kind: toKind(row.kind),
    origin: row.origin === "realtime" ? "realtime" : "daily",
    consolidatedInto: row.consolidated_into ?? null,
    createdAt: row.created_at,
  };
}

export interface MemoryInput {
  personaId: string;
  userId: string;
  type: MemoryType;
  content: string;
  sourceDate: string;
  importance?: number;
  pinned?: boolean;
  kind?: MemoryKind;
  origin?: "daily" | "realtime";
  consolidatedInto?: string | null;
}

export interface MemoryMetaPatch {
  content?: string;
  importance?: number;
  pinned?: boolean;
  kind?: MemoryKind;
}

export interface MemoryTimelineQuery {
  personaId: string;
  userId?: string;
  types?: MemoryType[];
  kinds?: MemoryKind[];
  origins?: ("daily" | "realtime")[];
  /** 重要性下限（含）。 */
  minImportance?: number;
  pinnedOnly?: boolean;
  /** 只返回 source_date >= since 的记录（YYYY-MM-DD）。 */
  since?: string;
  limit?: number;
}

export interface MemoryTimelineDay {
  date: string;
  total: number;
  facts: number;
  pinned: number;
  avgImportance: number;
  byType: Record<string, number>;
  entries: Memory[];
}

export interface MemoryTimeline {
  total: number;
  days: MemoryTimelineDay[];
}

export const memoryRepo = {
  db(): Database.Database {
    return getDb();
  },
  listByPersona(personaId: string): Memory[] {
    return this.db()
      .prepare(`SELECT * FROM memories WHERE persona_id = ? ORDER BY created_at DESC`)
      .all(personaId)
      .map(map);
  },
  listByUser(personaId: string, userId: string): Memory[] {
    return this.db()
      .prepare(`SELECT * FROM memories WHERE persona_id = ? AND user_id = ? ORDER BY created_at DESC`)
      .all(personaId, userId)
      .map(map);
  },
  latest(personaId: string, userId: string, type: MemoryType): Memory | null {
    const row = this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(personaId, userId, type);
    return row ? map(row) : null;
  },
  listByTypeSince(personaId: string, userId: string, type: MemoryType, since: number): Memory[] {
    return this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND created_at >= ? ORDER BY created_at ASC`,
      )
      .all(personaId, userId, type, since)
      .map(map);
  },
  /**
   * 核心记忆：受保护（pinned）或高重要性的原子事实，按重要性从高到低返回，最多 max 条。
   * 这些内容会被独立注入 System Prompt，不受「手动编辑冻结文件」影响。
   */
  listCore(personaId: string, userId: string, minImportance = 8, max = 40): Memory[] {
    return this.db()
      .prepare(
        `SELECT * FROM memories
         WHERE persona_id = ? AND user_id = ? AND type = 'fact' AND (pinned = 1 OR importance >= ?)
         ORDER BY pinned DESC, importance DESC, created_at DESC
         LIMIT ?`,
      )
      .all(personaId, userId, minImportance, max)
      .map(map);
  },
  /** 该 sourceDate 下已有的原子事实（用于重算前清理）。 */
  listFactsByDate(personaId: string, userId: string, sourceDate: string): Memory[] {
    return this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = 'fact' AND source_date = ? ORDER BY importance DESC`,
      )
      .all(personaId, userId, sourceDate)
      .map(map);
  },
  upsert(input: MemoryInput): Memory {
    // 原子事实（fact）允许同日多条，不能按 (persona,user,type,source_date) 合并覆盖
    if (input.type === "fact") return this.create(input);
    const existing = this.db()
      .prepare(
        `SELECT * FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND source_date = ?`,
      )
      .get(input.personaId, input.userId, input.type, input.sourceDate) as any;
    if (existing) {
      this.db()
        .prepare(`UPDATE memories SET content = ?, created_at = ? WHERE id = ?`)
        .run(input.content, now(), existing.id);
      return map(this.db().prepare(`SELECT * FROM memories WHERE id = ?`).get(existing.id));
    }
    return this.create(input);
  },
  create(input: MemoryInput): Memory {
    const id = newId("mem_");
    this.db()
      .prepare(
        `INSERT INTO memories (id, persona_id, user_id, type, content, source_date, importance, pinned, kind, origin, consolidated_into, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.personaId,
        input.userId,
        input.type,
        input.content,
        input.sourceDate,
        input.importance ?? 5,
        input.pinned ? 1 : 0,
        toKind(input.kind),
        input.origin === "realtime" ? "realtime" : "daily",
        input.consolidatedInto ?? null,
        now(),
      );
    return map(this.db().prepare(`SELECT * FROM memories WHERE id = ?`).get(id));
  },
  updateContent(id: string, content: string): void {
    this.db().prepare(`UPDATE memories SET content = ? WHERE id = ?`).run(content, id);
  },
  find(id: string): Memory | null {
    const row = this.db().prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as any;
    return row ? map(row) : null;
  },
  updateMeta(id: string, patch: MemoryMetaPatch): void {
    const sets: string[] = [];
    const values: any[] = [];
    if (patch.content !== undefined) {
      sets.push("content = ?");
      values.push(patch.content);
    }
    if (patch.importance !== undefined) {
      sets.push("importance = ?");
      values.push(Math.max(1, Math.min(10, Math.round(patch.importance))));
    }
    if (patch.pinned !== undefined) {
      sets.push("pinned = ?");
      values.push(patch.pinned ? 1 : 0);
    }
    if (patch.kind !== undefined) {
      sets.push("kind = ?");
      values.push(toKind(patch.kind));
    }
    if (!sets.length) return;
    values.push(id);
    this.db().prepare(`UPDATE memories SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  },
  remove(id: string): void {
    this.db().prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  },
  /** 删除某类型在某 sourceDate 的记录（用于重算原子事实）。可指定 origin 只删每日整理的。 */
  removeByTypeDate(personaId: string, userId: string, type: MemoryType, sourceDate: string, origin?: "daily" | "realtime"): void {
    if (origin) {
      this.db()
        .prepare(`DELETE FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND source_date = ? AND origin = ?`)
        .run(personaId, userId, type, sourceDate, origin);
      return;
    }
    this.db()
      .prepare(`DELETE FROM memories WHERE persona_id = ? AND user_id = ? AND type = ? AND source_date = ?`)
      .run(personaId, userId, type, sourceDate);
  },
  /** 删除某一天生成的所有记忆（日记忆与原子事实），用于清理被污染的历史。 */
  removeByDate(personaId: string, userId: string, sourceDate: string): number {
    const info = this.db()
      .prepare(`DELETE FROM memories WHERE persona_id = ? AND user_id = ? AND source_date = ?`)
      .run(personaId, userId, sourceDate);
    return info.changes;
  },
  /**
   * 剪枝已浓缩进上层记忆的日记忆：删除 source_date 早于 cutoffDate 的 daily。
   * 原子事实（type=fact）不受影响，重要内容靠 fact 层长期保留。
   */
  removeDailyBefore(personaId: string, userId: string, cutoffDate: string): number {
    const info = this.db()
      .prepare(`DELETE FROM memories WHERE persona_id = ? AND user_id = ? AND type = 'daily' AND source_date < ?`)
      .run(personaId, userId, cutoffDate);
    return info.changes;
  },
  distinctUsers(personaId: string): string[] {
    return this.db()
      .prepare(`SELECT DISTINCT user_id FROM memories WHERE persona_id = ?`)
      .all(personaId)
      .map((r: any) => r.user_id as string);
  },
  /**
   * 记忆时间线：按条件筛选后按 source_date 倒序分组，供后台「时间线」视图与人工修正使用。
   * 每条记录保留完整字段（含 origin / kind / importance / pinned），编辑走 updateMeta。
   */
  timeline(query: MemoryTimelineQuery): MemoryTimeline {
    const where: string[] = ["persona_id = ?"];
    const params: any[] = [query.personaId];
    if (query.userId) {
      where.push("user_id = ?");
      params.push(query.userId);
    }
    if (query.types?.length) {
      where.push(`type IN (${query.types.map(() => "?").join(", ")})`);
      params.push(...query.types);
    }
    if (query.kinds?.length) {
      where.push(`kind IN (${query.kinds.map(() => "?").join(", ")})`);
      params.push(...query.kinds);
    }
    if (query.origins?.length) {
      where.push(`origin IN (${query.origins.map(() => "?").join(", ")})`);
      params.push(...query.origins);
    }
    if (typeof query.minImportance === "number" && Number.isFinite(query.minImportance)) {
      where.push("importance >= ?");
      params.push(Math.max(1, Math.min(10, Math.round(query.minImportance))));
    }
    if (query.pinnedOnly) where.push("pinned = 1");
    if (query.since) {
      where.push("source_date >= ?");
      params.push(query.since);
    }
    const limit = Math.max(1, Math.min(2000, Math.round(query.limit ?? 1000)));

    const rows = this.db()
      .prepare(
        `SELECT * FROM memories WHERE ${where.join(" AND ")}
         ORDER BY source_date DESC, importance DESC, created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit)
      .map(map);

    const days = new Map<string, MemoryTimelineDay>();
    for (const memory of rows) {
      let day = days.get(memory.sourceDate);
      if (!day) {
        day = { date: memory.sourceDate, total: 0, facts: 0, pinned: 0, avgImportance: 0, byType: {}, entries: [] };
        days.set(memory.sourceDate, day);
      }
      day.total += 1;
      if (memory.type === "fact") day.facts += 1;
      if (memory.pinned) day.pinned += 1;
      day.byType[memory.type] = (day.byType[memory.type] ?? 0) + 1;
      day.avgImportance += memory.importance;
      day.entries.push(memory);
    }
    const grouped = [...days.values()].map((day) => ({
      ...day,
      avgImportance: day.total ? Number((day.avgImportance / day.total).toFixed(1)) : 0,
    }));
    return { total: rows.length, days: grouped };
  },
};
