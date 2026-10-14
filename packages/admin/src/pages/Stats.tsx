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
        <CardHeader className="flex-wrap gap-3">
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
              <CartesianGrid strokeDasharray="2 4" vertical={false} stroke="hsl(var(--rule))" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: "hsl(var(--muted))" }} tickFormatter={(v) => v.slice(5)} stroke="hsl(var(--rule))" />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: "hsl(var(--muted))" }} width={50} stroke="hsl(var(--rule))" />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", fill: "hsl(var(--muted))" }} width={40} unit="%" stroke="hsl(var(--rule))" />
              <Tooltip contentStyle={{ background: "hsl(var(--panel))", border: "1px solid hsl(var(--rule))", borderRadius: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }} />
              <Legend wrapperStyle={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }} />
              <Line yAxisId="left" type="monotone" dataKey="tokens" name="Token 消耗" stroke="hsl(var(--stamp))" strokeWidth={2} dot={false} />
              <Line yAxisId="left" type="monotone" dataKey="images" name="图片数" stroke="hsl(var(--location))" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="cacheHitRate" name="缓存命中率(%)" stroke="hsl(var(--alert))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近消息记录</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="call-label px-4 py-2.5 font-normal">时间</th>
                <th className="call-label px-4 py-2.5 font-normal">方向</th>
                <th className="call-label px-4 py-2.5 font-normal">用户</th>
                <th className="call-label px-4 py-2.5 font-normal">内容</th>
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.id} className="border-b border-rule last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-muted">{formatDateTime(m.created_at)}</td>
                  <td className="px-4 py-3">{m.direction === "in" ? "收到" : "发出"}</td>
                  <td className="px-4 py-3 font-mono text-[11.5px] text-muted">{m.user_id}</td>
                  <td className="max-w-[420px] truncate px-4 py-3">{m.content}</td>
                </tr>
              ))}
              {messages.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center font-mono text-[12px] text-muted">
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
