import { useEffect, useState } from "react";
import { Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Bot, Persona } from "@/lib/types";
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
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

const stateMap: Record<string, { label: string; variant: any }> = {
  connected: { label: "已连接", variant: "success" },
  connecting: { label: "连接中", variant: "warning" },
  reconnecting: { label: "重连中", variant: "warning" },
  error: { label: "异常", variant: "destructive" },
  stopped: { label: "已停止", variant: "secondary" },
};

const emptyForm = { name: "", appId: "", clientSecret: "", personaId: "", enabled: true, agentEnabled: false };

export function BotsPage() {
  const { push } = useToast();
  const [bots, setBots] = useState<Bot[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [b, p] = await Promise.all([api.botStatus(), api.personas()]);
    setBots(b);
    setPersonas(p);
  };

  useEffect(() => {
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 10000);
    return () => clearInterval(timer);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (bot: Bot) => {
    setEditing(bot);
    setForm({
      name: bot.name,
      appId: bot.appId,
      clientSecret: "",
      personaId: bot.personaId ?? "",
      enabled: bot.enabled,
      agentEnabled: bot.agentEnabled,
    });
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        appId: form.appId,
        personaId: form.personaId || null,
        enabled: form.enabled,
        agentEnabled: form.agentEnabled,
      };
      if (form.clientSecret) payload.clientSecret = form.clientSecret;
      if (editing) {
        await api.updateBot(editing.id, payload);
        push("Bot 已更新", "success");
      } else {
        if (!form.clientSecret) {
          push("新建 Bot 需要填写 ClientSecret", "error");
          setSaving(false);
          return;
        }
        await api.createBot(payload);
        push("Bot 已创建", "success");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>接入指引</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            1. 前往 QQ 开放平台（<span className="text-primary">q.qq.com</span>）创建机器人，选择「QQ 机器人」并完成主体认证。
          </p>
          <p>2. 在「开发设置」中获取 AppID 与 ClientSecret。</p>
          <p>3. 在下方点击「新建 Bot」，填写 AppID、ClientSecret 并绑定一个角色人格。</p>
          <p>4. 本系统通过 WebSocket 网关接收事件，无需配置公网回调地址。</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bot 列表</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => api.reloadBots().then(load).then(() => push("已重载网关"))}>
              <RefreshCw className="h-4 w-4" /> 重载
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新建 Bot
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">AppID</th>
                <th className="px-4 py-3">绑定角色</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">启用</th>
                <th className="px-4 py-3">服务器 Agent</th>
                <th className="px-4 py-3">Token 过期</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => {
                const st = stateMap[bot.gatewayState ?? "stopped"] ?? stateMap.stopped;
                return (
                  <tr key={bot.id} className="border-b border-border last:border-0 dark:border-slate-800">
                    <td className="px-4 py-3 font-medium">{bot.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{bot.appId}</td>
                    <td className="px-4 py-3">{bot.personaName ?? <span className="text-muted-foreground">未绑定</span>}</td>
                    <td className="px-4 py-3">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {bot.lastError && <div className="mt-1 text-xs text-red-500">{bot.lastError}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Switch checked={bot.enabled} onCheckedChange={() => api.toggleBot(bot.id).then(load)} />
                    </td>
                    <td className="px-4 py-3">
                      {bot.agentEnabled ? (
                        <Badge variant="destructive">已启用</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">关闭</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(bot.tokenExpiresAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => api.restartBot(bot.id).then(() => push("重启中"))}>
                          <RotateCw className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(bot)}>
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`确认删除 Bot「${bot.name}」？`)) api.deleteBot(bot.id).then(load);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    还没有 Bot，点击「新建 Bot」开始接入。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? "编辑 Bot" : "新建 Bot"}
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>Bot 名称</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="用于后台识别" />
          </div>
          <div>
            <Label>AppID</Label>
            <Input value={form.appId} onChange={(e) => setForm({ ...form, appId: e.target.value })} placeholder="QQ 开放平台 AppID" />
          </div>
          <div>
            <Label>ClientSecret {editing && <span className="text-xs text-muted-foreground">（留空表示不修改）</span>}</Label>
            <Input
              type="password"
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder="QQ 开放平台 ClientSecret"
            />
          </div>
          <div>
            <Label>绑定角色</Label>
            <Select value={form.personaId} onChange={(e) => setForm({ ...form, personaId: e.target.value })}>
              <option value="">（不绑定）</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm">启用该 Bot</span>
          </div>
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
            <div className="flex items-center gap-2">
              <Switch checked={form.agentEnabled} onCheckedChange={(v) => setForm({ ...form, agentEnabled: v })} />
              <span className="text-sm font-medium">启用服务器本地 Agent（可运行 shell 命令）</span>
            </div>
            <p className="text-xs text-red-600 dark:text-red-400">
              开启后，该 Bot 可调用服务器本机 shell：用户在聊天里以「/sh 命令」触发，或由模型自主决定执行。
              请仅在可信对话场景下使用，任何能向该 Bot 发消息的人都可能触发命令执行。
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
