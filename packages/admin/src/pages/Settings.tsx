import { useEffect, useState, type ReactNode } from "react";
import { Download, Play, RefreshCw, Save, Server } from "lucide-react";
import { api } from "@/lib/api";
import type { AppSettings, ModelRecord, UpdateInfo, UpdateResult } from "@/lib/types";
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
  Switch,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-rule p-3.5 transition-colors">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: "Asia/Shanghai", label: "北京时间（Asia/Shanghai · UTC+8）" },
  { value: "server", label: "服务器时间（跟随系统时区）" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong（香港 · UTC+8）" },
  { value: "Asia/Taipei", label: "Asia/Taipei（台北 · UTC+8）" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo（日本 · UTC+9）" },
  { value: "Asia/Seoul", label: "Asia/Seoul（韩国 · UTC+9）" },
  { value: "Asia/Singapore", label: "Asia/Singapore（新加坡 · UTC+8）" },
  { value: "Europe/London", label: "Europe/London（伦敦）" },
  { value: "Europe/Paris", label: "Europe/Paris（巴黎）" },
  { value: "America/New_York", label: "America/New_York（纽约）" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles（洛杉矶）" },
  { value: "UTC", label: "UTC（协调世界时）" },
];

function effectiveTz(tz: string): string | undefined {
  return !tz || tz === "server" ? undefined : tz;
}

function tzLabel(tz: string): string {
  if (!tz || tz === "server") {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `服务器时间（${resolved}）`;
  }
  return TIMEZONE_OPTIONS.find((o) => o.value === tz)?.label ?? tz;
}

function formatClock(ts: number, tz?: string): string {
  const d = new Date(ts);
  const zone = effectiveTz(tz ?? "");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      hourCycle: "h23",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const wd = new Intl.DateTimeFormat("zh-CN", { timeZone: zone, weekday: "short" }).format(d);
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${wd}`;
  } catch {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
      d.getSeconds(),
    )} ${WEEKDAYS[d.getDay()]}`;
  }
}

function offsetLabel(ts: number, tz?: string): string {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone: effectiveTz(tz ?? ""), timeZoneName: "longOffset" })
        .formatToParts(new Date(ts))
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    return name.replace("GMT", "UTC");
  } catch {
    return "";
  }
}

export function SettingsPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [info, setInfo] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [paintingApiKey, setPaintingApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [snapshot, setSnapshot] = useState("");
  const [serverOffset, setServerOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null);

  const refreshServerTime = async () => {
    const t = await api.systemTime();
    setServerOffset(t.now - Date.now());
  };

  const load = async () => {
    const [s, modelList] = await Promise.all([api.settings(), api.models()]);
    setSettings(s);
    setModels(modelList);
    setSnapshot(JSON.stringify(s));
    setInfo(await api.systemInfo());
    await refreshServerTime();
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const set = (patch: Partial<AppSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const payload: any = { ...settings };
      if (paintingApiKey) payload.paintingApiKey = paintingApiKey;
      if (githubToken) payload.githubToken = githubToken;
      delete payload.paintingApiKeySet;
      delete payload.githubTokenSet;
      await api.updateSettings(payload);
      setPaintingApiKey("");
      setGithubToken("");
      push("设置已保存", "success");
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const checkForUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const info = await api.checkUpdate();
      setUpdateInfo(info);
      push(info.message, info.available ? "info" : info.ok ? "success" : "error");
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setCheckingUpdate(false);
    }
  };

  const applyUpdateNow = async () => {
    if (!window.confirm("将从 GitHub 拉取最新代码并重新安装依赖、构建。期间服务可能短暂不可用，确认继续？")) return;
    setApplyingUpdate(true);
    setUpdateResult(null);
    try {
      const res = await api.applyUpdate();
      setUpdateResult(res);
      push(res.message, res.ok ? "success" : "error");
      await checkForUpdate();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setApplyingUpdate(false);
    }
  };

  const runProactive = async () => {
    try {
      const res = await api.runProactive();
      if (res.sent > 0) {
        push(`已发送 ${res.sent} 条主动消息${res.errors.length ? `，${res.errors.length} 条失败` : ""}`, "success");
      } else if (res.errors.length) {
        push(`发送失败：${res.errors[0]}`, "error");
      } else if (res.skipped.length) {
        push(`未发送：${res.skipped[0].reason}`, "info");
      } else {
        push("没有可发送的目标（请确认角色与 Bot 已启用、且用户有过对话）", "info");
      }
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  if (!settings) return <div className="font-mono text-[12px] text-muted">加载中</div>;

  const dirty = snapshot !== "" && JSON.stringify(settings) !== snapshot;

  return (
    <div className="space-y-4 pb-28 lg:space-y-6 lg:pb-0">
      <Card>
        <CardHeader>
          <CardTitle>基础服务</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="管理后台端口">
            <Input type="number" value={settings.adminPort} onChange={(e) => set({ adminPort: Number(e.target.value) })} />
          </Field>
          <Field label="消息防抖窗口（毫秒）" hint="多条消息在此窗口内合并为一次回复">
            <Input
              type="number"
              value={settings.messageDebounceMs}
              onChange={(e) => set({ messageDebounceMs: Number(e.target.value) })}
            />
          </Field>
          <Field label="记忆注入的最近对话条数">
            <Input
              type="number"
              value={settings.memoryInjectConversationLimit}
              onChange={(e) => set({ memoryInjectConversationLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="Bot 服务说明">
            <Input value={settings.botServiceNote} onChange={(e) => set({ botServiceNote: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>消息与缓存</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="启用缓存优化"
            hint="前缀稳定 + 只追加会话，提升 prompt cache 命中率"
            checked={settings.cacheEnabled}
            onChange={(v) => set({ cacheEnabled: v })}
          />
          <ToggleRow
            label="多行回复分条发送"
            hint="同一 msg_id + 递增 msg_seq 逐条发送"
            checked={settings.splitMessages}
            onChange={(v) => set({ splitMessages: v })}
          />
          <Field label="时区" hint="注入模型的时间按此时区显示，可选北京时间或服务器时间">
            <Select value={settings.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TIMEZONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {!TIMEZONE_OPTIONS.some((o) => o.value === settings.timezone) && (
                <option value={settings.timezone}>{settings.timezone}</option>
              )}
            </Select>
          </Field>
          <div className="border border-rule bg-ink/[0.02] p-3.5 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="call-label">
                  当前系统时间{tick + serverOffset ? `（${tzLabel(settings.timezone)} · ${offsetLabel(tick + serverOffset, settings.timezone)}）` : ""}
                </div>
                <div className="mt-1 font-mono text-[20px] font-medium tabular-nums text-ink">
                  {formatClock(tick + serverOffset, settings.timezone)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshServerTime().then(() => push("已按服务器时间校准"))}
              >
                <RefreshCw className="h-3.5 w-3.5" /> 重新校准
              </Button>
            </div>
            <div className="mt-1.5 text-[12px] leading-relaxed text-muted">
              以服务器实时时间校准，并按上方时区显示。所有模型动作（回复、主动消息、每日问候、记忆整理）都会注入当前真实时间。
            </div>
          </div>
          <Field label="单次最多分条数" hint="被动回复上限：单聊 4 次、群聊 5 次，超出合并进最后一条">
            <Input
              type="number"
              value={settings.splitMaxMessages}
              onChange={(e) => set({ splitMaxMessages: Number(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>每日问候</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="启用每日自动问候"
            hint="每个用户每天最多发 N 次，优先在其活跃时段发送；已对话的用户同样会收到"
            checked={settings.dailyMessageEnabled}
            onChange={(v) => set({ dailyMessageEnabled: v })}
          />
          <Field label="默认发送时间（小时）" hint="用户尚无活跃时段记录时，在该小时之后发送，0-23">
            <Input
              type="number"
              min={0}
              max={23}
              value={settings.dailyMessageHour}
              onChange={(e) => set({ dailyMessageHour: Number(e.target.value) })}
            />
          </Field>
          <Field label="每天最多问候次数" hint="每个用户每天最多发送几次每日问候，默认 1">
            <Input
              type="number"
              min={1}
              value={settings.dailyMessageMaxPerDay}
              onChange={(e) => set({ dailyMessageMaxPerDay: Number(e.target.value) })}
            />
          </Field>
          <Field label="两次问候最小间隔（分钟）" hint="次数大于 1 时生效，避免刚发完又发，默认 240">
            <Input
              type="number"
              min={1}
              value={settings.dailyMessageMinGapMinutes}
              onChange={(e) => set({ dailyMessageMinGapMinutes: Number(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>上下文与记忆</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="启用上下文摘要"
            hint="超出窗口的更早对话压缩成摘要，强制保留未完成任务 / 情绪 / 长期记忆点"
            checked={settings.contextSummaryEnabled}
            onChange={(v) => set({ contextSummaryEnabled: v })}
          />
          <ToggleRow
            label="启用状态校验（防催睡）"
            hint="作业未完成时强制任务拆解；拦截并重试“去睡吧/早点休息”类回复"
            checked={settings.guardrailEnabled}
            onChange={(v) => set({ guardrailEnabled: v })}
          />
          <Field label="滑动窗口保留轮数" hint="始终保留最近 N 轮的原始对话，保证短期语气连贯">
            <Input
              type="number"
              value={settings.contextRecentRounds}
              onChange={(e) => set({ contextRecentRounds: Number(e.target.value) })}
            />
          </Field>
          <ToggleRow
            label="实时记忆（对话中提炼事实）"
            hint="对话中命中约定/偏好/重要信息时立即写入长期记忆，下一轮即可想起，无需等到每日整理"
            checked={settings.realtimeFactEnabled}
            onChange={(v) => set({ realtimeFactEnabled: v })}
          />
          <ToggleRow
            label="每日角色日程"
            hint="每天为角色生成当日作息日程并注入提示词，让言行符合身份（如学生上课时段不闲聊）"
            checked={settings.scheduleEnabled}
            onChange={(v) => set({ scheduleEnabled: v })}
          />
          <Field label="日程生成时间（小时）" hint="每天在该小时为角色生成当日日程，默认 0（即 0 点），0-23">
            <Input
              type="number"
              min={0}
              max={23}
              value={settings.scheduleGenerateHour}
              onChange={(e) => set({ scheduleGenerateHour: Number(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>文件与服务器 Agent</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="处理用户发来的文件"
            hint="用户上传文本类文件（txt/md/json/csv/日志/代码等）时自动解析为本轮对话上下文"
            checked={settings.fileHandlingEnabled}
            onChange={(v) => set({ fileHandlingEnabled: v })}
          />
          <Field label="单文件大小上限（字节）" hint="超过则跳过，默认 2000000">
            <Input
              type="number"
              value={settings.fileMaxBytes}
              onChange={(e) => set({ fileMaxBytes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Shell 触发前缀" hint="用户在聊天中以此前缀开头的消息会被直接当作 shell 命令执行，默认 /sh">
            <Input
              value={settings.agentShellPrefix}
              onChange={(e) => set({ agentShellPrefix: e.target.value })}
            />
          </Field>
          <Field label="Shell 超时（毫秒）" hint="超时后命令会被强制终止，默认 15000">
            <Input
              type="number"
              value={settings.agentShellTimeoutMs}
              onChange={(e) => set({ agentShellTimeoutMs: Number(e.target.value) })}
            />
          </Field>
          <Field label="Shell 输出字符上限" hint="超出部分会被截断，默认 3500">
            <Input
              type="number"
              value={settings.agentShellMaxOutputChars}
              onChange={(e) => set({ agentShellMaxOutputChars: Number(e.target.value) })}
            />
          </Field>
          <div className="md:col-span-2">
            <Label>命令白名单用户</Label>
            <textarea
              className="mt-1 min-h-[72px] w-full border border-rule bg-field px-3 py-2 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-stamp focus-visible:ring-1 focus-visible:ring-stamp/40"
              placeholder="允许执行服务器命令的 QQ 号，每行一个；留空则不限制"
              value={settings.agentShellAllowedUsers}
              onChange={(e) => set({ agentShellAllowedUsers: e.target.value })}
            />
            <p className="mt-1 text-[12px] text-muted">留空表示所有与 Bot 对话的用户都可触发命令前缀。</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>敏感词过滤</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="启用敏感词过滤"
            hint="命中用户消息时按下方策略处理，默认关闭"
            checked={settings.keywordFilterEnabled}
            onChange={(v) => set({ keywordFilterEnabled: v })}
          />
          <Field label="命中策略" hint="拦截：不进入模型并回复固定提示；替换：命中词替换为 * 后继续">
            <Select
              value={settings.keywordFilterAction}
              onChange={(e) => set({ keywordFilterAction: e.target.value })}
            >
              <option value="block">拦截</option>
              <option value="replace">替换为 *</option>
            </Select>
          </Field>
          <div className="md:col-span-2">
            <Label>敏感词表</Label>
            <textarea
              className="mt-1 min-h-[96px] w-full border border-rule bg-field px-3 py-2 text-[13px] text-ink outline-none placeholder:text-muted focus-visible:border-stamp focus-visible:ring-1 focus-visible:ring-stamp/40"
              placeholder="每行一个词，或用逗号 / 分号分隔"
              value={settings.keywordFilterWords}
              onChange={(e) => set({ keywordFilterWords: e.target.value })}
            />
            <p className="mt-1 text-[12px] text-muted">仅作基础过滤，非内容审查；留空则不生效。</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>记忆文件 AI 追加</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <ToggleRow
            label="允许 AI 在用户编辑过的记忆文件上追加内容"
            hint="开启后，每日记忆生成时会把新累积内容追加到文件末尾的 AI 追加区，用户原文不会被修改。还需在记忆页为具体文件打开追加开关。"
            checked={settings.memoryFileAppendEnabled}
            onChange={(v) => set({ memoryFileAppendEnabled: v })}
          />
          <ToggleRow
            label="记忆文件增量注入"
            hint="开启后，同一会话内记忆文件内容未变化时只注入占位提示，避免每轮重复占用 Token；会话超时后自动全量注入。"
            checked={settings.memoryFileIncremental}
            onChange={(v) => set({ memoryFileIncremental: v })}
          />
          <Field label="单文件注入字节上限" hint="单个记忆文件注入 system prompt 的最大字节数，超出部分保尾弃头（保留最近内容），默认 4096。">
            <Input
              type="number"
              min={512}
              value={settings.memoryFileMaxBytes}
              onChange={(e) => set({ memoryFileMaxBytes: Number(e.target.value) })}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>视觉与图片</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field
              label="视觉副模型"
              hint="主模型不支持读图时，先用该模型把图片转述为文本，再交给主模型。留空则自动选择首个已启用且支持读图的模型。"
            >
              <Select
                value={settings.visionFallbackModelId}
                onChange={(e) => set({ visionFallbackModelId: e.target.value })}
              >
                <option value="">自动选择</option>
                {models
                  .filter((m) => m.enabled && m.supportsVision)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}（{m.modelId}）
                    </option>
                  ))}
              </Select>
            </Field>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              图片会先校验真实格式（PNG / JPEG / GIF / WebP）与厂商大小上限；QQ 平台单图最多 8MB。
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 绘画</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <ToggleRow label="全局启用绘画" checked={settings.paintingEnabled} onChange={(v) => set({ paintingEnabled: v })} />
          </div>
          <Field label="全局每日绘画上限">
            <Input
              type="number"
              value={settings.paintingGlobalDailyLimit}
              onChange={(e) => set({ paintingGlobalDailyLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="每个角色每日上限">
            <Input
              type="number"
              value={settings.paintingPersonaDailyLimit}
              onChange={(e) => set({ paintingPersonaDailyLimit: Number(e.target.value) })}
            />
          </Field>
          <Field label="图片模型">
            <Input value={settings.paintingModel} onChange={(e) => set({ paintingModel: e.target.value })} />
          </Field>
          <Field label="图片 API Base">
            <Input value={settings.paintingApiBase} onChange={(e) => set({ paintingApiBase: e.target.value })} />
          </Field>
          <Field label="图片尺寸">
            <Input value={settings.paintingSize} onChange={(e) => set({ paintingSize: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field
              label={`图片 API Key${settings.paintingApiKeySet ? "（已配置，留空不修改）" : ""}`}
              hint="用于文生图接口的 API Key"
            >
              <Input
                type="password"
                value={paintingApiKey}
                onChange={(e) => setPaintingApiKey(e.target.value)}
                placeholder={settings.paintingApiKeySet ? "已配置，留空不修改" : "sk-..."}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skill 自动更新</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="GitHub 仓库地址">
            <Input value={settings.skillRepoUrl} onChange={(e) => set({ skillRepoUrl: e.target.value })} />
          </Field>
          <Field label="分支">
            <Input value={settings.skillBranch} onChange={(e) => set({ skillBranch: e.target.value })} />
          </Field>
          <Field label="更新 Cron 表达式">
            <Input value={settings.skillUpdateCron} onChange={(e) => set({ skillUpdateCron: e.target.value })} />
          </Field>
          <Field
            label={`GitHub Token${settings.githubTokenSet ? "（已配置，留空不修改）" : ""}`}
            hint="私有仓库需要"
          >
            <Input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={settings.githubTokenSet ? "已配置，留空不修改" : "ghp_..."}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="hidden justify-end lg:flex">
        <Button onClick={save} disabled={saving}>
          <Save className="h-3.5 w-3.5" /> {saving ? "保存中" : "保存设置"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>系统信息与运维操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-[13px] md:grid-cols-4">
            <div className="border border-rule bg-ink/[0.02] p-3">
              <div className="call-label">Node 版本</div>
              <div className="mt-1 font-mono text-[13px] text-ink">{info?.nodeVersion}</div>
            </div>
            <div className="border border-rule bg-ink/[0.02] p-3">
              <div className="call-label">内存占用</div>
              <div className="mt-1 font-mono text-[13px] text-ink">{info?.memoryRssMb} MB</div>
            </div>
            <div className="border border-rule bg-ink/[0.02] p-3">
              <div className="call-label">运行时长</div>
              <div className="mt-1 font-mono text-[13px] text-ink">{info?.uptimeSeconds}s</div>
            </div>
            <div className="border border-rule bg-ink/[0.02] p-3">
              <div className="call-label">数据目录</div>
              <div className="mt-1 truncate font-mono text-[13px] text-ink" title={info?.dataDir}>
                {info?.dataDir}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="w-full sm:w-auto" onClick={runProactive}>
              <Play className="h-3.5 w-3.5" /> 立即执行主动消息
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => api.refreshTokens().then(() => push("已刷新 Token"))}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新所有 Token
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => api.reloadBots().then(() => push("已重载 Bot 网关"))}>
              <Server className="h-3.5 w-3.5" /> 重载 Bot 网关
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>检查更新</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="w-full sm:w-auto" onClick={checkForUpdate} disabled={checkingUpdate || applyingUpdate}>
              <RefreshCw className={cn("h-3.5 w-3.5", checkingUpdate && "animate-spin")} />
              {checkingUpdate ? "检查中" : "检查更新"}
            </Button>
            {updateInfo?.canAutoUpdate !== false && (
              <Button
                className="w-full sm:w-auto"
                onClick={applyUpdateNow}
                disabled={applyingUpdate || checkingUpdate || !updateInfo?.available || updateInfo.mode !== "git"}
              >
                <Download className="h-3.5 w-3.5" />
                {applyingUpdate ? "更新中" : "一键更新"}
              </Button>
            )}
          </div>

          {updateInfo && (
            <div className="border border-rule bg-ink/[0.02] p-3.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={updateInfo.available ? "warning" : updateInfo.ok ? "success" : "destructive"}
                >
                  {updateInfo.available ? "有新版本" : updateInfo.ok ? "已是最新" : "检查失败"}
                </Badge>
                <Badge variant="secondary">
                  部署方式：{updateInfo.mode === "git" ? "Git" : updateInfo.mode === "docker" ? "Docker" : "未知"}
                </Badge>
                <span className="text-muted">{updateInfo.message}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 font-mono text-[11px] text-muted sm:grid-cols-2">
                <div className="truncate">仓库：{updateInfo.repoUrl || settings.updateRepoUrl || "-"}</div>
                <div>分支：{updateInfo.branch}</div>
                <div className="truncate" title={updateInfo.currentCommit ?? ""}>
                  当前：{updateInfo.currentCommit?.slice(0, 8) || "-"}
                </div>
                <div className="truncate" title={updateInfo.remoteCommit ?? ""}>
                  远端：{updateInfo.remoteCommit?.slice(0, 8) || "-"}
                </div>
                {updateInfo.remoteMessage && (
                  <div className="truncate sm:col-span-2" title={updateInfo.remoteMessage}>
                    最新提交：{updateInfo.remoteMessage}
                  </div>
                )}
              </div>
              {updateInfo.guidance && (
                <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all border border-rule bg-field p-2.5 font-mono text-[11px] text-muted">
                  {updateInfo.guidance}
                </pre>
              )}
            </div>
          )}

          {updateResult && updateResult.steps.length > 0 && (
            <div className="space-y-2 border border-rule p-3.5">
              {updateResult.steps.map((s, i) => (
                <div key={i} className="text-[13px]">
                  <div className={cn("font-medium", s.ok ? "text-location" : "text-alert")}>
                    {s.ok ? "OK" : "FAIL"} · {s.name}
                  </div>
                  {s.output && (
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border border-rule bg-field p-2 font-mono text-[11px] text-muted">
                      {s.output.slice(0, 4000)}
                    </pre>
                  )}
                </div>
              ))}
              {updateResult.restartRequired && (
                <p className="text-[12px] text-alert">
                  更新完成，请重启服务（如 systemd / pm2 restart 或重新执行启动命令）后生效。
                </p>
              )}
            </div>
          )}

          {updateResult && updateResult.steps.length === 0 && updateResult.guidance && (
            <div className="border border-rule p-3.5">
              <p className="text-[13px] text-muted">{updateResult.message}</p>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all border border-rule bg-field p-2.5 font-mono text-[11px] text-muted">
                {updateResult.guidance}
              </pre>
            </div>
          )}

          {updateInfo?.mode === "docker" ? (
            <p className="text-[12px] leading-relaxed text-muted">
              检测到 Docker 部署：容器内没有 Git 仓库，无法在容器内自动更新。请在宿主机项目目录执行
              {" "}
              <code className="border border-rule bg-field px-1 py-0.5 font-mono text-[11px]">docker compose build --pull && docker compose up -d</code>
              {" "}
              完成更新。版本对比基于构建时注入的提交号（GIT_COMMIT）。
            </p>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted">
              从本机 Git 仓库的 origin 拉取指定分支最新代码，随后自动安装依赖并构建。工作区有未提交改动时会中止，避免覆盖你的修改。更新后需重启服务。
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="仓库地址" hint="GitHub 仓库；Docker 部署时用于查询远端版本">
              <Input value={settings.updateRepoUrl} onChange={(e) => set({ updateRepoUrl: e.target.value })} />
            </Field>
            <Field label="跟踪分支" hint="默认 main">
              <Input value={settings.updateBranch} onChange={(e) => set({ updateBranch: e.target.value })} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Mobile sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-panel/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
        <Button onClick={save} disabled={saving} size="lg" className="w-full">
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中" : dirty ? "保存设置（有未保存更改）" : "保存设置"}
        </Button>
      </div>

      {dirty && (
        <div className="pointer-events-none fixed right-4 top-[calc(3.5rem+0.75rem)] z-20 border border-alert/50 bg-alert/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-alert lg:top-[calc(4rem+0.75rem)]">
          有未保存的更改
        </div>
      )}
    </div>
  );
}
