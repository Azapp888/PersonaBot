import { useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Save, Upload, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Memory, MemoryType, Persona } from "@/lib/types";
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
};

export function MemoriesPage() {
  const { push } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [fileContent, setFileContent] = useState<{ name: string; content: string } | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [importUserId, setImportUserId] = useState("");
  const [importText, setImportText] = useState("");
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  };

  const runImport = async () => {
    if (!personaId) return push("请先选择角色", "error");
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
            <Button variant="outline" onClick={() => reload()}>
              <RefreshCw className="h-4 w-4" /> 刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>导入历史记忆</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
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
                className="block w-full cursor-pointer rounded-md border border-border bg-background text-sm file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-muted file:px-3 file:py-2.5 file:text-sm file:font-medium dark:border-slate-700 dark:bg-slate-900"
              />
              {importFiles.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
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
              <Upload className="h-4 w-4" /> {importing ? "AI 解析中..." : "AI 解析并导入"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>手动触发总结</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(["daily", "three_day", "biweekly", "monthly"] as MemoryType[]).map((t) => (
            <Button key={t} variant="outline" size="sm" onClick={() => trigger(t)}>
              <Wand2 className="h-4 w-4" /> 生成{typeLabels[t]}
            </Button>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {memories.map((m) => (
            <Card key={m.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="default">{typeLabels[m.type]}</Badge>
                  <span className="text-xs text-muted-foreground">{m.sourceDate}</span>
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
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
                      await api.updateMemory(m.id, editing[m.id] ?? m.content);
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
          {memories.length === 0 && <p className="text-sm text-muted-foreground">暂无记忆记录。</p>}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>记忆文件</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {files.length === 0 && <p className="text-sm text-muted-foreground">暂无文件（选择用户后显示）。</p>}
            {files.map((f) => (
              <button
                key={f}
                onClick={() => openFile(f)}
                className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted dark:border-slate-800"
              >
                <FileText className="h-4 w-4" /> {f}
              </button>
            ))}
            {fileContent && (
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">{fileContent.name}</div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs dark:border-slate-800">
                  {fileContent.content}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
