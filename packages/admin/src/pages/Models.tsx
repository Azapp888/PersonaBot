import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { DiscoveredModel, ModelRecord } from "@/lib/types";
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

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic Claude",
  custom: "自定义（OpenAI 兼容）",
  mock: "Mock（本地联调）",
};

const empty = { name: "", provider: "deepseek", apiKey: "", apiBase: "", modelId: "deepseek-chat", temperature: 0.8, maxTokens: 2048, enabled: true, supportsVision: false };

export function ModelsPage() {
  const { push } = useToast();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...empty });
  const [saving, setSaving] = useState(false);
  const [listFilter, setListFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addingBatch, setAddingBatch] = useState(false);

  const load = () => api.models().then(setModels);
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...empty });
    setDiscovered(null);
    setModelSearch("");
    setSelected(new Set());
    setOpen(true);
  };

  const openEdit = (m: ModelRecord) => {
    setEditingId(m.id);
    setForm({ ...m, apiKey: "" });
    setDiscovered(null);
    setModelSearch("");
    setSelected(new Set());
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

  const discover = async () => {
    setDiscovering(true);
    setSelected(new Set());
    try {
      const payload = { provider: form.provider, apiKey: form.apiKey || undefined, apiBase: form.apiBase || undefined };
      const res = editingId ? await api.discoverModelById(editingId, payload) : await api.discoverModels(payload);
      setDiscovered(res.models);
      push(
        res.reusedKey
          ? `检测到 ${res.models.length} 个可用模型（已复用该提供商已保存的密钥）`
          : `检测到 ${res.models.length} 个可用模型`,
        "success",
      );
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setDiscovering(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    const items = Array.from(selected).map((modelId) => ({ modelId, name: modelId }));
    setAddingBatch(true);
    try {
      const res = await api.createModelsBatch({
        provider: form.provider,
        models: items,
        apiKey: form.apiKey || undefined,
        apiBase: form.apiBase || undefined,
        temperature: form.temperature,
        maxTokens: form.maxTokens,
        enabled: form.enabled,
        supportsVision: form.supportsVision,
      });
      push(
        `已加入 ${res.created.length} 个模型${res.skipped.length ? `，跳过 ${res.skipped.length} 个已存在` : ""}${
          res.reusedKey ? "（密钥复用该提供商已保存的）" : ""
        }`,
        "success",
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setAddingBatch(false);
    }
  };

  const filteredDiscovered = useMemo(() => {
    if (!discovered) return [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return discovered;
    return discovered.filter((m) => m.id.toLowerCase().includes(q));
  }, [discovered, modelSearch]);

  // 模型列表：先按搜索过滤，再按 provider 分组汇聚
  const grouped = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => m.name.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))
      : models;
    const map = new Map<string, ModelRecord[]>();
    for (const m of filtered) {
      const arr = map.get(m.provider) ?? [];
      arr.push(m);
      map.set(m.provider, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, listFilter]);

  const toggleGroup = (provider: string) => setCollapsed((c) => ({ ...c, [provider]: !c[provider] }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>模型列表</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="搜索模型/提供商"
                className="w-full pl-8 sm:w-56"
              />
            </div>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> 新建模型
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">名称</th>
                <th className="px-4 py-3">模型 ID</th>
                <th className="px-4 py-3">API Key</th>
                <th className="px-4 py-3">读图</th>
                <th className="px-4 py-3">温度</th>
                <th className="px-4 py-3">启用</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([provider, items]) => (
                <FragmentGroup
                  key={provider}
                  provider={provider}
                  items={items}
                  collapsed={!!collapsed[provider]}
                  onToggle={() => toggleGroup(provider)}
                  onTest={test}
                  onEdit={openEdit}
                  onDelete={(m) => {
                    if (confirm(`确认删除模型「${m.name}」？`)) api.deleteModel(m.id).then(load);
                  }}
                  onToggleEnabled={(m, v) => api.updateModel(m.id, { enabled: v }).then(load)}
                />
              ))}
              {models.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    还没有模型。可以先用 provider 为 mock 的模型进行本地联调。
                  </td>
                </tr>
              )}
              {models.length > 0 && grouped.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    没有匹配的模型。
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
                  setDiscovered(null);
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
              <Input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="可手动填写或从下方检测结果选择" />
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

          <div className="rounded-lg border border-border p-3 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">可用模型检测</div>
                <div className="text-xs text-muted-foreground">
                  根据上方 Provider / API Base / API Key 拉取上游模型列表{editingId ? "（API Key 留空则复用已保存的）" : ""}。
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={discover} disabled={discovering}>
                <RefreshCw className={discovering ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {discovering ? "检测中" : "检测可用模型"}
              </Button>
            </div>

            {discovered && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder={`在 ${discovered.length} 个模型中搜索`}
                      className="pl-8"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleSelectAll(filteredDiscovered.map((m) => m.id))}
                      disabled={filteredDiscovered.length === 0}
                    >
                      {filteredDiscovered.length > 0 && filteredDiscovered.every((m) => selected.has(m.id)) ? "取消全选" : "全选"}
                    </Button>
                    <Button size="sm" onClick={addSelected} disabled={selected.size === 0 || addingBatch}>
                      {addingBatch ? "加入中..." : `加入所选（${selected.size}）`}
                    </Button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border dark:border-slate-800">
                  {filteredDiscovered.length === 0 && (
                    <div className="px-3 py-6 text-center text-xs text-muted-foreground">没有匹配的模型</div>
                  )}
                  {filteredDiscovered.map((m) => {
                    const checked = selected.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`flex w-full cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-0 hover:bg-muted dark:border-slate-800 ${
                          checked ? "bg-primary/10" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(m.id)}
                          className="h-4 w-4 shrink-0 accent-primary"
                        />
                        <span className="truncate font-mono text-xs">{m.id}</span>
                        {m.ownedBy && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{m.ownedBy}</span>}
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  勾选要加入的模型后点「加入所选」，会按当前 Provider / API Base / API Key 批量创建；已存在的会自动跳过。
                </p>
              </div>
            )}
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
          <div className="flex items-center gap-2">
            <Switch checked={form.supportsVision} onCheckedChange={(v) => setForm({ ...form, supportsVision: v })} />
            <span className="text-sm">
              支持读图（多模态）
              <span className="ml-1 text-xs text-muted-foreground">开启后才会把用户图片发给该模型</span>
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FragmentGroup({
  provider,
  items,
  collapsed,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  provider: string;
  items: ModelRecord[];
  collapsed: boolean;
  onToggle: () => void;
  onTest: (m: ModelRecord) => void;
  onEdit: (m: ModelRecord) => void;
  onDelete: (m: ModelRecord) => void;
  onToggleEnabled: (m: ModelRecord, v: boolean) => void;
}) {
  return (
    <>
      <tr className="border-b border-border bg-muted/40 dark:border-slate-800">
        <td colSpan={7} className="px-4 py-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-2 text-left text-sm font-semibold">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            <Badge variant="secondary">{providerLabels[provider] ?? provider}</Badge>
            <span className="text-xs font-normal text-muted-foreground">{items.length} 个模型</span>
          </button>
        </td>
      </tr>
      {!collapsed &&
        items.map((m) => (
          <tr key={m.id} className="border-b border-border last:border-0 dark:border-slate-800">
            <td className="px-4 py-3 font-medium">{m.name}</td>
            <td className="px-4 py-3 font-mono text-xs">{m.modelId}</td>
            <td className="px-4 py-3">{m.apiKeySet ? <Badge variant="success">已配置</Badge> : <Badge variant="warning">未配置</Badge>}</td>
            <td className="px-4 py-3">
              {m.supportsVision ? <Badge variant="success">支持</Badge> : <Badge variant="secondary">不支持</Badge>}
            </td>
            <td className="px-4 py-3">{m.temperature}</td>
            <td className="px-4 py-3">
              <Switch checked={m.enabled} onCheckedChange={(v) => onToggleEnabled(m, v)} />
            </td>
            <td className="px-4 py-3">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => onTest(m)}>
                  <FlaskConical className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onEdit(m)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(m)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </td>
          </tr>
        ))}
    </>
  );
}
