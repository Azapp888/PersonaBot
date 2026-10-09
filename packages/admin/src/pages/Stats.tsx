import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { Persona, TrendPoint } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, Label, Select } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/utils";

export function StatsPage() {
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [days, setDays] = useState(14);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    api.personas().then(setPersonas).catch(() => undefined);
    api.recentMessages(50).then(setMessages).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (personaId) api.personaTrends(personaId, days).then(setTrends).catch(() => undefined);
    else api.trends(days).then(setTrends).catch(() => undefined);
  }, [personaId, days]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>趋势</CardTitle>
          <div className="flex items-end gap-3">
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
              <Label>范围</Label>
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>近 7 天</option>
                <option value={14}>近 14 天</option>
                <option value={30}>近 30 天</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={trends}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} width={50} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} width={40} unit="%" />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="tokens" name="Token 消耗" stroke="#7c3aed" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="images" name="图片数" stroke="#059669" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="cacheHitRate" name="缓存命中率(%)" stroke="#d97706" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近消息记录</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">方向</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">内容</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 dark:border-slate-800">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDateTime(m.created_at)}</td>
                  <td className="px-4 py-3">{m.direction === "in" ? "收到" : "发出"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{m.user_id}</td>
                  <td className="max-w-[420px] truncate px-4 py-3">{m.content}</td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                    暂无消息记录。
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
