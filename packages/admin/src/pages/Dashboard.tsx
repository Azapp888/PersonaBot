import { useEffect, useState } from "react";
import { Activity, Bot, Image, MessageSquare, Percent } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { DashboardData, TrendPoint } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/utils";

const CA = {
  stamp: "hsl(var(--stamp))",
  location: "hsl(var(--location))",
  ink: "hsl(var(--ink))",
  rule: "hsl(var(--rule))",
  muted: "hsl(var(--muted))",
};

/** A ruled call-sheet figure block — number, label, and a hairline. */
function Figure({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="border-b border-rule px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <p className="call-label">{label}</p>
      <p className="mt-1 font-display text-[30px] font-medium leading-none tracking-[0.01em] text-ink">{value}</p>
      {sub && <p className="mt-1.5 font-mono text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-rule py-2 last:border-b-0">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[13px] tabular-nums text-ink">{value}</span>
    </div>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="border border-rule bg-panel px-2.5 py-1.5 font-mono text-[11px] shadow-sm">
      <div className="text-muted">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="text-ink">
          {p.name} {formatNumber(p.value)}
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [trends, setTrends] = useState<TrendPoint[]>([]);

  useEffect(() => {
    api.dashboard().then(setData).catch(() => undefined);
    api.trends(14).then(setTrends).catch(() => undefined);
  }, []);

  return (
    <div className="animate-in space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-3">
        <p className="call-label">Today's Dispatch · 今日工况</p>
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          在线 <span className="text-location">{data?.activeBots ?? 0}</span> / {data?.totalBots ?? 0} · 角色{" "}
          {data?.totalPersonas ?? 0}
        </p>
      </div>

      {/* Figure strip — ruled, not a row of cards */}
      <div className="grid grid-cols-2 border border-rule bg-panel sm:grid-cols-4">
        <Figure value={formatNumber(data?.tokenConsumed ?? 0)} label="Token 消耗" sub="输入 + 输出" />
        <Figure
          value={`${data?.cacheHitRate ?? 0}%`}
          label="缓存命中率"
          sub={`命中 ${formatNumber(data?.cacheHitTokens ?? 0)} / 未命中 ${formatNumber(data?.cacheMissTokens ?? 0)}`}
        />
        <Figure value={formatNumber(data?.imagesGenerated ?? 0)} label="今日图片" sub="按角色限额" />
        <Figure value={`${data?.activeBots ?? 0} / ${data?.totalBots ?? 0}`} label="活跃 Bot" sub={`角色 ${data?.totalPersonas ?? 0} 个`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>近 14 天 Token 消耗</CardTitle>
            <span className="font-mono text-[11px] text-muted">单位：token</span>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trends} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CA.stamp} stopOpacity={0.28} />
                    <stop offset="95%" stopColor={CA.stamp} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 3" vertical={false} stroke={CA.rule} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: CA.muted, fontFamily: "IBM Plex Mono" }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={{ stroke: CA.rule }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: CA.muted, fontFamily: "IBM Plex Mono" }}
                  width={54}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<ChartTip />} cursor={{ stroke: CA.rule }} />
                <Area type="linear" dataKey="tokens" name="Token" stroke={CA.stamp} fill="url(#tokenFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>术语表</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <StatLine label="活跃 Bot" value={`${data?.activeBots ?? 0} / ${data?.totalBots ?? 0}`} />
            <StatLine label="角色总数" value={`${data?.totalPersonas ?? 0}`} />
            <StatLine label="缓存命中" value={formatNumber(data?.cacheHitTokens ?? 0)} />
            <StatLine label="缓存未命中" value={formatNumber(data?.cacheMissTokens ?? 0)} />
            <StatLine label="今日图片" value={formatNumber(data?.imagesGenerated ?? 0)} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>各 Bot 今日消息量</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.perBot.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.perBot} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 3" vertical={false} stroke={CA.rule} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: CA.muted, fontFamily: "IBM Plex Mono" }}
                    axisLine={{ stroke: CA.rule }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: CA.muted, fontFamily: "IBM Plex Mono" }}
                    width={44}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTip />} cursor={{ fill: "hsl(var(--ink) / 0.05)" }} />
                  <Bar dataKey="messages" name="消息数" fill={CA.location} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[240px] items-center justify-center font-mono text-[12px] text-muted">暂无数据</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>各角色今日表现</CardTitle>
            <span className="font-mono text-[11px] text-muted">消息 / Token / 图片</span>
          </CardHeader>
          <CardContent className="pt-1">
            {(data?.perPersona ?? []).length === 0 && (
              <p className="py-8 text-center font-mono text-[12px] text-muted">暂无数据</p>
            )}
            {(data?.perPersona ?? []).map((p) => (
              <div key={p.personaId} className="flex items-center justify-between border-b border-rule py-3 last:border-b-0">
                <span className="text-[13.5px] font-medium text-ink">{p.name}</span>
                <div className="flex gap-4 font-mono text-[11.5px] tabular-nums text-muted">
                  <span className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3" /> {p.messages}
                  </span>
                  <span className="flex items-center gap-1">
                    <Activity className="h-3 w-3" /> {formatNumber(p.tokens)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Image className="h-3 w-3" /> {p.images}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
