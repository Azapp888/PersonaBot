import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import type { LogFilterParams, LogPage, Persona } from "@/lib/types";
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

function dayStart(value: string): number | undefined {
  if (!value) return undefined;
  const ts = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ts) ? ts : undefined;
}

function dayEnd(value: string): number | undefined {
  const start = dayStart(value);
  return start == null ? undefined : start + 24 * 60 * 60 * 1000;
}

export function LogsPage() {
  const { push } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [userId, setUserId] = useState("");
  const [direction, setDirection] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState<LogPage>({ total: 0, limit: PAGE_SIZE, offset: 0, items: [] });
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<"" | "json" | "md">("");

  useEffect(() => {
    api.personas().then(setPersonas).catch(() => undefined);
  }, []);

  const buildFilters = useCallback(
    (): LogFilterParams => ({
      personaId: personaId || undefined,
      userId: userId.trim() || undefined,
      direction: direction || undefined,
      q: q.trim() || undefined,
      since: dayStart(from),
      until: dayEnd(to),
    }),
    [personaId, userId, direction, q, from, to],
  );

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const data = await api.logs({ ...buildFilters(), limit: PAGE_SIZE, offset });
        setPage(data);
      } catch (err) {
        push((err as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [buildFilters, push],
  );

  useEffect(() => {
    load(0).catch(() => undefined);
  }, [load]);

  const reset = () => {
    setPersonaId("");
    setUserId("");
    setDirection("");
    setQ("");
    setFrom("");
    setTo("");
  };

  const doExport = async (format: "json" | "md") => {
    setExporting(format);
    try {
      await api.exportLogs(format, buildFilters());
      push(`已导出 ${format.toUpperCase()} 日志`, "success");
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setExporting("");
    }
  };

  const totalPages = Math.max(1, Math.ceil(page.total / PAGE_SIZE));
  const currentPage = Math.floor(page.offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-5">
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
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="用户 ID" />
            </div>
            <div>
              <Label>方向</Label>
              <Select value={direction} onChange={(e) => setDirection(e.target.value)}>
                <option value="">全部</option>
                <option value="in">收到</option>
                <option value="out">发出</option>
              </Select>
            </div>
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
            <Button variant="ghost" size="sm" onClick={() => load(page.offset)} disabled={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新
            </Button>
            <span className="ml-auto font-mono text-[11px] text-muted">共 {page.total} 条</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>消息日志</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load(page.offset - PAGE_SIZE)} disabled={loading || page.offset <= 0}>
              <ChevronLeft className="h-3.5 w-3.5" /> 上一页
            </Button>
            <span className="font-mono text-[11px] text-muted">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(page.offset + PAGE_SIZE)}
              disabled={loading || currentPage >= totalPages}
            >
              下一页 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
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
                    <Badge variant={m.direction === "in" ? "secondary" : "success"}>
                      {m.direction === "in" ? "收到" : "发出"}
                    </Badge>
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
    </div>
  );
}
