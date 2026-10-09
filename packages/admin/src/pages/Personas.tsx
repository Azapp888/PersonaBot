import { useEffect, useState } from "react";
import { MessageCircle, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ModelRecord, Persona, PersonaCommand, Skill } from "@/lib/types";
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
  Textarea,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

const emptyPersona: Persona = {
  id: "",
  name: "",
  avatar: "",
  description: "",
  systemPrompt: "",
  personality: { traits: [], speakingStyle: "", catchphrases: [], emotionalTendency: "", canPaint: false },
  skills: [],
  commands: [],
  paintingConfig: { enabled: false, style: "", artistReference: "", characterDna: "" },
  modelConfig: { temperature: 0.8, maxTokens: 2048 },
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

export function PersonasPage() {
  const { push } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<Persona>({ ...emptyPersona });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [simPersona, setSimPersona] = useState<Persona | null>(null);
  const [simMessage, setSimMessage] = useState("");
  const [simReply, setSimReply] = useState("");
  const [simLoading, setSimLoading] = useState(false);

  const load = async () => {
    const [p, s, m] = await Promise.all([api.personas(), api.skills(), api.models()]);
    setPersonas(p);
    setSkills(s);
    setModels(m);
  };

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyPersona, personality: { ...emptyPersona.personality }, paintingConfig: { ...emptyPersona.paintingConfig }, modelConfig: { ...emptyPersona.modelConfig } });
    setModalOpen(true);
  };

  const openEdit = (p: Persona) => {
    setEditingId(p.id);
    setForm(JSON.parse(JSON.stringify(p)));
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name) {
      push("角色名称必填", "error");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.updatePersona(editingId, form);
        push("角色已更新", "success");
      } else {
        await api.createPersona(form);
        push("角色已创建", "success");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const updateCommand = (i: number, patch: Partial<PersonaCommand>) => {
    const commands = [...form.commands];
    commands[i] = { ...commands[i], ...patch };
    setForm({ ...form, commands });
  };

  const runSim = async () => {
    if (!simPersona || !simMessage) return;
    setSimLoading(true);
    setSimReply("");
    try {
      const res = await api.simulate(simPersona.id, "sim-user", simMessage);
      setSimReply(res.reply);
    } catch (err) {
      setSimReply(`错误：${(err as Error).message}`);
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>角色列表</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> 新建角色
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {personas.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-4 dark:border-slate-800">
              <div className="flex items-center gap-3">
                {p.avatar ? (
                  <img src={p.avatar} alt={p.name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                    {p.name.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    <Badge variant={p.enabled ? "success" : "secondary"}>{p.enabled ? "启用" : "停用"}</Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{p.description || "暂无简介"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {(p.personality.traits ?? []).slice(0, 4).map((t, i) => (
                  <Badge key={i} variant="secondary">
                    {t}
                  </Badge>
                ))}
                {(p.skills ?? []).map((s) => {
                  const skill = skills.find((sk) => sk.id === s);
                  return skill ? (
                    <Badge key={s} variant="default">
                      技能: {skill.name}
                    </Badge>
                  ) : null;
                })}
                {p.personality.canPaint && <Badge variant="warning">会画画</Badge>}
              </div>
              <div className="mt-4 flex gap-1">
                <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
                  <Pencil className="h-3.5 w-3.5" /> 编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSimPersona(p);
                    setSimMessage("");
                    setSimReply("");
                    setSimOpen(true);
                  }}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> 模拟
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`确认删除角色「${p.name}」？相关记忆与会话也会被删除。`)) api.deletePersona(p.id).then(load);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          {personas.length === 0 && <p className="text-sm text-muted-foreground">还没有角色，点击「新建角色」开始创建人格。</p>}
        </CardContent>
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        size="xl"
        title={editingId ? "编辑角色" : "新建角色"}
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
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>角色名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>头像 URL</Label>
              <Input value={form.avatar ?? ""} onChange={(e) => setForm({ ...form, avatar: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>角色简介</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </section>

          <section>
            <Label>核心人格提示词（System Prompt）</Label>
            <Textarea
              className="min-h-[140px]"
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="描述这个角色的身份、背景、与用户的关系。此部分会作为稳定前缀，保持字节级不变以优化缓存。"
            />
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>性格标签（逗号分隔）</Label>
              <Input
                value={form.personality.traits.join(",")}
                onChange={(e) =>
                  setForm({ ...form, personality: { ...form.personality, traits: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })
                }
              />
            </div>
            <div>
              <Label>口癖（逗号分隔）</Label>
              <Input
                value={form.personality.catchphrases.join(",")}
                onChange={(e) =>
                  setForm({
                    ...form,
                    personality: { ...form.personality, catchphrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) },
                  })
                }
              />
            </div>
            <div>
              <Label>说话风格</Label>
              <Input
                value={form.personality.speakingStyle}
                onChange={(e) => setForm({ ...form, personality: { ...form.personality, speakingStyle: e.target.value } })}
              />
            </div>
            <div>
              <Label>情绪倾向</Label>
              <Input
                value={form.personality.emotionalTendency}
                onChange={(e) => setForm({ ...form, personality: { ...form.personality, emotionalTendency: e.target.value } })}
              />
            </div>
          </section>

          <section>
            <Label>技能插件</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {skills.map((s) => {
                const checked = form.skills.includes(s.id);
                return (
                  <label key={s.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm dark:border-slate-800">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked ? [...form.skills, s.id] : form.skills.filter((x) => x !== s.id);
                        setForm({ ...form, skills: next });
                      }}
                    />
                    <span className="font-medium">{s.name}</span>
                    <Badge variant="secondary">{s.type}</Badge>
                  </label>
                );
              })}
              {skills.length === 0 && <p className="text-sm text-muted-foreground">暂无技能，可在「技能」页添加。</p>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <Label className="mb-0">命令池</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setForm({ ...form, commands: [...form.commands, { name: "", trigger: "", description: "", prompt: "" }] })}
              >
                <Plus className="h-3.5 w-3.5" /> 添加命令
              </Button>
            </div>
            <div className="space-y-3">
              {form.commands.map((c, i) => (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-md border border-border p-3 md:grid-cols-4 dark:border-slate-800">
                  <Input placeholder="命令名称" value={c.name} onChange={(e) => updateCommand(i, { name: e.target.value })} />
                  <Input placeholder="触发词" value={c.trigger} onChange={(e) => updateCommand(i, { trigger: e.target.value })} />
                  <Input placeholder="描述" value={c.description} onChange={(e) => updateCommand(i, { description: e.target.value })} />
                  <div className="flex gap-2">
                    <Input placeholder="注入 Prompt" value={c.prompt} onChange={(e) => updateCommand(i, { prompt: e.target.value })} />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setForm({ ...form, commands: form.commands.filter((_, idx) => idx !== i) })}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Switch
                checked={!!form.personality.canPaint}
                onCheckedChange={(v) => setForm({ ...form, personality: { ...form.personality, canPaint: v } })}
              />
              <Label className="mb-0">该角色会画画</Label>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.paintingConfig.enabled}
                  onCheckedChange={(v) => setForm({ ...form, paintingConfig: { ...form.paintingConfig, enabled: v } })}
                />
                <span className="text-sm">启用绘画功能</span>
              </div>
              <div>
                <Label>画风描述</Label>
                <Input
                  value={form.paintingConfig.style}
                  onChange={(e) => setForm({ ...form, paintingConfig: { ...form.paintingConfig, style: e.target.value } })}
                  placeholder="如 日系水彩风格"
                />
              </div>
              <div>
                <Label>画师参考</Label>
                <Input
                  value={form.paintingConfig.artistReference}
                  onChange={(e) => setForm({ ...form, paintingConfig: { ...form.paintingConfig, artistReference: e.target.value } })}
                />
              </div>
              <div>
                <Label>角色外观 DNA</Label>
                <Input
                  value={form.paintingConfig.characterDna}
                  onChange={(e) => setForm({ ...form, paintingConfig: { ...form.paintingConfig, characterDna: e.target.value } })}
                  placeholder="面部特征、发型、服装等固定描述"
                />
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <Label>使用模型</Label>
              <Select
                value={form.modelConfig.modelId ?? ""}
                onChange={(e) => setForm({ ...form, modelConfig: { ...form.modelConfig, modelId: e.target.value || undefined } })}
              >
                <option value="">（自动选择已启用模型）</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.provider}/{m.modelId})
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>温度</Label>
              <Input
                type="number"
                step="0.1"
                value={form.modelConfig.temperature ?? 0.8}
                onChange={(e) => setForm({ ...form, modelConfig: { ...form.modelConfig, temperature: Number(e.target.value) } })}
              />
            </div>
            <div>
              <Label>最大 Token</Label>
              <Input
                type="number"
                value={form.modelConfig.maxTokens ?? 2048}
                onChange={(e) => setForm({ ...form, modelConfig: { ...form.modelConfig, maxTokens: Number(e.target.value) } })}
              />
            </div>
          </section>

          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm">启用该角色</span>
          </div>
        </div>
      </Modal>

      <Modal open={simOpen} onClose={() => setSimOpen(false)} title={`模拟对话 · ${simPersona?.name ?? ""}`} size="lg">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            在本地直接与该角色对话，验证人格提示词、记忆注入与模型配置（不需要 QQ 凭据）。
          </p>
          <Textarea value={simMessage} onChange={(e) => setSimMessage(e.target.value)} placeholder="输入你想说的话..." />
          <div className="flex justify-end">
            <Button onClick={runSim} disabled={simLoading || !simMessage}>
              <Send className="h-4 w-4" /> {simLoading ? "生成中..." : "发送"}
            </Button>
          </div>
          {simReply && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm whitespace-pre-wrap dark:border-slate-800">
              {simReply}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
