import { useEffect, useState } from "react";
import { Plus, RefreshCw, RotateCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Bot, ModelRecord, Persona } from "@/lib/types";
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
  connected: { label: "在线", variant: "success" },
  connecting: { label: "连接中", variant: "warning" },
  reconnecting: { label: "重连中", variant: "warning" },
  error: { label: "异常", variant: "destructive" },
  stopped: { label: "停止", variant: "secondary" },
};

const emptyForm = {
  name: "",
  appId: "",
  clientSecret: "",
  personaId: "",
  modelId: "",
  enabled: true,
  agentEnabled: false,
  proactiveEnabled: false,
  proactiveMaxMessages: 3,
};

export function BotsPage() {
  const { push } = useToast();
  const [bots, setBots] = useState<Bot[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [b, p, m] = await Promise.all([api.botStatus(), api.personas(), api.models()]);
    setBots(b);
    setPersonas(p);
    setModels(m);
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
      modelId: bot.modelId ?? "",
      enabled: bot.enabled,
      agentEnabled: bot.agentEnabled,
      proactiveEnabled: bot.proactiveEnabled,
      proactiveMaxMessages: bot.proactiveMaxMessages,
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
        modelId: form.modelId || null,
        enabled: form.enabled,
        agentEnabled: form.agentEnabled,
        proactiveEnabled: form.proactiveEnabled,
        proactiveMaxMessages: form.proactiveMaxMessages,
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
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>接入指引</CardTitle>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">4 步</span>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5 text-[13px] leading-relaxed text-muted">
            <li>1. 前往 QQ 开放平台（q.qq.com）创建机器人，选择「QQ 机器人」并完成主体认证。</li>
            <li>2. 在「开发设置」中获取 AppID 与 ClientSecret。</li>
            <li>3. 点击「新建 Bot」，填写 AppID、ClientSecret 并绑定一个角色人格。</li>
            <li>4. 本系统通过 WebSocket 网关接收事件，无需配置公网回调地址。</li>
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bot 列表</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => api.reloadBots().then(load).then(() => push("已重载网关"))}>
              <RefreshCw className="h-3.5 w-3.5" /> 重载
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 新建 Bot
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="call-label px-4 py-2.5 font-normal">名称</th>
                <th className="call-label px-4 py-2.5 font-normal">AppID</th>
                <th className="call-label px-4 py-2.5 font-normal">绑定角色</th>
                <th className="call-label px-4 py-2.5 font-normal">使用模型</th>
                <th className="call-label px-4 py-2.5 font-normal">状态</th>
                <th className="call-label px-4 py-2.5 font-normal">启用</th>
                <th className="call-label px-4 py-2.5 font-normal">Agent</th>
                <th className="call-label px-4 py-2.5 font-normal">主动消息</th>
                <th className="call-label px-4 py-2.5 font-normal">Token 过期</th>
                <th className="call-label px-4 py-2.5 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {bots.map((bot) => {
                const st = stateMap[bot.gatewayState ?? "stopped"] ?? stateMap.stopped;
                return (
                  <tr key={bot.id} className="border-b border-rule last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{bot.name}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-muted">{bot.appId}</td>
                    <td className="px-4 py-3">{bot.personaName ?? <span className="text-muted">未绑定</span>}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px]">
                      {bot.modelName ?? <span className="font-sans text-muted">跟随默认</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={st.variant}>{st.label}</Badge>
                      {bot.lastError && <div className="mt-1 font-mono text-[10.5px] text-alert">{bot.lastError}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <Switch checked={bot.enabled} onCheckedChange={() => api.toggleBot(bot.id).then(load)} />
                    </td>
                    <td className="px-4 py-3">
                      {bot.agentEnabled ? (
                        <Badge variant="warning">已启用</Badge>
                      ) : (
                        <span className="font-mono text-[11px] text-muted">关闭</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {bot.proactiveEnabled ? (
                        <span className="font-mono text-[11px] text-ink">开启 · 每轮 {bot.proactiveMaxMessages} 条</span>
                      ) : (
                        <span className="font-mono text-[11px] text-muted">关闭</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-muted">{formatDateTime(bot.tokenExpiresAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => api.restartBot(bot.id).then(() => push("重启中"))} aria-label="重启">
                          <RotateCw className="h-3.5 w-3.5" />
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
                          aria-label="删除"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-alert" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {bots.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center font-mono text-[12px] text-muted">
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
              {saving ? "保存中" : "保存"}
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
            <Label>ClientSecret {editing && <span className="normal-case tracking-normal">（留空表示不修改）</span>}</Label>
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
          <div>
            <Label>使用模型</Label>
            <Select value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })}>
              <option value="">（跟随默认模型）</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}（{m.provider}/{m.modelId}）
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              模型统一在此按 Bot 分配。留空则使用默认模型（模型管理里第一个启用的模型）。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-[13px]">启用该 Bot</span>
          </div>
          <div className="space-y-2 border border-rule bg-ink/[0.02] p-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={form.proactiveEnabled}
                onCheckedChange={(v) => setForm({ ...form, proactiveEnabled: v })}
              />
              <span className="text-[13px] font-medium text-ink">启用主动消息</span>
            </div>
            <p className="text-[12px] leading-relaxed text-muted">
              开启后，该 Bot 会按角色与用户活跃时段主动发起对话。每个 Bot 独立配置，互不影响。
            </p>
            <div>
              <Label>每个用户每轮最多主动发送条数</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={form.proactiveMaxMessages}
                onChange={(e) => setForm({ ...form, proactiveMaxMessages: Number(e.target.value) })}
              />
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                用户回复后计数重置；范围 1-10，默认 3。
              </p>
            </div>
          </div>
          <div className="space-y-2 border-l-[3px] border-alert bg-alert/10 p-3">
            <div className="flex items-center gap-2">
              <Switch checked={form.agentEnabled} onCheckedChange={(v) => setForm({ ...form, agentEnabled: v })} />
              <span className="text-[13px] font-medium text-ink">启用服务器本地 Agent（可运行 shell 命令）</span>
            </div>
            <p className="text-[12px] leading-relaxed text-alert">
              开启后，该 Bot 可调用服务器本机 shell：用户在聊天里以「/sh 命令」触发，或由模型自主决定执行。
              请仅在可信对话场景下使用，任何能向该 Bot 发消息的人都可能触发命令执行。
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
