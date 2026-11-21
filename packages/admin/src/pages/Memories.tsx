import { useEffect, useRef, useState } from "react";
import { Clock, FileText, List, Pin, RefreshCw, Save, Trash2, Upload, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Memory, MemoryKind, MemoryTimeline, MemoryType, Persona } from "@/lib/types";
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
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

const typeLabels: Record<MemoryType, string> = {
  daily: "日记忆",
  three_day: "三日记忆",
  biweekly: "精简记忆（两周）",
  monthly: "月记忆",
  imported: "导入记忆",
  fact: "原子事实",
};

const kindLabels: Record<MemoryKind, string> = {
  agreement: "约定",
  preference: "偏好",
  fact: "事实",
  event: "事件",
  trivial: "琐事",
};

export function MemoriesPage() {
  const { push } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{
    name: string;
    content: string;
    userEdited: boolean;
    appendEnabled: boolean;
  } | null>(null);
  const [fileDraft, setFileDraft] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [importUserId, setImportUserId] = useState("");
  const [importText, setImportText] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 时间线视图：按日期分组 + 类型 / 类别 / 来源 / 重要性 / 置顶 / 天数筛选
  const [view, setView] = useState<"list" | "timeline">("list");
  const [timeline, setTimeline] = useState<MemoryTimeline | null>(null);
  const [tlType, setTlType] = useState("");
  const [tlKind, setTlKind] = useState("");
  const [tlOrigin, setTlOrigin] = useState("");
  const [tlMinImportance, setTlMinImportance] = useState(0);
  const [tlPinned, setTlPinned] = useState(false);
  const [tlDays, setTlDays] = useState(30);
  const [tlLoading, setTlLoading] = useState(false);
  const [importanceDraft, setImportanceDraft] = useState<Record<string, number>>({});
  const [templating, setTemplating] = useState(false);

  useEffect(() => {
    if (userId) setImportUserId(userId);
  }, [userId]);

  useEffect(() => {
    api.personas().then((p) => {
      setPersonas(p);
      if (p[0]) setPersonaId(p[0].id);
    });
  }, []);

  useEffect(() => {
    if (!personaId) return;
    api.memoryUsers(personaId).then((u) => {
      setUsers(u);
      setUserId(u[0] ?? "");
    });
  }, [personaId]);

  const reload = async () => {
    if (!personaId) return;
    setMemories(await api.memories(personaId, userId || undefined));
    if (userId) setFiles(await api.memoryFiles(personaId, userId));
  };

  const reloadTimeline = async () => {
    if (!personaId) return;
    setTlLoading(true);
    try {
      setTimeline(
        await api.memoryTimeline({
          personaId,
          userId: userId || undefined,
          type: tlType || undefined,
          kind: tlKind || undefined,
          origin: tlOrigin || undefined,
          minImportance: tlMinImportance || undefined,
          pinned: tlPinned || undefined,
          days: tlDays || undefined,
        }),
      );
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setTlLoading(false);
    }
  };

  useEffect(() => {
    if (view === "timeline") reloadTimeline().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, personaId, userId, tlType, tlKind, tlOrigin, tlMinImportance, tlPinned, tlDays]);

  useEffect(() => {
    reload().catch(() => undefined);
  }, [personaId, userId]);

  const trigger = async (type: MemoryType) => {
    if (!personaId || !userId) return push("请先选择角色和用户", "error");
    push(`正在生成${typeLabels[type]}...`);
    const res = await api.triggerMemory(personaId, userId, type);
    push(res.ok ? "生成完成" : res.message ?? "没有可总结的内容", res.ok ? "success" : "error");
    await reload();
  };

  const openFile = async (name: string) => {
    const res = await api.memoryFile(personaId, userId, name);
    setFileContent(res);
    setFileDraft(res.content);
  };

  const saveFile = async () => {
    if (!fileContent) return;
    try {
      await api.saveMemoryFile(personaId, userId, fileContent.name, fileDraft);
      push("记忆文件已保存", "success");
      await openFile(fileContent.name);
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const resetFile = async () => {
    if (!fileContent) return;
    if (!confirm(`确认放弃对 ${fileContent.name} 的手动修改，恢复为自动生成内容？`)) return;
    try {
      const res = await api.resetMemoryFile(personaId, userId, fileContent.name);
      setFileContent({ name: res.name, content: res.content, userEdited: false, appendEnabled: false });
      setFileDraft(res.content);
      push("已恢复为自动生成", "success");
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const toggleAppend = async () => {
    if (!fileContent) return;
    try {
      const res = await api.setMemoryFileAppend(personaId, userId, fileContent.name, !fileContent.appendEnabled);
      setFileContent({ ...fileContent, appendEnabled: res.appendEnabled });
      push(res.appendEnabled ? "已允许 AI 追加该文件" : "已关闭 AI 追加", "success");
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const applyTemplate = async (write: boolean) => {
    if (!personaId || !userId) return push("请先选择角色和用户", "error");
    setTemplating(true);
    try {
      const res = await api.applyMemoryTemplate(personaId, userId, !write);
      setFileContent({ name: res.name, content: res.content, userEdited: true, appendEnabled: false });
      setFileDraft(res.content);
      if (write) {
        push("已按模板整理并写入记忆文件", "success");
        setFiles(await api.memoryFiles(personaId, userId));
      } else {
        push("已生成整理结果，请在右侧「记忆文件」预览确认后保存", "success");
      }
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setTemplating(false);
    }
  };

  const runImport = async () => {    if (!personaId) return push("请先选择角色", "error");
    const uid = importUserId.trim() || userId;
    if (!uid) return push("请填写归属用户 ID", "error");

    let content = importText.trim();
    const parts: string[] = [];
    for (const f of importFiles) {
      try {
        parts.push(`\n\n----- 文件：${f.name} -----\n${await f.text()}`);
      } catch {
        push(`读取文件 ${f.name} 失败`, "error");
      }
    }
    if (parts.length) content = (content + parts.join("")).trim();
    if (content.length < 10) return push("请上传文件或粘贴至少一小段文本", "error");

    const filename = importFiles.map((f) => f.name).join(",") || "pasted.txt";
    setImporting(true);
    try {
      const res = await api.importMemory(personaId, uid, filename, content);
      if (res.ok) {
        push(`AI 已解析并新增 ${res.created} 条记忆`, "success");
        setImportText("");
        setImportFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setUsers(await api.memoryUsers(personaId));
        if (uid !== userId) setUserId(uid);
        else await reload();
      } else {
        push(res.message ?? "未解析出有效记忆", "error");
      }
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label>角色</Label>
            <Select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              <option value="">选择角色</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>用户</Label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">选择用户</option>
              {users.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={() => (view === "timeline" ? reloadTimeline() : reload())}>
              <RefreshCw className="h-3.5 w-3.5" /> 刷新
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant={view === "list" ? "default" : "outline"} onClick={() => setView("list")}>
                <List className="h-3.5 w-3.5" /> 列表
              </Button>
              <Button size="sm" variant={view === "timeline" ? "default" : "outline"} onClick={() => setView("timeline")}>
                <Clock className="h-3.5 w-3.5" /> 时间线
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>导入历史记忆</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[13px] leading-relaxed text-muted">
            上传你与「{personas.find((p) => p.id === personaId)?.name ?? "角色"}」过往的聊天记录或记忆文件（.txt / .md / .json / .csv），AI
            会自动识别关键信息并整理为记忆条目。
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Label>归属用户 ID</Label>
              <Input
                value={importUserId}
                onChange={(e) => setImportUserId(e.target.value)}
                placeholder="如 QQ openid，可填任意标识"
              />
            </div>
            <div>
              <Label>选择文件（可多选）</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.markdown,.json,.csv,.log,text/*"
                onChange={(e) => setImportFiles(Array.from(e.target.files ?? []))}
                className="block w-full cursor-pointer border border-rule bg-field text-[13px] text-ink file:mr-3 file:cursor-pointer file:border-0 file:border-r file:border-rule file:bg-ink/[0.05] file:px-3 file:py-2.5 file:font-mono file:text-[11px] file:uppercase file:tracking-[0.06em] file:text-ink"
              />
              {importFiles.length > 0 && (
                <p className="mt-1 font-mono text-[11px] text-muted">
                  已选 {importFiles.length} 个文件：{importFiles.map((f) => f.name).join("、")}
                </p>
              )}
            </div>
          </div>
          <div>
            <Label>或直接粘贴文本</Label>
            <Textarea
              className="min-h-[120px]"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="将过往聊天 / 记忆内容粘贴到这里，AI 会自动整理..."
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={runImport} disabled={importing}>
              <Upload className="h-3.5 w-3.5" /> {importing ? "AI 解析中" : "AI 解析并导入"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>手动触发总结</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["daily", "three_day", "biweekly", "monthly"] as MemoryType[]).map((t) => (
              <Button key={t} variant="outline" size="sm" onClick={() => trigger(t)}>
                <Wand2 className="h-3.5 w-3.5" /> 生成{typeLabels[t]}
              </Button>
            ))}
          </div>
          <div className="border-t border-rule pt-3">
            <p className="mb-2 text-[12px] leading-relaxed text-muted">
              「按模板整理」会让 AI 把现有记忆文件与原子事实归位到固定记忆模板（基本资料 / 关系 / 约定 / 偏好 / 时间线 / 待办 / 注意事项），
              只整理已有信息，不新增栏目。建议先预览，确认无误后再写入。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={templating} onClick={() => applyTemplate(false)}>
                <FileText className="h-3.5 w-3.5" /> {templating ? "AI 整理中…" : "按模板整理（预览）"}
              </Button>
              <Button size="sm" disabled={templating} onClick={() => applyTemplate(true)}>
                <Save className="h-3.5 w-3.5" /> 按模板整理并写入
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {view === "timeline" && (
        <Card>
          <CardHeader>
            <CardTitle>记忆时间线</CardTitle>
            <span className="font-mono text-[11px] text-muted">
              {tlLoading ? "加载中…" : `共 ${timeline?.total ?? 0} 条`}
            </span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <div>
                <Label>类型</Label>
                <Select value={tlType} onChange={(e) => setTlType(e.target.value)}>
                  <option value="">全部</option>
                  {(Object.keys(typeLabels) as MemoryType[]).map((t) => (
                    <option key={t} value={t}>
                      {typeLabels[t]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>类别</Label>
                <Select value={tlKind} onChange={(e) => setTlKind(e.target.value)}>
                  <option value="">全部</option>
                  {(Object.keys(kindLabels) as MemoryKind[]).map((k) => (
                    <option key={k} value={k}>
                      {kindLabels[k]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>来源</Label>
                <Select value={tlOrigin} onChange={(e) => setTlOrigin(e.target.value)}>
                  <option value="">全部</option>
                  <option value="daily">每日整理</option>
                  <option value="realtime">实时提炼</option>
                </Select>
              </div>
              <div>
                <Label>重要性 ≥</Label>
                <Input
                  type="number"
                  min={0}
                  max={10}
                  value={tlMinImportance}
                  onChange={(e) => setTlMinImportance(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>时间范围</Label>
                <Select value={String(tlDays)} onChange={(e) => setTlDays(Number(e.target.value))}>
                  <option value="7">最近 7 天</option>
                  <option value="30">最近 30 天</option>
                  <option value="90">最近 90 天</option>
                  <option value="0">全部</option>
                </Select>
              </div>
              <label className="flex cursor-pointer items-end gap-2 pb-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-stamp"
                  checked={tlPinned}
                  onChange={(e) => setTlPinned(e.target.checked)}
                />
                仅永久保留
              </label>
            </div>

            {(timeline?.days ?? []).length === 0 && !tlLoading && (
              <p className="font-mono text-[12px] text-muted">当前筛选条件下没有记忆。</p>
            )}

            {(timeline?.days ?? []).map((day) => (
              <div key={day.date} className="border border-rule">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule bg-ink/[0.02] px-3 py-2">
                  <span className="font-mono text-[12px] font-medium tracking-[0.04em] text-ink">{day.date}</span>
                  <span className="font-mono text-[10.5px] text-muted">
                    {day.total} 条 · 事实 {day.facts} · 置顶 {day.pinned} · 平均重要性 {day.avgImportance}
                  </span>
                </div>
                <div className="divide-y divide-rule">
                  {day.entries.map((m) => (
                    <div key={m.id} className="space-y-2 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">{typeLabels[m.type]}</Badge>
                        {m.type === "fact" && <Badge variant="secondary">{kindLabels[m.kind]}</Badge>}
                        <Badge variant={m.origin === "realtime" ? "warning" : "secondary"}>
                          {m.origin === "realtime" ? "实时提炼" : "每日整理"}
                        </Badge>
                        {m.pinned && <Badge variant="warning">永久保留</Badge>}
                        <span className="font-mono text-[10.5px] text-muted">
                          {m.userId} · 重要性 {m.importance} · {formatDateTime(m.createdAt)}
                        </span>
                      </div>
                      <Textarea
                        className="min-h-[80px]"
                        value={editing[m.id] ?? m.content}
                        onChange={(e) => setEditing({ ...editing, [m.id]: e.target.value })}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await api.updateMemoryMeta(m.id, { content: editing[m.id] ?? m.content });
                            push("已保存", "success");
                            await reloadTimeline();
                          }}
                        >
                          <Save className="h-3.5 w-3.5" /> 保存内容
                        </Button>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          className="w-20"
                          value={importanceDraft[m.id] ?? m.importance}
                          onChange={(e) => setImportanceDraft({ ...importanceDraft, [m.id]: Number(e.target.value) })}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await api.updateMemoryMeta(m.id, { importance: importanceDraft[m.id] ?? m.importance });
                            push("已更新重要性", "success");
                            await reloadTimeline();
                          }}
                        >
                          保存重要性
                        </Button>
                        <Button
                          size="sm"
                          variant={m.pinned ? "default" : "outline"}
                          title={m.pinned ? "取消永久保留" : "设为永久保留（核心记忆）"}
                          onClick={async () => {
                            await api.updateMemoryMeta(m.id, { pinned: !m.pinned });
                            push(m.pinned ? "已取消永久保留" : "已设为永久保留", "success");
                            await reloadTimeline();
                          }}
                        >
                          <Pin className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          title="删除这条记忆"
                          onClick={async () => {
                            if (!confirm("确认删除这条记忆？此操作不可撤销。")) return;
                            await api.deleteMemory(m.id);
                            push("已删除", "success");
                            await reloadTimeline();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {view === "list" && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {memories.map((m) => (
            <Card key={m.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{typeLabels[m.type]}</Badge>
                  {m.type === "fact" && <Badge variant="secondary">{kindLabels[m.kind]}</Badge>}
                  {m.type === "fact" && (
                    <span className="font-mono text-[10.5px] text-muted">重要性 {m.importance}</span>
                  )}
                  {m.pinned && <Badge variant="warning">永久保留</Badge>}
                  <span className="font-mono text-[10.5px] text-muted">{m.sourceDate}</span>
                </div>
                <div className="flex items-center gap-2">
                  {m.type === "fact" && (
                    <Button
                      size="sm"
                      variant={m.pinned ? "default" : "outline"}
                      title={m.pinned ? "取消永久保留" : "设为永久保留（核心记忆）"}
                      onClick={async () => {
                        await api.updateMemoryMeta(m.id, { pinned: !m.pinned });
                        push(m.pinned ? "已取消永久保留" : "已设为永久保留", "success");
                        await reload();
                      }}
                    >
                      <Pin className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <span className="font-mono text-[10.5px] text-muted">{formatDateTime(m.createdAt)}</span>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  className="min-h-[140px]"
                  value={editing[m.id] ?? m.content}
                  onChange={(e) => setEditing({ ...editing, [m.id]: e.target.value })}
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await api.updateMemoryMeta(m.id, { content: editing[m.id] ?? m.content });
                      push("已保存", "success");
                      await reload();
                    }}
                  >
                    <Save className="h-3.5 w-3.5" /> 保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {memories.length === 0 && <p className="font-mono text-[12px] text-muted">暂无记忆记录。</p>}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>记忆文件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {files.length === 0 && <p className="font-mono text-[12px] text-muted">暂无文件（选择用户后显示）。</p>}
            {files.map((f) => (
              <button
                key={f}
                onClick={() => openFile(f)}
                className="flex w-full items-center gap-2 border border-rule px-3 py-2 text-left text-[13px] transition-colors hover:bg-ink/[0.03]"
              >
                <FileText className="h-3.5 w-3.5 text-muted" /> <span className="font-mono text-[12px]">{f}</span>
              </button>
            ))}
            {fileContent && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted">{fileContent.name}</span>
                  {fileContent.userEdited ? (
                    <Badge variant="warning">已手动编辑</Badge>
                  ) : (
                    <Badge variant="secondary">自动生成</Badge>
                  )}
                </div>
                <Textarea
                  className="min-h-[280px] font-mono text-[11.5px]"
                  value={fileDraft}
                  onChange={(e) => setFileDraft(e.target.value)}
                />
                {fileContent.userEdited && (
                  <label className="mt-2 flex cursor-pointer items-center justify-between border border-rule px-3 py-2 text-[13px]">
                    <span>
                      允许 AI 追加
                      <span className="ml-1 font-mono text-[11px] text-muted">（保留原文，只累积新内容）</span>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-stamp"
                      checked={fileContent.appendEnabled}
                      onChange={toggleAppend}
                    />
                  </label>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={resetFile}>
                    <RefreshCw className="h-3.5 w-3.5" /> 恢复自动生成
                  </Button>
                  <Button size="sm" onClick={saveFile}>
                    <Save className="h-3.5 w-3.5" /> 保存
                  </Button>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  这三个文件会作为记忆直接注入模型；手动保存后不会被自动总结覆盖。开启「允许 AI 追加」后，每日记忆会累积到文件末尾的追加区，原文保持不变。
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      )}
    </div>
  );
}
