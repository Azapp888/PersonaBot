import { useEffect, useState } from "react";
import { CloudDownload, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Skill } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

const typeVariant: Record<string, any> = { builtin: "default", custom: "secondary", github: "success" };

export function SkillsPage() {
  const { push } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: "", description: "", content: "" });
  const [repoUrl, setRepoUrl] = useState("");
  const [token, setToken] = useState("");
  const [syncing, setSyncing] = useState(false);

  const load = () => api.skills().then(setSkills);
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", content: "" });
    setOpen(true);
  };

  const openEdit = (s: Skill) => {
    setEditing(s);
    setForm({ name: s.name, description: s.description, content: s.content });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.content) return push("名称和内容必填", "error");
    if (editing) await api.updateSkill(editing.id, form);
    else await api.createSkill({ ...form, type: "custom" });
    push("已保存", "success");
    setOpen(false);
    await load();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncSkills(repoUrl || undefined, token || undefined);
      push(res.updated > 0 ? `同步完成，更新 ${res.updated} 个技能` : `未更新，错误：${res.errors.join("; ")}`, res.updated > 0 ? "success" : "error");
      await load();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>从 GitHub 自动更新 Skill</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>仓库地址</Label>
            <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/user/skills-repo" />
          </div>
          <div>
            <Label>访问 Token（私有仓库可选）</Label>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_..." />
          </div>
          <div className="flex items-end">
            <Button onClick={sync} disabled={syncing} className="w-full">
              <CloudDownload className="h-3.5 w-3.5" /> {syncing ? "同步中" : "立即同步"}
            </Button>
          </div>
          <p className="font-mono text-[12px] leading-relaxed text-muted md:col-span-4">
            约定：仓库中的每个 .md 文件会被同步为一个 Skill，文件名作为技能名。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>技能插件</CardTitle>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> 新建技能
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {skills.map((s) => (
            <div key={s.id} className="border border-rule bg-paper p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[14px] font-medium tracking-[0.02em] text-ink">{s.name}</span>
                  <Badge variant={typeVariant[s.type]}>{s.type}</Badge>
                </div>
                <Switch checked={s.enabled} onCheckedChange={(v) => api.updateSkill(s.id, { enabled: v }).then(load)} />
              </div>
              <p className="mt-2 line-clamp-2 text-[12px] text-muted">{s.description}</p>
              <div className="mt-3 flex items-center justify-between border-t border-rule pt-3">
                <span className="font-mono text-[11px] text-muted">更新于 {formatDateTime(s.updatedAt)}</span>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(s)} aria-label="编辑">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {s.type !== "builtin" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (confirm(`确认删除技能「${s.name}」？`)) api.deleteSkill(s.id).then(load);
                      }}
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-alert" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        title={editing ? "编辑技能" : "新建技能"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button onClick={save}>保存</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label>技能名称</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>描述</Label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label>技能内容（注入到 System Prompt）</Label>
            <Textarea className="min-h-[220px]" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
