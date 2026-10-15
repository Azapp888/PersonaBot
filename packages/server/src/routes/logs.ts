import type { FastifyInstance } from "fastify";
import { logRepo, type MessageLogFilter } from "../db/repos/logs";
import { personaRepo } from "../db/repos/personas";
import { botRepo } from "../db/repos/bots";
import { formatDate, formatDateTime } from "../utils/id";

const MAX_PAGE = 500;
const MAX_EXPORT = 20000;

function parseFilter(query: Record<string, unknown>): MessageLogFilter {
  const direction =
    query.direction === "in" || query.direction === "out" ? (query.direction as "in" | "out") : undefined;
  const q = typeof query.q === "string" ? query.q.trim() : "";
  const since = query.since != null && query.since !== "" ? Number(query.since) : undefined;
  const until = query.until != null && query.until !== "" ? Number(query.until) : undefined;
  return {
    personaId: typeof query.personaId === "string" && query.personaId ? query.personaId : undefined,
    userId: typeof query.userId === "string" && query.userId ? query.userId : undefined,
    direction,
    q: q || undefined,
    since: Number.isFinite(since) ? since : undefined,
    until: Number.isFinite(until) ? until : undefined,
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

export async function logRoutes(app: FastifyInstance): Promise<void> {
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
}
