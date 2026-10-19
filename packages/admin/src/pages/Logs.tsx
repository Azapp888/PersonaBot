import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import type {
  EventLogFilterParams,
  LogFilterParams,
  LogPage,
  Persona,
  SystemLogCategory,
  SystemLogLevel,
  SystemLogPage,
} from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

const PAGE_SIZE = 100;

const CATEGORY_LABELS: Record<SystemLogCategory, string> = {
  model: "模型",
  pipeline: "流程",
  error: "错误",
  vision: "读图",
  memory: "记忆",
  bot: "Bot",
  memory_file: "记忆文件",
  proactive: "主动",
  system: "系统",
};

const LEVEL_VARIANTS: Record<SystemLogLevel, "secondary" | "success" | "warning" | "destructive"> = {
  debug: "secondary",
  info: "success",
  warn: "warning",
  error: "destructive",
};

function dayStart(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function dayEnd(value: string): number | undefined {
  const start = dayStart(value);
  return start == null ? undefined : start + 24 * 60 * 60 * 1000;
}

type Tab = "messages" | "events";

export function LogsPage() {
  const { push } = useToast();
  const [tab, setTab] = useState<Tab>("messages");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [users, setUsers] = useState<string[]>([]);

  const [personaId, setPersonaId] = useState("");
  const [userId, setUserId] = useState("");
  const [direction, setDirection] = useState("");
  const [validity, setValidity] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [page, setPage] = useState<LogPage>({ total: 0, limit: PAGE_SIZE, offset: 0, items: [] });
  const [events, setEvents] = useState<SystemLogPage>({ total: 0, limit: PAGE_SIZE, offset: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"" | "json" | "md">("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api.personas().then(setPersonas).catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .logUsers(personaId || undefined)
      .then((res) => setUsers(res.users))
      .catch(() => undefined);
  }, [personaId]);

  const buildFilters = useCallback(
    (): LogFilterParams => ({
      personaId: personaId || undefined,
      userId: userId || undefined,
      direction: direction || undefined,
      invalid: validity === "" ? undefined : validity === "0" ? false : true,
      q: q.trim() || undefined,
      since: dayStart(from),
      until: dayEnd(to),
    }),
    [personaId, userId, direction, validity, q, from, to],
  );

  const buildEventFilters = useCallback(
    (): EventLogFilterParams => ({
      personaId: personaId || undefined,
      userId: userId || undefined,
      level: (level || undefined) as SystemLogLevel | undefined,
      category: (category || undefined) as SystemLogCategory | undefined,
      q: q.trim() || undefined,
      since: dayStart(from),
      until: dayEnd(to),
    }),
    [personaId, userId, level, category, q, from, to],
  );

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        if (tab === "messages") {
          setPage(await api.logs({ ...buildFilters(), limit: PAGE_SIZE, offset }));
        } else {
          setEvents(await api.eventLogs({ ...buildEventFilters(), limit: PAGE_SIZE, offset }));
        }
      } catch (err) {
        push((err as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [tab, buildFilters, buildEventFilters, push],
  );

  useEffect(() => {
    load(0).catch(() => undefined);
  }, [load]);

  const reset = () => {
    setPersonaId("");
    setUserId("");
    setDirection("");
    setLevel("");
    setCategory("");
    setQ("");
    setFrom("");
    setTo("");
  };

  const doExport = async (format: "json" | "md") => {
    setExporting(format);
    try {
      if (tab === "messages") {
        await api.exportLogs(format, buildFilters());
        push(`已导出消息日志 ${format.toUpperCase()}`, "success");
      } else {
        await api.exportEventLogs(format, buildEventFilters());
        push(`已导出事件日志 ${format.toUpperCase()}`, "success");
      }
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setExporting("");
    }
  };

  const activeTotal = tab === "messages" ? page.total : events.total;
  const activeOffset = tab === "messages" ? page.offset : events.offset;
  const totalPages = Math.max(1, Math.ceil(activeTotal / PAGE_SIZE));
  const currentPage = Math.floor(activeOffset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <Button variant={tab === "messages" ? "default" : "outline"} size="sm" onClick={() => setTab("messages")}>
          消息日志
        </Button>
        <Button variant={tab === "events" ? "default" : "outline"} size="sm" onClick={() => setTab("events")}>
          运行日志
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => doExport("json")} disabled={!!exporting}>
              <Download className="h-3.5 w-3.5" /> {exporting === "json" ? "导出中" : "导出 JSON"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => doExport("md")} disabled={!!exporting}>
              <FileText className="h-3.5 w-3.5" /> {exporting === "md" ? "导出中" : "导出 Markdown"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div>
              <Label>角色</Label>
              <Select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
                <option value="">全部角色</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>用户</Label>
              <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">全部用户</option>
                {users.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
            {tab === "messages" ? (
              <>
                <div>
                  <Label>方向</Label>
                  <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
                    <option value="">全部</option>
                    <option value="in">收到</option>
                    <option value="out">发出</option>
                  </Select>
                </div>
                <div>
                  <Label>有效性</Label>
                  <Select value={validity} onChange={(e) => setValidity(e.target.value)}>
                    <option value="">全部</option>
                    <option value="0">有效</option>
                    <option value="1">已标无效</option>
                  </Select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label>级别</Label>
                  <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="">全部级别</option>
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </Select>
                </div>
                <div>
                  <Label>类别</Label>
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">全部类别</option>
                    {(Object.keys(CATEGORY_LABELS) as SystemLogCategory[]).map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label>起始日期</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>结束日期</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div>
              <Label>关键字</Label>
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="内容包含" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => load(0)} disabled={loading}>
              <Search className="h-3.5 w-3.5" /> 查询
            </Button>
            <Button variant="outline" size="sm" onClick={reset}>
              重置
            </Button>
            <Button variant="ghost" size="sm" onClick={() => load(activeOffset)} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新
            </Button>
            <span className="ml-auto font-mono text-[11px] text-muted">共 {activeTotal} 条</span>
          </div>
        </CardContent>
      </Card>

      {tab === "messages" ? (
        <Card>
          <CardHeader>
            <CardTitle>消息日志</CardTitle>
            <Pager loading={loading} offset={page.offset} currentPage={currentPage} totalPages={totalPages} onGo={load} />
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[860px] text-[13.5px]">
              <thead>
                <tr className="border-b border-rule text-left">
                  <th className="call-label px-4 py-2.5 font-normal">时间</th>
                  <th className="call-label px-4 py-2.5 font-normal">方向</th>
                  <th className="call-label px-4 py-2.5 font-normal">角色</th>
                  <th className="call-label px-4 py-2.5 font-normal">Bot</th>
                  <th className="call-label px-4 py-2.5 font-normal">用户</th>
                  <th className="call-label px-4 py-2.5 font-normal">内容</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((m) => (
                  <tr key={m.id} className="border-b border-rule last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-muted">{formatDateTime(m.time)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Badge variant={m.direction === "in" ? "secondary" : "success"}>
                          {m.direction === "in" ? "收到" : "发出"}
                        </Badge>
                        {m.invalid && <Badge variant="warning">无效</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{m.personaName ?? <span className="text-muted">-</span>}</td>
                    <td className="px-4 py-3">{m.botName ?? <span className="text-muted">-</span>}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-muted">{m.userId}</td>
                    <td className="max-w-[460px] px-4 py-3">
                      <span className="line-clamp-2 whitespace-pre-wrap break-words">{m.content}</span>
                    </td>
                  </tr>
                ))}
                {page.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center font-mono text-[12px] text-muted">
                      {loading ? "加载中..." : "暂无日志记录。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>运行日志</CardTitle>
            <Pager loading={loading} offset={events.offset} currentPage={currentPage} totalPages={totalPages} onGo={load} />
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-rule">
              {events.items.map((e) => (
                <div key={e.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted">{formatDateTime(e.time)}</span>
                    <Badge variant={LEVEL_VARIANTS[e.level]}>{e.level}</Badge>
                    <Badge variant="secondary">{CATEGORY_LABELS[e.category] ?? e.category}</Badge>
                    {e.stage && <span className="font-mono text-[11px] text-muted">{e.stage}</span>}
                    {e.durationMs != null && (
                      <span className="font-mono text-[11px] text-muted">{e.durationMs}ms</span>
                    )}
                    {e.personaName && <span className="text-[12px] text-muted">{e.personaName}</span>}
                    {e.userId && <span className="font-mono text-[11px] text-muted">{e.userId}</span>}
                    {(e.detail || e.durationMs != null) && (
                      <button
                        type="button"
                        className="ml-auto font-mono text-[11px] text-muted underline-offset-2 hover:underline"
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                      >
                        {expanded === e.id ? "收起" : "详情"}
                      </button>
                    )}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px]">{e.message}</p>
                  {expanded === e.id && e.detail && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-panel p-3 font-mono text-[11.5px] leading-relaxed">
                      {e.detail}
                    </pre>
                  )}
                </div>
              ))}
              {events.items.length === 0 && (
                <div className="px-4 py-12 text-center font-mono text-[12px] text-muted">
                  {loading ? "加载中..." : "暂无运行日志。"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Pager(props: {
  loading: boolean;
  offset: number;
  currentPage: number;
  totalPages: number;
  onGo: (offset: number) => void;
}) {
  const { loading, offset, currentPage, totalPages, onGo } = props;
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => onGo(offset - PAGE_SIZE)} disabled={loading || offset <= 0}>
        <ChevronLeft className="h-3.5 w-3.5" /> 上一页
      </Button>
      <span className="font-mono text-[11px] text-muted">
        {currentPage} / {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onGo(offset + PAGE_SIZE)}
        disabled={loading || currentPage >= totalPages}
      >
        下一页 <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
