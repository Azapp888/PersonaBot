import { useEffect, useState, type ReactNode } from "react";
import { Play, RefreshCw, Save, Server } from "lucide-react";
import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3.5 transition-colors dark:border-slate-800">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SettingsPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [paintingApiKey, setPaintingApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [snapshot, setSnapshot] = useState("");

  const load = async () => {
    const s = await api.settings();
    setSettings(s);
    setSnapshot(JSON.stringify(s));
    setInfo(await api.systemInfo());
  };

  useEffect(() => {
    load().catch(() => undefined);
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

  if (!settings) return <div className="text-sm text-muted-foreground">加载中...</div>;

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
          <ToggleRow
            label="注入当前系统时间"
            hint="关闭可提升 prompt cache 命中"
            checked={settings.injectSystemTime}
            onChange={(v) => set({ injectSystemTime: v })}
          />
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
          <CardTitle>主动消息</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ToggleRow
            label="启用主动消息"
            checked={settings.proactiveEnabled}
            onChange={(v) => set({ proactiveEnabled: v })}
          />
          <Field label="一次性最多主动发送条数">
            <Input
              type="number"
              value={settings.proactiveMaxMessages}
              onChange={(e) => set({ proactiveMaxMessages: Number(e.target.value) })}
            />
          </Field>
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
          <Save className="h-4 w-4" /> {saving ? "保存中..." : "保存设置"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>系统信息与运维操作</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div className="rounded-lg bg-muted/50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">Node 版本</div>
              <div className="mt-0.5 font-medium">{info?.nodeVersion}</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">内存占用</div>
              <div className="mt-0.5 font-medium">{info?.memoryRssMb} MB</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">运行时长</div>
              <div className="mt-0.5 font-medium">{info?.uptimeSeconds}s</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 dark:bg-slate-800/50">
              <div className="text-xs text-muted-foreground">数据目录</div>
              <div className="mt-0.5 truncate font-medium" title={info?.dataDir}>
                {info?.dataDir}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => api.runProactive().then(() => push("已触发主动消息周期"))}>
              <Play className="h-4 w-4" /> 立即执行主动消息
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => api.refreshTokens().then(() => push("已刷新 Token"))}>
              <RefreshCw className="h-4 w-4" /> 刷新所有 Token
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => api.reloadBots().then(() => push("已重载 Bot 网关"))}>
              <Server className="h-4 w-4" /> 重载 Bot 网关
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Mobile sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        <Button onClick={save} disabled={saving} size="lg" className="w-full">
          <Save className="h-4 w-4" />
          {saving ? "保存中..." : dirty ? "保存设置（有未保存更改）" : "保存设置"}
        </Button>
      </div>

      {dirty && (
        <div
          className={cn(
            "pointer-events-none fixed right-4 top-[calc(3.5rem+0.75rem)] z-20 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 shadow-sm dark:bg-amber-900/50 dark:text-amber-200 lg:top-[calc(4rem+0.75rem)]",
          )}
        >
          有未保存的更改
        </div>
      )}
    </div>
  );
}
