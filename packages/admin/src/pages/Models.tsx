import { useEffect, useState } from "react";
import { FlaskConical, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelRecord } from "@/lib/types";
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

const providerDefaults: Record<string, { base: string; model: string }> = {
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  anthropic: { base: "https://api.anthropic.com", model: "claude-3-5-sonnet-20241022" },
  custom: { base: "", model: "" },
  mock: { base: "", model: "mock-roleplay" },
};

const empty = { name: "", provider: "deepseek", apiKey: "", apiBase: "", modelId: "deepseek-chat", temperature: 0.8, maxTokens: 2048, enabled: true };

export function ModelsPage() {
  const { push } = useToast();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...empty });
  const [saving, setSaving] = useState(false);

  const load = () => api.models().then(setModels);
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...empty });
    setOpen(true);
  };

  const openEdit = (m: ModelRecord) => {
    setEditingId(m.id);
    setForm({ ...m, apiKey: "" });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: any = { ...form };
      if (!payload.apiKey) delete payload.apiKey;
      if (editingId) await api.updateModel(editingId, payload);
      else await api.createModel(payload);
      push("已保存", "success");
      setOpen(false);
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const test = async (m: ModelRecord) => {
    push(`正在测试 ${m.name}...`);
    try {
      const res = await api.testModel(m.id);
      push(res.ok ? `连接正常：${res.reply}` : `失败：${res.message}`, res.ok ? "success" : "error");
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>模型列表</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建模型
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">模型 ID</th>
                <th className="px-4 py-3">API Key</th>
                <th className="px-4 py-3">温度</th>
                <th className="px-4 py-3">启用</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 dark:border-slate-800">
                  <td className="px-4 py-3 font-medium">{m.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="secondary">{m.provider}</Badge>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{m.modelId}</td>
                  <td className="px-4 py-3">{m.apiKeySet ? <Badge variant="success">已配置</Badge> : <Badge variant="warning">未配置</Badge>}</td>
                  <td className="px-4 py-3">{m.temperature}</td>
                  <td className="px-4 py-3">
                    <Switch
                      checked={m.enabled}
                      onCheckedChange={(v) => api.updateModel(m.id, { enabled: v }).then(load)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => test(m)}>
                        <FlaskConical className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (confirm(`确认删除模型「${m.name}」？`)) api.deleteModel(m.id).then(load);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    还没有模型。可以先用 provider 为 mock 的模型进行本地联调。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editingId ? "编辑模型" : "新建模型"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={saving}>
              保存
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>模型名称</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="用于后台识别" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onChange={(e) => {
                  const provider = e.target.value;
                  const d = providerDefaults[provider];
                  setForm({ ...form, provider, apiBase: d?.base ?? "", modelId: d?.model ?? form.modelId });
                }}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="custom">自定义（OpenAI 兼容）</option>
                <option value="mock">Mock（本地联调）</option>
              </Select>
            </div>
            <div>
              <Label>模型 ID</Label>
              <Input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>API Base</Label>
            <Input value={form.apiBase} onChange={(e) => setForm({ ...form, apiBase: e.target.value })} placeholder="留空使用默认地址" />
          </div>
          <div>
            <Label>API Key {editingId && <span className="text-xs text-muted-foreground">（留空表示不修改）</span>}</Label>
            <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>温度</Label>
              <Input type="number" step="0.1" value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })} />
            </div>
            <div>
              <Label>最大 Token</Label>
              <Input type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm">启用该模型</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
