import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Plus,
  RefreshCw,
  ScanEye,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { DiscoveredModel, ModelRecord, ProviderGroup } from "@/lib/types";
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
import { SearchProvidersPanel } from "@/components/SearchProvidersPanel";

/** 内置预设提供商的默认地址与推荐模型（与 server 端保持一致）。 */
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

/** 提供商下拉里「自定义名称」的哨兵值（不会作为真正的 provider 存储）。 */
const CUSTOM_PROVIDER = "__custom__";

/** 是否为内置预设提供商（含 custom/mock）。 */
function isPresetProvider(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(providerDefaults, provider);
}

/** 按分组键匹配模型（同地址同组）。 */
function modelsOfGroup(models: ModelRecord[], key: string): ModelRecord[] {
  return models.filter((m) => (m.providerKey ?? m.provider) === key);
}

export function ModelsPage() {
  const { push } = useToast();
  const [tab, setTab] = useState<"models" | "search">("models");
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [editing, setEditing] = useState<ProviderGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [scanning, setScanning] = useState(false);
  const [meta, setMeta] = useState<{ ready: boolean; models: number } | null>(null);
  const [refreshingMeta, setRefreshingMeta] = useState(false);

  const load = async () => {
    const [list, g] = await Promise.all([api.models(), api.providerGroups()]);
    setModels(list);
    setGroups(g.groups);
  };

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

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (group: ProviderGroup) => {
    setEditing(group);
    setOpen(true);
  };

  const removeProvider = async (group: ProviderGroup) => {
    const count = modelsOfGroup(models, group.key).length;
    if (!confirm(`确认删除提供商「${group.label}」及其下的 ${count} 个模型？`)) return;
    try {
      const res = await api.deleteProvider({ groupKey: group.key, providerId: group.providerId, provider: group.vendor });
      push(`已删除 ${group.label}（${res.removed} 个模型）`, "success");
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const testModel = async (m: ModelRecord) => {
    push(`正在测试 ${m.name}...`);
    try {
      const res = await api.testModel(m.id);
      push(res.ok ? `连接正常：${res.reply}` : `失败：${res.message}`, res.ok ? "success" : "error");
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const filteredGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        g.addr.toLowerCase().includes(q) ||
        g.vendor.toLowerCase().includes(q),
    );
  }, [groups, filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 border-b border-rule">
        {[
          { key: "models" as const, label: "模型提供商" },
          { key: "search" as const, label: "联网搜索" },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? "border-b-2 border-ink px-3 py-2 text-[13px] font-medium text-ink"
                : "border-b-2 border-transparent px-3 py-2 text-[13px] text-muted hover:text-ink"
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "search" && <SearchProvidersPanel />}

      {tab === "models" && (
      <>
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
          <CardTitle>模型提供商</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="搜索提供商 / 地址"
                className="w-full pl-8 sm:w-56"
              />
            </div>
            <Button size="sm" variant="outline" onClick={scanVision} disabled={scanning}>
              <ScanEye className="h-3.5 w-3.5" /> {scanning ? "扫描中" : "检测读图能力"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={refreshMetadata}
              disabled={refreshingMeta}
              title="刷新 models.dev 模型元数据（读图能力的第一手依据）"
            >
              <RefreshCw className={refreshingMeta ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {meta?.ready ? `元数据 ${meta.models}` : "刷新元数据"}
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" /> 新增提供商
            </Button>
          </div>
        </CardHeader>
        {groups.length === 0 ? (
          <CardContent className="py-12 text-center font-mono text-[12px] text-muted">
            还没有提供商。点「新增提供商」添加一个上游，再从中选择要启用的模型。
          </CardContent>
        ) : filteredGroups.length === 0 ? (
          <CardContent className="py-12 text-center font-mono text-[12px] text-muted">没有匹配的提供商。</CardContent>
        ) : (
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredGroups.map((g) => (
              <ProviderCard
                key={g.key}
                group={g}
                models={modelsOfGroup(models, g.key)}
                onEdit={() => openEdit(g)}
                onDelete={() => removeProvider(g)}
                onTest={testModel}
              />
            ))}
          </CardContent>
        )}
      </Card>

      <ProviderModal
        open={open}
        group={editing}
        models={models}
        onClose={() => setOpen(false)}
        onSaved={async (msg) => {
          push(msg, "success");
          await load();
        }}
        onError={(msg) => push(msg, "error")}
        onNotice={(msg) => push(msg)}
      />
      </>
      )}
    </div>
  );
}

/** 单个提供商卡片：展示规模信息与快捷操作。 */
function ProviderCard({
  group,
  models,
  onEdit,
  onDelete,
  onTest,
}: {
  group: ProviderGroup;
  models: ModelRecord[];
  onEdit: () => void;
  onDelete: () => void;
  onTest: (m: ModelRecord) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sample = models[0];
  const enabledCount = models.filter((m) => m.enabled).length;

  return (
    <div className="flex flex-col border border-rule bg-paper">
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 shrink-0">
          <ModelIcon modelId={sample?.modelId ?? ""} name={group.label} providerName={group.vendor} size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-[13.5px] font-medium text-ink">{group.label}</span>
            {group.known ? <Badge variant="secondary">官方</Badge> : <Badge variant="warning">自定义</Badge>}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted" title={group.addr || group.vendor}>
            {group.addr || `provider:${group.vendor}`}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 font-mono text-[11px] text-muted">
        <span>{group.models} 个模型</span>
        <span>{enabledCount} 启用</span>
        <span>{group.credentials} 个密钥</span>
        {group.visionModels > 0 && <span className="text-stamp">{group.visionModels} 支持读图</span>}
      </div>
      <div className="mt-3 flex items-center gap-1 border-t border-rule px-2 py-2">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Settings2 className="h-3.5 w-3.5" /> 管理模型
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          disabled={models.length === 0}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} 概览
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onDelete} aria-label="删除提供商">
          <Trash2 className="h-3.5 w-3.5 text-alert" />
        </Button>
      </div>
      {expanded && (
        <div className="border-t border-rule bg-ink/[0.02]">
          {models.map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b border-rule px-4 py-2 text-[12.5px] last:border-0">
              <ModelIcon modelId={m.modelId} name={m.name} />
              <span className="truncate font-mono text-[11.5px] text-ink">{m.modelId}</span>
              {m.supportsVision && <Badge variant="success">读图</Badge>}
              {!m.enabled && <Badge variant="secondary">停用</Badge>}
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onTest(m)} aria-label="测试">
                <FlaskConical className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 提供商新增 / 编辑弹窗：提供商级配置 + 模型选择（检测拉取与手动添加）。 */
function ProviderModal({
  open,
  group,
  models,
  onClose,
  onSaved,
  onError,
  onNotice,
}: {
  open: boolean;
  group: ProviderGroup | null;
  models: ModelRecord[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const isEdit = !!group;

  const [form, setForm] = useState<any>({
    provider: "deepseek",
    apiBase: providerDefaults.deepseek.base,
    apiKey: "",
    apiKeySet: false,
    temperature: 0.8,
    maxTokens: 2048,
    supportsVision: false,
  });
  const [members, setMembers] = useState<ModelRecord[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [pending, setPending] = useState<{ modelId: string; name?: string }[]>([]);
  const [manual, setManual] = useState("");

  // 打开时按创建 / 编辑初始化表单（编辑时复用原有名称/Base/Key/参数）
  useEffect(() => {
    if (!open) return;
    setDiscovered(null);
    setModelSearch("");
    setPending([]);
    setManual("");
    setRemoved(new Set());
    if (isEdit && group) {
      setForm({
        provider: group.vendor,
        apiBase: group.addr ? `https://${group.addr}` : "",
        apiKey: "",
        apiKeySet: !!group.apiKeySet,
        temperature: 0.8,
        maxTokens: 2048,
        supportsVision: false,
      });
      setMembers(modelsOfGroup(models, group.key));
    } else {
      setForm({
        provider: "deepseek",
        apiBase: providerDefaults.deepseek.base,
        apiKey: "",
        apiKeySet: false,
        temperature: 0.8,
        maxTokens: 2048,
        supportsVision: false,
      });
      setMembers([]);
    }
  }, [open, isEdit, group]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickProvider = (picked: string) => {
    if (picked === CUSTOM_PROVIDER) {
      setForm((f: any) => ({ ...f, provider: isPresetProvider(f.provider) ? "" : f.provider }));
      return;
    }
    const d = providerDefaults[picked];
    setForm((f: any) => ({ ...f, provider: picked, apiBase: d?.base ?? "" }));
    setDiscovered(null);
  };

  const discover = async () => {
    if (!form.provider) {
      onError("请先填写提供商名称");
      return;
    }
    setDiscovering(true);
    try {
      const res = await api.discoverProvider({
        provider: form.provider,
        apiKey: form.apiKey || undefined,
        apiBase: form.apiBase || undefined,
      });
      setDiscovered(res.models);
      const existing = new Set([...members.map((m) => m.modelId), ...pending.map((p) => p.modelId)]);
      setPending(res.models.filter((m) => !existing.has(m.id)).map((m) => ({ modelId: m.id, name: m.id })));
      onNotice(
        res.reusedKey
          ? `检测到 ${res.models.length} 个可用模型（已复用已保存的密钥）`
          : `检测到 ${res.models.length} 个可用模型`,
      );
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setDiscovering(false);
    }
  };

  const addManual = () => {
    const id = manual.trim();
    if (!id) return;
    const exists =
      members.some((m) => m.modelId === id && !removed.has(m.id)) || pending.some((p) => p.modelId === id);
    if (exists) {
      onError(`模型 ${id} 已存在`);
      return;
    }
    setPending((p) => [...p, { modelId: id, name: id }]);
    setManual("");
  };

  const togglePending = (id: string) => {
    setPending((prev) => prev.filter((p) => p.modelId !== id));
  };

  const save = async () => {
    if (!form.provider) {
      onError("请填写提供商名称");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && group) {
        const res = await api.updateProvider({
          groupKey: group.key,
          providerId: group.providerId,
          provider: form.provider,
          apiBase: form.apiBase,
          apiKey: form.apiKey || undefined,
          addModels: pending,
          removeModelIds: Array.from(removed),
        });
        onSaved(`已更新：新增 ${res.added.length} 个，删除 ${res.removed} 个`);
      } else {
        const res = await api.createProvider({
          provider: form.provider,
          apiBase: form.apiBase,
          apiKey: form.apiKey,
          temperature: form.temperature,
          maxTokens: form.maxTokens,
          supportsVision: form.supportsVision,
          models: pending,
        });
        onSaved(
          res.created.length
            ? `已创建提供商，加入 ${res.created.length} 个模型${res.skipped.length ? `，跳过 ${res.skipped.length} 个` : ""}`
            : "已创建提供商（暂未添加模型，可稍后进入「管理模型」添加）",
        );
      }
      onClose();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const filteredDiscovered = useMemo(() => {
    if (!discovered) return [];
    const q = modelSearch.trim().toLowerCase();
    if (!q) return discovered;
    return discovered.filter((m) => m.id.toLowerCase().includes(q));
  }, [discovered, modelSearch]);

  const visibleMembers = members.filter((m) => !removed.has(m.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `管理提供商 · ${group?.label ?? ""}` : "新增提供商"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {isEdit ? "保存更改" : "创建提供商"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>提供商</Label>
            <Select value={isPresetProvider(form.provider) ? form.provider : CUSTOM_PROVIDER} onChange={(e) => onPickProvider(e.target.value)}>
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
            <Label>API Base</Label>
            <Input value={form.apiBase} onChange={(e) => setForm({ ...form, apiBase: e.target.value })} placeholder="留空使用默认地址" />
          </div>
        </div>

        <div className="flex items-center gap-2 border border-rule bg-ink/[0.02] px-3 py-2">
          <ModelIcon modelId="" name={form.provider} providerName={form.provider} size={20} />
          <span className="text-[12px] text-muted">
            图标由「提供商名称」自动识别（含 openai / gemini / deepseek 等关键字即匹配），名称可自行修改。
          </span>
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
          <Label>
            API Key{" "}
            {isEdit && (
              <span className="normal-case tracking-normal">
                （留空表示沿用已保存的{form.apiKeySet ? "" : "（当前未配置）"}）
              </span>
            )}
          </Label>
          <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </div>

        <div className="border border-rule bg-ink/[0.02] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-display text-[13px] font-medium uppercase tracking-[0.06em] text-ink">选择模型</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-muted">
                点「检测可用模型」按上方配置拉取上游列表，或手动输入模型 ID。
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={discover} disabled={discovering}>
              <RefreshCw className={discovering ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {discovering ? "检测中" : "检测可用模型"}
            </Button>
          </div>

          {discovered && (
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <Input
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder={`在 ${discovered.length} 个模型中搜索`}
                  className="pl-8"
                />
              </div>
              <div className="max-h-56 overflow-y-auto border border-rule">
                {filteredDiscovered.length === 0 && (
                  <div className="px-3 py-6 text-center font-mono text-[11px] text-muted">没有匹配的模型</div>
                )}
                {filteredDiscovered.map((m) => {
                  const checked = pending.some((p) => p.modelId === m.id);
                  const already = members.some((x) => x.modelId === m.id && !removed.has(x.id));
                  return (
                    <button
                      key={m.id}
                      type="button"
                      disabled={already}
                      onClick={() =>
                        checked ? togglePending(m.id) : setPending((p) => [...p, { modelId: m.id, name: m.id }])
                      }
                      className={`flex w-full items-center gap-2.5 border-b border-rule px-3 py-2 text-left text-[13px] transition-colors last:border-0 ${
                        already ? "cursor-not-allowed opacity-50" : "hover:bg-ink/[0.03]"
                      } ${checked ? "bg-stamp/[0.07]" : ""}`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center border ${
                          checked ? "border-stamp bg-stamp text-paper" : "border-rule"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <ModelIcon modelId={m.id} />
                      <span className="truncate font-mono text-[11.5px]">{m.id}</span>
                      {already ? (
                        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">已添加</span>
                      ) : (
                        m.ownedBy && <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">{m.ownedBy}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
              placeholder="手动输入模型 ID，回车添加"
            />
            <Button size="sm" variant="outline" onClick={addManual} disabled={!manual.trim()}>
              <Plus className="h-3.5 w-3.5" /> 添加
            </Button>
          </div>
        </div>

        {isEdit && visibleMembers.length > 0 && (
          <div>
            <Label>该提供商下的模型（{visibleMembers.length}）</Label>
            <div className="max-h-48 overflow-y-auto border border-rule">
              {visibleMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-2 border-b border-rule px-3 py-2 text-[12.5px] last:border-0">
                  <ModelIcon modelId={m.modelId} name={m.name} />
                  <span className="truncate font-mono text-[11.5px]">{m.modelId}</span>
                  {m.supportsVision && <Badge variant="success">读图</Badge>}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setRemoved((prev) => new Set(prev).add(m.id))}
                    aria-label="移除"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-alert" />
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted">保存时移除标记的模型；移除操作在点击「保存更改」后生效。</p>
          </div>
        )}

        {pending.length > 0 && (
          <div>
            <Label>待新增模型（{pending.length}）</Label>
            <div className="flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <button
                  key={p.modelId}
                  type="button"
                  onClick={() => togglePending(p.modelId)}
                  className="inline-flex items-center gap-1.5 border border-rule bg-ink/[0.02] px-2 py-1 font-mono text-[11px] text-ink hover:bg-ink/[0.05]"
                >
                  {p.modelId}
                  <Trash2 className="h-3 w-3 text-alert" />
                </button>
              ))}
            </div>
          </div>
        )}

        {!isEdit && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>默认温度</Label>
              <Input
                type="number"
                step="0.1"
                value={form.temperature}
                onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>默认最大 Token</Label>
              <Input
                type="number"
                value={form.maxTokens}
                onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch checked={form.supportsVision} onCheckedChange={(v) => setForm({ ...form, supportsVision: v })} />
          <span className="text-[13px]">
            新模型默认支持读图（多模态）
            <span className="ml-1 font-mono text-[11px] text-muted">可在检测后自动改写</span>
          </span>
        </div>
      </div>
    </Modal>
  );
}
