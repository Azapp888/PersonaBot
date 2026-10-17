import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Pencil, Plus, RefreshCw, ScanEye, Search, Trash2 } from "lucide-react";
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
import { ModelIcon } from "@/components/ModelIcon";

const providerDefaults: Record<string, { base: string; model: string }> = {
  openai: { base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { base: "https://api.anthropic.com", model: "claude-3-5-sonnet-20241022" },
  deepseek: { base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  volcengine: { base: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1-6-250615" },
  dashscope: { base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus" },
  google: { base: "https://generativelanguage.googleapis.com", model: "gemini-2.5-flash" },
  moonshot: { base: "https://api.moonshot.cn/v1", model: "kimi-k2-0905-preview" },
  zhipu: { base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-plus" },
  minimax: { base: "https://api.minimax.chat/v1", model: "MiniMax-Text-01" },
  qianfan: { base: "https://qianfan.baidubce.com/v2", model: "ernie-4.5-turbo-128k" },
  tencent: { base: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-turbo" },
  spark: { base: "https://spark-api-open.xf-yun.com/v1", model: "generalv3.5" },
  xai: { base: "https://api.x.ai/v1", model: "grok-4" },
  openrouter: { base: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  siliconflow: { base: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-VL-72B-Instruct" },
  custom: { base: "", model: "" },
  mock: { base: "", model: "mock-roleplay" },
};

const providerLabels: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  deepseek: "DeepSeek",
  volcengine: "火山引擎方舟（豆包）",
  dashscope: "阿里云百炼（通义千问）",
  google: "Google Gemini",
  moonshot: "Moonshot 月之暗面",
  zhipu: "智谱 GLM",
  minimax: "MiniMax",
  qianfan: "百度千帆（文心）",
  tencent: "腾讯混元",
  spark: "讯飞星火",
  xai: "xAI Grok",
  openrouter: "OpenRouter",
  siliconflow: "SiliconFlow 硅基流动",
  custom: "自定义（OpenAI 兼容）",
  mock: "Mock（本地联调）",
};

/** 提供商下拉里「自定义名称」的哨兵值（不会作为真正的 provider 存储）。 */
const CUSTOM_PROVIDER = "__custom__";

/** 是否为内置预设提供商（含 custom/mock）。 */
function isPresetProvider(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(providerDefaults, provider);
}

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
  const [scanning, setScanning] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addingBatch, setAddingBatch] = useState(false);
  const [meta, setMeta] = useState<{ ready: boolean; models: number } | null>(null);
  const [refreshingMeta, setRefreshingMeta] = useState(false);

  const load = () => api.models().then(setModels);
  useEffect(() => {
    load().catch(() => undefined);
    api.metadataStatus().then(setMeta).catch(() => undefined);
  }, []);

  const refreshMetadata = async () => {
    setRefreshingMeta(true);
    try {
      const res = await api.refreshMetadata();
      setMeta({ ready: res.ready, models: res.models });
      push(`元数据已刷新：${res.models} 个模型（来源 models.dev）`, "success");
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setRefreshingMeta(false);
    }
  };

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

  const scanVision = async () => {
    setScanning(true);
    try {
      // 手动点击时强制重新探测（fresh），保证结果是最新的；
      // 自动/重复扫描默认走进程内缓存，同一模型只探测一次。
      const res = await api.scanVision({ fresh: true });
      await load();
      const parts = [`共 ${res.total} 个`, `实测 ${res.probed} 个`, `更新 ${res.updated} 个`];
      if (res.unknown) parts.push(`${res.unknown} 个未能判定`);
      push(`读图能力检测完成：${parts.join("，")}`, "success");
      const visionOn = res.items.filter((i) => i.detected === true).map((i) => i.modelId);
      const tricky = res.items.filter((i) => i.detected === null || i.error);
      if (visionOn.length) push(`支持读图：${visionOn.join("、")}`);
      if (tricky.length) push(`需人工确认：${tricky.map((i) => i.modelId).join("、")}`);
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setScanning(false);
    }
  };

  const toggleSelect = (id: string) => {    setSelected((prev) => {
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

  // 模型列表：先按搜索过滤，再按「提供商地址」分组（同地址同组、不同密钥分列）
  const grouped = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    const filtered = q
      ? models.filter((m) => {
          const addr = m.providerAddr ?? "";
          return (
            m.name.toLowerCase().includes(q) ||
            m.modelId.toLowerCase().includes(q) ||
            m.provider.toLowerCase().includes(q) ||
            addr.toLowerCase().includes(q)
          );
        })
      : models;
    const map = new Map<string, { label: string; addr: string; known: boolean; items: ModelRecord[] }>();
    for (const m of filtered) {
      const key = m.providerKey ?? m.provider;
      const entry = map.get(key) ?? {
        label: m.providerLabel ?? providerLabels[m.provider] ?? m.provider,
        addr: m.providerAddr ?? "",
        known: m.providerKnown ?? false,
        items: [],
      };
      entry.items.push(m);
      map.set(key, entry);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].items.length - a[1].items.length || a[0].localeCompare(b[0]));
  }, [models, listFilter]);

  const toggleGroup = (provider: string) => setCollapsed((c) => ({ ...c, [provider]: !c[provider] }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
          <CardTitle>模型列表</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="搜索模型 / 提供商"
                className="w-full pl-8 sm:w-56"
              />
            </div>
            <Button size="sm" variant="outline" onClick={scanVision} disabled={scanning}>
              <ScanEye className="h-3.5 w-3.5" /> {scanning ? "扫描中" : "检测读图能力"}
            </Button>
            <Button size="sm" variant="outline" onClick={refreshMetadata} disabled={refreshingMeta} title="刷新 models.dev 模型元数据（读图能力的第一手依据）">
              <RefreshCw className={refreshingMeta ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {meta?.ready ? `元数据 ${meta.models}` : "刷新元数据"}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 新建模型
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-[13.5px]">
            <thead>
              <tr className="border-b border-rule text-left">
                <th className="call-label px-4 py-2.5 font-normal">名称</th>
                <th className="call-label px-4 py-2.5 font-normal">模型 ID</th>
                <th className="call-label px-4 py-2.5 font-normal">API Key</th>
                <th className="call-label px-4 py-2.5 font-normal">读图</th>
                <th className="call-label px-4 py-2.5 font-normal">温度</th>
                <th className="call-label px-4 py-2.5 font-normal">启用</th>
                <th className="call-label px-4 py-2.5 text-right font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(([key, group]) => (
                <FragmentGroup
                  key={key}
                  groupKey={key}
                  group={group}
                  collapsed={!!collapsed[key]}
                  onToggle={() => toggleGroup(key)}
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
                  <td colSpan={7} className="px-4 py-12 text-center font-mono text-[12px] text-muted">
                    还没有模型。可以先用 provider 为 mock 的模型进行本地联调。
                  </td>
                </tr>
              )}
              {models.length > 0 && grouped.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center font-mono text-[12px] text-muted">
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
                value={isPresetProvider(form.provider) ? form.provider : CUSTOM_PROVIDER}
                onChange={(e) => {
                  const picked = e.target.value;
                  if (picked === CUSTOM_PROVIDER) {
                    setForm({ ...form, provider: form.provider && !isPresetProvider(form.provider) ? form.provider : "" });
                    setDiscovered(null);
                    return;
                  }
                  const d = providerDefaults[picked];
                  setForm({ ...form, provider: picked, apiBase: d?.base ?? "", modelId: d?.model ?? form.modelId });
                  setDiscovered(null);
                }}
              >
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="volcengine">火山引擎方舟（豆包）</option>
                <option value="dashscope">阿里云百炼（通义千问）</option>
                <option value="google">Google Gemini</option>
                <option value="moonshot">Moonshot 月之暗面</option>
                <option value="zhipu">智谱 GLM</option>
                <option value="minimax">MiniMax</option>
                <option value="qianfan">百度千帆（文心）</option>
                <option value="tencent">腾讯混元</option>
                <option value="spark">讯飞星火</option>
                <option value="xai">xAI Grok</option>
                <option value="openrouter">OpenRouter</option>
                <option value="siliconflow">SiliconFlow 硅基流动</option>
                <option value="custom">自定义（OpenAI 兼容）</option>
                <option value={CUSTOM_PROVIDER}>自定义名称…</option>
                <option value="mock">Mock（本地联调）</option>
              </Select>
            </div>
            <div>
              <Label>模型 ID</Label>
              <Input value={form.modelId} onChange={(e) => setForm({ ...form, modelId: e.target.value })} placeholder="可手动填写或从下方检测结果选择" />
            </div>
          </div>
          {!isPresetProvider(form.provider) && form.provider !== CUSTOM_PROVIDER && (
            <div>
              <Label>自定义提供商名称</Label>
              <Input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="例如：公司内网网关、某某云 / 一个便于识别的名字"
              />
              <p className="mt-1 text-[12px] text-muted">
                自定义名称会原样保存；不同 API 地址的提供商会分别归类，不会因为同名而合并。
              </p>
            </div>
          )}
          <div>
            <Label>API Base</Label>
            <Input value={form.apiBase} onChange={(e) => setForm({ ...form, apiBase: e.target.value })} placeholder="留空使用默认地址" />
          </div>
          <div>
            <Label>API Key {editingId && <span className="normal-case tracking-normal">（留空表示不修改）</span>}</Label>
            <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </div>

          <div className="border border-rule bg-ink/[0.02] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-display text-[13px] font-medium uppercase tracking-[0.06em] text-ink">可用模型检测</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
                  根据上方 Provider / API Base / API Key 拉取上游模型列表{editingId ? "（API Key 留空则复用已保存的）" : ""}。
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={discover} disabled={discovering}>
                <RefreshCw className={discovering ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                {discovering ? "检测中" : "检测可用模型"}
              </Button>
            </div>

            {discovered && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
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
                      {addingBatch ? "加入中" : `加入所选（${selected.size}）`}
                    </Button>
                  </div>
                </div>
                <div className="max-h-56 overflow-y-auto border border-rule">
                  {filteredDiscovered.length === 0 && (
                    <div className="px-3 py-6 text-center font-mono text-[11px] text-muted">没有匹配的模型</div>
                  )}
                  {filteredDiscovered.map((m) => {
                    const checked = selected.has(m.id);
                    return (
                      <label
                        key={m.id}
                        className={`flex w-full cursor-pointer items-center gap-2.5 border-b border-rule px-3 py-2 text-left text-[13px] transition-colors last:border-0 hover:bg-ink/[0.03] ${
                          checked ? "bg-stamp/[0.07]" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(m.id)}
                          className="h-4 w-4 shrink-0 accent-stamp"
                        />
                        <ModelIcon modelId={m.id} />
                        <span className="truncate font-mono text-[11.5px]">{m.id}</span>
                        {m.ownedBy && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">{m.ownedBy}</span>}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[12px] leading-relaxed text-muted">
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
            <span className="text-[13px]">启用该模型</span>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.supportsVision} onCheckedChange={(v) => setForm({ ...form, supportsVision: v })} />
            <span className="text-[13px]">
              支持读图（多模态）
              <span className="ml-1 font-mono text-[11px] text-muted">开启后才会把用户图片发给该模型</span>
            </span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FragmentGroup({
  groupKey,
  group,
  collapsed,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  groupKey: string;
  group: { label: string; addr: string; known: boolean; items: ModelRecord[] };
  collapsed: boolean;
  onToggle: () => void;
  onTest: (m: ModelRecord) => void;
  onEdit: (m: ModelRecord) => void;
  onDelete: (m: ModelRecord) => void;
  onToggleEnabled: (m: ModelRecord, v: boolean) => void;
}) {
  const items = group.items;
  // 不同密钥视为不同凭据，分列展示其数量
  const credentials = new Set(items.filter((m) => m.apiKeySet).map((m) => m.id)).size;
  return (
    <>
      <tr className="border-b border-rule bg-ink/[0.035]">
        <td colSpan={7} className="px-4 py-2">
          <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted" /> : <ChevronDown className="h-3.5 w-3.5 text-muted" />}
            <ModelIcon modelId={items[0]?.modelId ?? ""} name={group.label} />
            <span className="font-display text-[12px] font-medium uppercase tracking-[0.08em] text-ink">{group.label}</span>
            {!group.known && <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-alert">未识别地址</span>}
            <span className="truncate font-mono text-[11px] text-muted">{group.addr || groupKey}</span>
            <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
              {items.length} 个模型 · {credentials} 个凭据
            </span>
          </button>
        </td>
      </tr>
      {!collapsed &&
        items.map((m) => (
          <tr key={m.id} className="border-b border-rule last:border-0">
            <td className="px-4 py-3 font-medium text-ink">
              <span className="inline-flex items-center gap-2">
                <ModelIcon modelId={m.modelId} name={m.name} />
                {m.name}
              </span>
            </td>
            <td className="px-4 py-3 font-mono text-[11.5px] text-muted">{m.modelId}</td>
            <td className="px-4 py-3">{m.apiKeySet ? <Badge variant="success">已配置</Badge> : <Badge variant="warning">未配置</Badge>}</td>
            <td className="px-4 py-3">
              {m.supportsVision ? <Badge variant="success">支持</Badge> : <Badge variant="secondary">不支持</Badge>}
            </td>
            <td className="px-4 py-3 font-mono text-[11.5px] text-muted">{m.temperature}</td>
            <td className="px-4 py-3">
              <Switch checked={m.enabled} onCheckedChange={(v) => onToggleEnabled(m, v)} />
            </td>
            <td className="px-4 py-3">
              <div className="flex justify-end gap-1">
                <Button variant="ghost" size="sm" onClick={() => onTest(m)} aria-label="测试">
                  <FlaskConical className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onEdit(m)} aria-label="编辑">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(m)} aria-label="删除">
                  <Trash2 className="h-3.5 w-3.5 text-alert" />
                </Button>
              </div>
            </td>
          </tr>
        ))}
    </>
  );
}
