import { useEffect, useState } from "react";
import { FlaskConical, Plus, Settings2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { SearchPreset, SearchProviderRecord, WebSearchResult } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Switch } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

/**
 * 联网搜索配置面板：列出已配置的搜索提供商，支持新增、启用、测试与删除。
 * 每个厂商只保留一条配置，重复添加等价于更新密钥。
 */
export function SearchProvidersPanel() {
  const { push } = useToast();
  const [presets, setPresets] = useState<SearchPreset[]>([]);
  const [providers, setProviders] = useState<SearchProviderRecord[]>([]);
  const [editing, setEditing] = useState<SearchProviderRecord | null>(null);
  const [open, setOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<WebSearchResult[] | null>(null);

  const load = async () => {
    const res = await api.searchProviders();
    setPresets(res.presets);
    setProviders(res.providers);
  };

  useEffect(() => {
    load().catch((err) => push((err as Error).message, "error"));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (provider: SearchProviderRecord) => {
    setEditing(provider);
    setOpen(true);
  };

  const toggle = async (provider: SearchProviderRecord, enabled: boolean) => {
    try {
      await api.updateSearchProvider(provider.id, { enabled });
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const test = async (provider: SearchProviderRecord) => {
    setTestingId(provider.id);
    setTestResults(null);
    try {
      const res = await api.testSearchProvider(provider.id, "今天的新闻");
      setTestResults(res.results ?? []);
      push(`「${provider.label}」联通正常，返回 ${res.results?.length ?? 0} 条结果`, "success");
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (provider: SearchProviderRecord) => {
    if (!confirm(`确认删除搜索提供商「${provider.label}」？绑定它的 Bot 将回退到其他启用的提供商。`)) return;
    try {
      await api.deleteSearchProvider(provider.id);
      await load();
      push("已删除", "success");
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center">
          <CardTitle>联网搜索提供商</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> 添加提供商
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-muted">
            配置后可让 Bot 在需要时效信息时自主联网搜索。搜索密钥独立保存，与模型密钥互不影响。
            同一厂商只需配置一次；Bot 未指定提供商时使用第一个启用的提供商。
          </p>
          {providers.length === 0 ? (
            <div className="border border-dashed border-rule py-10 text-center font-mono text-[12px] text-muted">
              还没有搜索提供商。添加后可在 Bot 表单里开启「联网搜索」。
            </div>
          ) : (
            <div className="space-y-2">
              {providers.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 border border-rule bg-paper p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-display text-[13.5px] font-medium text-ink">{p.label}</span>
                      {p.enabled ? <Badge variant="success">已启用</Badge> : <Badge variant="secondary">已停用</Badge>}
                      {p.apiKeySet ? (
                        <Badge variant="secondary">已配置密钥</Badge>
                      ) : (
                        <Badge variant="warning">缺少密钥</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{p.apiBase}</div>
                    {p.model && <div className="mt-0.5 truncate font-mono text-[11px] text-muted">model: {p.model}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p, v)} />
                    <Button variant="ghost" size="sm" onClick={() => test(p)} disabled={testingId === p.id}>
                      <FlaskConical className="h-3.5 w-3.5" /> {testingId === p.id ? "测试中" : "测试"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                      <Settings2 className="h-3.5 w-3.5" /> 配置
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(p)} aria-label="删除">
                      <Trash2 className="h-3.5 w-3.5 text-alert" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {testResults && (
            <div className="border border-rule bg-ink/[0.02] p-3">
              <div className="call-label mb-2">测试结果</div>
              <ol className="space-y-2">
                {testResults.map((r, i) => (
                  <li key={i} className="text-[12.5px]">
                    <div className="font-medium text-ink">{r.title}</div>
                    {r.url && <div className="break-all font-mono text-[11px] text-muted">{r.url}</div>}
                    {r.snippet && <div className="leading-relaxed text-muted">{r.snippet}</div>}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <SearchProviderModal
        open={open}
        provider={editing}
        presets={presets}
        onClose={() => setOpen(false)}
        onSaved={async (msg) => {
          push(msg, "success");
          await load();
        }}
        onError={(msg) => push(msg, "error")}
      />
    </div>
  );
}

function SearchProviderModal({
  open,
  provider,
  presets,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  provider: SearchProviderRecord | null;
  presets: SearchPreset[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const isEdit = !!provider;
  const [vendor, setVendor] = useState<string>("deepseek");
  const [apiBase, setApiBase] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const preset = presets.find((p) => p.vendor === vendor) ?? null;

  useEffect(() => {
    if (!open) return;
    if (provider) {
      setVendor(provider.vendor);
      setApiBase(provider.apiBase ?? "");
      setModel(provider.model ?? "");
      setEnabled(provider.enabled);
    } else {
      const first = presets[0];
      setVendor(first?.vendor ?? "deepseek");
      setApiBase(first?.apiBase ?? "");
      setModel(first?.model ?? "");
      setEnabled(true);
    }
    setApiKey("");
  }, [open, provider, presets]);

  const pickVendor = (next: string) => {
    setVendor(next);
    const p = presets.find((x) => x.vendor === next);
    setApiBase(p?.apiBase ?? "");
    setModel(p?.model ?? "");
  };

  const save = async () => {
    setSaving(true);
    try {
      if (isEdit && provider) {
        await api.updateSearchProvider(provider.id, {
          apiKey: apiKey || undefined,
          apiBase: apiBase || null,
          model: model || null,
          enabled,
        });
        onSaved("搜索提供商已更新");
      } else {
        await api.createSearchProvider({
          vendor,
          apiKey: apiKey || undefined,
          apiBase: apiBase || undefined,
          model: model || undefined,
          enabled,
        });
        onSaved("搜索提供商已添加");
      }
      onClose();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "配置搜索提供商" : "添加搜索提供商"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
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
          <Label>厂商</Label>
          <Select value={vendor} onChange={(e) => pickVendor(e.target.value)} disabled={isEdit}>
            {presets.map((p) => (
              <option key={p.vendor} value={p.vendor}>
                {p.label}
              </option>
            ))}
          </Select>
          {preset && (
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              {preset.description}{" "}
              <a className="text-stamp underline" href={preset.consoleUrl} target="_blank" rel="noreferrer">
                获取密钥
              </a>
            </p>
          )}
        </div>
        <div>
          <Label>API Key {isEdit && <span className="normal-case tracking-normal">（留空表示不修改）</span>}</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={preset?.keyHint ?? "API Key"}
          />
        </div>
        <div>
          <Label>API Base</Label>
          <Input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder={preset?.apiBase ?? ""} />
        </div>
        <div>
          <Label>搜索模型</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={preset?.model ?? "（该厂商无需填写）"}
            disabled={!preset?.model}
          />
          <p className="mt-1 text-[12px] leading-relaxed text-muted">仅火山方舟等需要指定执行搜索的模型。</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <span className="text-[13px]">启用该搜索提供商</span>
        </div>
      </div>
    </Modal>
  );
}
