import { useEffect, useState } from "react";
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

export function SettingsPage() {
  const { push } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [paintingApiKey, setPaintingApiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");

  const load = async () => {
    setSettings(await api.settings());
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>服务与缓存</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>管理后台端口</Label>
            <Input type="number" value={settings.adminPort} onChange={(e) => set({ adminPort: Number(e.target.value) })} />
          </div>
          <div>
            <Label>消息防抖窗口（毫秒）</Label>
            <Input
              type="number"
              value={settings.messageDebounceMs}
              onChange={(e) => set({ messageDebounceMs: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>记忆注入的最近对话条数</Label>
            <Input
              type="number"
              value={settings.memoryInjectConversationLimit}
              onChange={(e) => set({ memoryInjectConversationLimit: Number(e.target.value) })}
            />
          </div>
          <div className="flex items-end gap-2">
            <Switch checked={settings.cacheEnabled} onCheckedChange={(v) => set({ cacheEnabled: v })} />
            <span className="text-sm">启用缓存优化（前缀稳定 + 只追加会话）</span>
          </div>
          <div className="md:col-span-2">
            <Label>Bot 服务说明</Label>
            <Input value={settings.botServiceNote} onChange={(e) => set({ botServiceNote: e.target.value })} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>主动消息</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-end gap-2">
            <Switch checked={settings.proactiveEnabled} onCheckedChange={(v) => set({ proactiveEnabled: v })} />
            <span className="text-sm">启用主动消息</span>
          </div>
          <div>
            <Label>一次性最多主动发送条数</Label>
            <Input
              type="number"
              value={settings.proactiveMaxMessages}
              onChange={(e) => set({ proactiveMaxMessages: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 绘画</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-end gap-2">
            <Switch checked={settings.paintingEnabled} onCheckedChange={(v) => set({ paintingEnabled: v })} />
            <span className="text-sm">全局启用绘画</span>
          </div>
          <div>
            <Label>全局每日绘画上限</Label>
            <Input
              type="number"
              value={settings.paintingGlobalDailyLimit}
              onChange={(e) => set({ paintingGlobalDailyLimit: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>每个角色每日上限</Label>
            <Input
              type="number"
              value={settings.paintingPersonaDailyLimit}
              onChange={(e) => set({ paintingPersonaDailyLimit: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>图片模型</Label>
            <Input value={settings.paintingModel} onChange={(e) => set({ paintingModel: e.target.value })} />
          </div>
          <div>
            <Label>图片 API Base</Label>
            <Input value={settings.paintingApiBase} onChange={(e) => set({ paintingApiBase: e.target.value })} />
          </div>
          <div>
            <Label>图片尺寸</Label>
            <Input value={settings.paintingSize} onChange={(e) => set({ paintingSize: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Label>
              图片 API Key {settings.paintingApiKeySet && <span className="text-xs text-emerald-600">（已配置，留空不修改）</span>}
            </Label>
            <Input
              type="password"
              value={paintingApiKey}
              onChange={(e) => setPaintingApiKey(e.target.value)}
              placeholder="用于文生图接口的 API Key"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skill 自动更新</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>GitHub 仓库地址</Label>
            <Input value={settings.skillRepoUrl} onChange={(e) => set({ skillRepoUrl: e.target.value })} />
          </div>
          <div>
            <Label>分支</Label>
            <Input value={settings.skillBranch} onChange={(e) => set({ skillBranch: e.target.value })} />
          </div>
          <div>
            <Label>更新 Cron 表达式</Label>
            <Input value={settings.skillUpdateCron} onChange={(e) => set({ skillUpdateCron: e.target.value })} />
          </div>
          <div>
            <Label>
              GitHub Token {settings.githubTokenSet && <span className="text-xs text-emerald-600">（已配置，留空不修改）</span>}
            </Label>
            <Input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)} placeholder="私有仓库需要" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
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
            <div>
              <div className="text-xs text-muted-foreground">Node 版本</div>
              <div>{info?.nodeVersion}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">内存占用</div>
              <div>{info?.memoryRssMb} MB</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">运行时长</div>
              <div>{info?.uptimeSeconds}s</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">数据目录</div>
              <div className="truncate" title={info?.dataDir}>
                {info?.dataDir}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => api.runProactive().then(() => push("已触发主动消息周期"))}>
              <Play className="h-4 w-4" /> 立即执行主动消息
            </Button>
            <Button variant="outline" onClick={() => api.refreshTokens().then(() => push("已刷新 Token"))}>
              <RefreshCw className="h-4 w-4" /> 刷新所有 Token
            </Button>
            <Button variant="outline" onClick={() => api.reloadBots().then(() => push("已重载 Bot 网关"))}>
              <Server className="h-4 w-4" /> 重载 Bot 网关
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
