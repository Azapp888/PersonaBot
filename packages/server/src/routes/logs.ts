import type { FastifyInstance } from "fastify";
import { logRepo, type MessageLogFilter } from "../db/repos/logs";
import { systemLogRepo, type SystemLogFilter, type SystemLogLevel, type SystemLogCategory } from "../db/repos/system-logs";
import { personaRepo } from "../db/repos/personas";
import { botRepo } from "../db/repos/bots";
import { formatDate, formatDateTime } from "../utils/id";

const MAX_PAGE = 500;
const MAX_EXPORT = 20000;

/** 合并 message_logs 与 system_logs 的用户集合，供筛选下拉使用。 */
function combinedUsers(personaId?: string | null): string[] {
  const set = new Set<string>();
  for (const u of logRepo.distinctUsers(personaId)) set.add(u);
  for (const u of systemLogRepo.distinctUsers(personaId)) set.add(u);
  return Array.from(set).sort();
}

function parseFilter(query: Record<string, unknown>): MessageLogFilter {
  const direction =
    query.direction === "in" || query.direction === "out" ? (query.direction as "in" | "out") : undefined;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const since = query.since != null && query.since !== "" ? Number(query.since) : undefined;
  const until = query.until != null && query.until !== "" ? Number(query.until) : undefined;
  const invalid =
    query.invalid === "1" || query.invalid === "true"
      ? true
      : query.invalid === "0" || query.invalid === "false"
        ? false
        : undefined;
  return {
    personaId: typeof query.personaId === "string" && query.personaId ? query.personaId : undefined,
    userId: typeof query.userId === "string" && query.userId ? query.userId : undefined,
    direction,
    q: q || undefined,
    since: Number.isFinite(since) ? since : undefined,
    until: Number.isFinite(until) ? until : undefined,
    invalid,
  };
}

function describeFilter(filter: MessageLogFilter): string {
  const parts: string[] = [];
  if (filter.personaId) parts.push(`角色=${filter.personaId}`);
  if (filter.userId) parts.push(`用户=${filter.userId}`);
  if (filter.direction) parts.push(`方向=${filter.direction === "in" ? "收到" : "发出"}`);
  if (filter.q) parts.push(`关键字=${filter.q}`);
  if (filter.since != null) parts.push(`起=${formatDateTime(filter.since)}`);
  if (filter.until != null) parts.push(`止=${formatDateTime(filter.until)}`);
  if (filter.invalid != null) parts.push(filter.invalid ? "仅无效记录" : "仅有效记录");
  return parts.length ? parts.join("，") : "无（全部记录）";
}

interface PresentedLog {
  id: string;
  time: number;
  iso: string;
  direction: string;
  userId: string;
  personaId: string | null;
  personaName: string | null;
  botId: string | null;
  botName: string | null;
  content: string;
  invalid: boolean;
}

function presentRows(rows: any[]): PresentedLog[] {
  const personaName = new Map(personaRepo.list().map((p) => [p.id, p.name]));
  const botName = new Map(botRepo.list().map((b) => [b.id, b.name]));
  return rows.map((r) => ({
    id: r.id,
    time: r.created_at,
    iso: new Date(r.created_at).toISOString(),
    direction: r.direction,
    userId: r.user_id,
    personaId: r.persona_id ?? null,
    personaName: r.persona_id ? personaName.get(r.persona_id) ?? r.persona_id : null,
    botId: r.bot_id ?? null,
    botName: r.bot_id ? botName.get(r.bot_id) ?? r.bot_id : null,
    content: r.content,
    invalid: r.invalid === 1,
  }));
}

function fileStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(date).replace(/-/g, "")}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function toMarkdown(items: PresentedLog[], filter: MessageLogFilter, exportedAt: Date): string {
  const lines: string[] = [];
  lines.push("# PersonaBot 消息日志");
  lines.push("");
  lines.push(`- 导出时间：${formatDateTime(exportedAt)}`);
  lines.push(`- 记录条数：${items.length}`);
  lines.push(`- 筛选条件：${describeFilter(filter)}`);
  lines.push("");

  let currentDay = "";
  for (const item of items) {
    const day = formatDate(item.time);
    if (day !== currentDay) {
      currentDay = day;
      lines.push(`## ${day}`);
      lines.push("");
    }
    const meta = [formatDateTime(item.time).slice(11), item.direction === "in" ? "收到" : "发出"];
    if (item.invalid) meta.push("已标记无效");
    if (item.personaName) meta.push(`角色 ${item.personaName}`);
    meta.push(`用户 ${item.userId}`);
    lines.push(`### ${meta.join(" · ")}`);
    lines.push("");
    lines.push(item.content.trim() || "（空）");
    lines.push("");
  }
  if (!items.length) lines.push("（暂无记录）");
  return lines.join("\n");
}

const LEVELS: SystemLogLevel[] = ["debug", "info", "warn", "error"];
const CATEGORIES: SystemLogCategory[] = [
  "model",
  "pipeline",
  "error",
  "vision",
  "memory",
  "bot",
  "memory_file",
  "proactive",
  "system",
];

function parseEventFilter(query: Record<string, unknown>): SystemLogFilter {
  const level = typeof query.level === "string" && LEVELS.includes(query.level as SystemLogLevel)
    ? (query.level as SystemLogLevel)
    : undefined;
  const category =
    typeof query.category === "string" && CATEGORIES.includes(query.category as SystemLogCategory)
      ? (query.category as SystemLogCategory)
      : undefined;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const since = query.since != null && query.since !== "" ? Number(query.since) : undefined;
  const until = query.until != null && query.until !== "" ? Number(query.until) : undefined;
  return {
    personaId: typeof query.personaId === "string" && query.personaId ? query.personaId : undefined,
    userId: typeof query.userId === "string" && query.userId ? query.userId : undefined,
    level,
    category,
    modelId: typeof query.modelId === "string" && query.modelId ? query.modelId : undefined,
    q: q || undefined,
    since: Number.isFinite(since) ? since : undefined,
    until: Number.isFinite(until) ? until : undefined,
  };
}

function describeEventFilter(filter: SystemLogFilter): string {
  const parts: string[] = [];
  if (filter.personaId) parts.push(`角色=${filter.personaId}`);
  if (filter.userId) parts.push(`用户=${filter.userId}`);
  if (filter.level) parts.push(`级别=${filter.level}`);
  if (filter.category) parts.push(`类别=${filter.category}`);
  if (filter.modelId) parts.push(`模型=${filter.modelId}`);
  if (filter.q) parts.push(`关键字=${filter.q}`);
  if (filter.since != null) parts.push(`起=${formatDateTime(filter.since)}`);
  if (filter.until != null) parts.push(`止=${formatDateTime(filter.until)}`);
  return parts.length ? parts.join("，") : "无（全部记录）";
}

interface PresentedEvent {
  id: string;
  time: number;
  iso: string;
  level: string;
  category: string;
  personaId: string | null;
  personaName: string | null;
  botId: string | null;
  botName: string | null;
  userId: string | null;
  modelId: string | null;
  provider: string | null;
  stage: string | null;
  message: string;
  detail: string | null;
  durationMs: number | null;
}

function presentEvents(rows: any[]): PresentedEvent[] {
  const personaName = new Map(personaRepo.list().map((p) => [p.id, p.name]));
  const botName = new Map(botRepo.list().map((b) => [b.id, b.name]));
  return rows.map((r) => ({
    id: r.id,
    time: r.created_at,
    iso: new Date(r.created_at).toISOString(),
    level: r.level,
    category: r.category,
    personaId: r.persona_id ?? null,
    personaName: r.persona_id ? personaName.get(r.persona_id) ?? r.persona_id : null,
    botId: r.bot_id ?? null,
    botName: r.bot_id ? botName.get(r.bot_id) ?? r.bot_id : null,
    userId: r.user_id ?? null,
    modelId: r.model_id ?? null,
    provider: r.provider ?? null,
    stage: r.stage ?? null,
    message: r.message,
    detail: r.detail ?? null,
    durationMs: r.duration_ms ?? null,
  }));
}

function eventsToMarkdown(items: PresentedEvent[], filter: SystemLogFilter, exportedAt: Date): string {
  const lines: string[] = [];
  lines.push("# PersonaBot 运行日志（事件）");
  lines.push("");
  lines.push(`- 导出时间：${formatDateTime(exportedAt)}`);
  lines.push(`- 记录条数：${items.length}`);
  lines.push(`- 筛选条件：${describeEventFilter(filter)}`);
  lines.push("");
  for (const item of items) {
    const meta = [formatDateTime(item.time), `[${item.level.toUpperCase()}]`, item.category];
    if (item.stage) meta.push(`stage=${item.stage}`);
    if (item.durationMs != null) meta.push(`${item.durationMs}ms`);
    if (item.personaName) meta.push(`角色=${item.personaName}`);
    if (item.userId) meta.push(`用户=${item.userId}`);
    if (item.modelId) meta.push(`模型=${item.modelId}`);
    lines.push(`## ${meta.join(" · ")}`);
    lines.push("");
    lines.push(item.message);
    if (item.detail) {
      lines.push("");
      lines.push("```json");
      lines.push(item.detail);
      lines.push("```");
    }
    lines.push("");
  }
  if (!items.length) lines.push("（暂无记录）");
  return lines.join("\n");
}

export async function logRoutes(app: FastifyInstance): Promise<void> {
  // 用户下拉：聚合日志里出现过的用户 ID（可按角色过滤）。
  app.get("/api/logs/users", { preHandler: [app.authenticate] }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const personaId = typeof query.personaId === "string" && query.personaId ? query.personaId : null;
    return { users: combinedUsers(personaId) };
  });

  app.get("/api/logs", { preHandler: [app.authenticate] }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const filter = parseFilter(query);
    const limit = Math.min(Math.max(1, Number(query.limit) || 100), MAX_PAGE);
    const offset = Math.max(0, Number(query.offset) || 0);
    const total = logRepo.countMessageLogs(filter);
    const rows = logRepo.messageLogs(filter, limit, offset);
    return { total, limit, offset, items: presentRows(rows) };
  });

  app.get("/api/logs/export", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const filter = parseFilter(query);
    const format = query.format === "md" ? "md" : "json";
    const rows = logRepo.exportMessageLogs(filter, MAX_EXPORT);
    const items = presentRows(rows);
    const exportedAt = new Date();
    const filename = `personabot-logs-${fileStamp(exportedAt)}.${format}`;
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    if (format === "md") {
      reply.type("text/markdown; charset=utf-8");
      return toMarkdown(items, filter, exportedAt);
    }
    reply.type("application/json; charset=utf-8");
    return JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        count: items.length,
        filter: describeFilter(filter),
        items,
      },
      null,
      2,
    );
  });

  // 运行/事件日志：pipeline 与模型请求的结构化记录。
  app.get("/api/logs/events", { preHandler: [app.authenticate] }, async (request) => {
    const query = request.query as Record<string, unknown>;
    const filter = parseEventFilter(query);
    const limit = Math.min(Math.max(1, Number(query.limit) || 100), MAX_PAGE);
    const offset = Math.max(0, Number(query.offset) || 0);
    const total = systemLogRepo.count(filter);
    const rows = systemLogRepo.list(filter, limit, offset);
    return { total, limit, offset, items: presentEvents(rows) };
  });

  app.get("/api/logs/events/export", { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const filter = parseEventFilter(query);
    const format = query.format === "md" ? "md" : "json";
    const rows = systemLogRepo.export(filter, MAX_EXPORT);
    const items = presentEvents(rows);
    const exportedAt = new Date();
    const filename = `personabot-events-${fileStamp(exportedAt)}.${format}`;
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    if (format === "md") {
      reply.type("text/markdown; charset=utf-8");
      return eventsToMarkdown(items, filter, exportedAt);
    }
    reply.type("application/json; charset=utf-8");
    return JSON.stringify(
      {
        exportedAt: exportedAt.toISOString(),
        count: items.length,
        filter: describeEventFilter(filter),
        items,
      },
      null,
      2,
    );
  });
}
