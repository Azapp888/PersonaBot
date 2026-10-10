import { useEffect, useState } from "react";
import { Activity, Bot, Image, MessageSquare, Percent, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import type { DashboardData, TrendPoint } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { formatNumber } from "@/lib/utils";

const COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#dc2626", "#0891b2"];

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
}: {
  title: string;
  value: string;
  icon: any;
  hint?: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
          {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/20">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
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
    <div className="animate-in space-y-4 lg:space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="今日 Token 消耗" value={formatNumber(data?.tokenConsumed ?? 0)} icon={Activity} hint={`输入+输出`} />
        <StatCard
          title="缓存命中率"
          value={`${data?.cacheHitRate ?? 0}%`}
          icon={Percent}
          hint={`命中 ${formatNumber(data?.cacheHitTokens ?? 0)} / 未命中 ${formatNumber(data?.cacheMissTokens ?? 0)}`}
        />
        <StatCard title="今日生成图片" value={formatNumber(data?.imagesGenerated ?? 0)} icon={Image} />
        <StatCard
          title="活跃 Bot"
          value={`${data?.activeBots ?? 0} / ${data?.totalBots ?? 0}`}
          icon={Bot}
          hint={`角色 ${data?.totalPersonas ?? 0} 个`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>近 14 天 Token 消耗趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trends}>
                <defs>
                  <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} width={50} />
                <Tooltip />
                <Area type="monotone" dataKey="tokens" name="Token" stroke="#7c3aed" fill="url(#tokenFill)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>今日消息量分布</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.perPersona.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={data.perPersona} dataKey="messages" nameKey="name" innerRadius={55} outerRadius={90}>
                    {data.perPersona.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>各 Bot 今日消息量</CardTitle>
          </CardHeader>
          <CardContent>
            {data && data.perBot.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={data.perBot}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={40} />
                  <Tooltip />
                  <Bar dataKey="messages" name="消息数" fill="#2563eb" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">暂无数据</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>各角色今日表现</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.perPersona ?? []).length === 0 && <p className="text-sm text-muted-foreground">暂无数据</p>}
            {(data?.perPersona ?? []).map((p, i) => (
              <div key={p.personaId} className="flex items-center justify-between rounded-md border border-border p-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
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
