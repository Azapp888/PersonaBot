import type Database from "better-sqlite3";
import { getDb } from "../index";
import { newId } from "../../utils/id";

/**
 * 运行/事件日志：记录 pipeline 与模型请求的关键事实，便于事后排查。
 *
 * 与 message_logs（面向用户可见的对话内容）分开：
 * - message_logs 关注「说了什么」；
 * - system_logs 关注「系统做了什么、耗时多久、为什么失败」。
 *
 * 级别：debug | info | warn | error
 * 类别：model（模型请求/响应）| pipeline（流程节点）| error（异常）| vision | memory | bot | system
 */
export type SystemLogLevel = "debug" | "info" | "warn" | "error";
export type SystemLogCategory =
  | "model"
  | "pipeline"
  | "error"
  | "vision"
  | "memory"
  | "bot"
  | "memory_file"
  | "proactive"
  | "system";

export interface SystemLogEntry {
  level: SystemLogLevel;
  category: SystemLogCategory;
  personaId?: string | null;
  botId?: string | null;
  userId?: string | null;
  modelId?: string | null;
  provider?: string | null;
  /** 阶段标识，例如 request / response / guardrail / discover / scan。 */
  stage?: string | null;
  message: string;
  /** 结构化细节（已是字符串；调用方传对象时由 repo 序列化）。 */
  detail?: unknown;
  durationMs?: number | null;
}

export interface SystemLogFilter {
  personaId?: string | null;
  userId?: string | null;
  level?: SystemLogLevel | null;
  category?: SystemLogCategory | null;
  modelId?: string | null;
  /** 关键字（模糊匹配 message/detail） */
  q?: string | null;
  since?: number | null;
  until?: number | null;
}

const MAX_DETAIL = 20000;

function serializeDetail(detail: unknown): string | null {
  if (detail == null) return null;
  let text: string;
  if (typeof detail === "string") text = detail;
  else {
    try {
      text = JSON.stringify(detail, null, 2);
    } catch {
      text = String(detail);
    }
  }
  if (text.length > MAX_DETAIL) text = `${text.slice(0, MAX_DETAIL)}\n…（已截断，原始长度 ${text.length} 字符）`;
  return text;
}

function buildSystemWhere(filter: SystemLogFilter): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (filter.personaId) {
    conds.push("persona_id = ?");
    params.push(filter.personaId);
  }
  if (filter.userId) {
    conds.push("user_id = ?");
    params.push(filter.userId);
  }
  if (filter.level) {
    conds.push("level = ?");
    params.push(filter.level);
  }
  if (filter.category) {
    conds.push("category = ?");
    params.push(filter.category);
  }
  if (filter.modelId) {
    conds.push("model_id = ?");
    params.push(filter.modelId);
  }
  if (filter.q) {
    conds.push("(message LIKE ? OR detail LIKE ?)");
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.since != null) {
    conds.push("created_at >= ?");
    params.push(filter.since);
  }
  if (filter.until != null) {
    conds.push("created_at < ?");
    params.push(filter.until);
  }
  return { clause: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
}

export const systemLogRepo = {
  db(): Database.Database {
    return getDb();
  },
  write(entry: SystemLogEntry): void {
    try {
      this.db()
        .prepare(
          `INSERT INTO system_logs (id, level, category, persona_id, bot_id, user_id, model_id, provider, stage, message, detail, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId("slog_"),
          entry.level,
          entry.category,
          entry.personaId ?? null,
          entry.botId ?? null,
          entry.userId ?? null,
          entry.modelId ?? null,
          entry.provider ?? null,
          entry.stage ?? null,
          entry.message,
          serializeDetail(entry.detail),
          entry.durationMs ?? null,
          Date.now(),
        );
    } catch {
      // 日志写入失败绝不能影响主流程
    }
  },
  list(filter: SystemLogFilter, limit: number, offset: number): any[] {
    const { clause, params } = buildSystemWhere(filter);
    return this.db()
      .prepare(`SELECT * FROM system_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
  },
  count(filter: SystemLogFilter): number {
    const { clause, params } = buildSystemWhere(filter);
    const row = this.db().prepare(`SELECT COUNT(*) AS c FROM system_logs ${clause}`).get(...params) as any;
    return row.c;
  },
  export(filter: SystemLogFilter, limit: number): any[] {
    const { clause, params } = buildSystemWhere(filter);
    return this.db()
      .prepare(`SELECT * FROM system_logs ${clause} ORDER BY created_at ASC LIMIT ?`)
      .all(...params, limit);
  },
  /** 聚合出现过的用户 ID（可按角色过滤），用于日志筛选下拉。 */
  distinctUsers(personaId?: string | null): string[] {
    const conds = ["user_id IS NOT NULL", "user_id != ''"];
    const params: unknown[] = [];
    if (personaId) {
      conds.push("persona_id = ?");
      params.push(personaId);
    }
    const rows = this.db()
      .prepare(`SELECT DISTINCT user_id FROM system_logs WHERE ${conds.join(" AND ")}`)
      .all(...params) as any[];
    return rows.map((r) => r.user_id as string).sort();
  },
  /** 清理早于指定时间的日志（保留策略可配置）。返回删除条数。 */
  pruneBefore(ts: number): number {
    const info = this.db().prepare(`DELETE FROM system_logs WHERE created_at < ?`).run(ts);
    return info.changes;
  },
};
