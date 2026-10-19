import { useEffect, useState } from "react";
import { Eraser, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { ConversationDetail, Persona } from "@/lib/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Select,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

const roleLabels: Record<string, string> = {
  user: "用户",
  assistant: "角色",
  system: "系统",
};

export function ConversationsPage() {
  const { push } = useToast();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [personaId, setPersonaId] = useState("");
  const [users, setUsers] = useState<string[]>([]);
  const [userId, setUserId] = useState("");
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [purgeMemories, setPurgeMemories] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.personas().then((list) => {
      setPersonas(list);
      if (list[0]) setPersonaId(list[0].id);
    });
  }, []);

  useEffect(() => {
    if (!personaId) return;
    api.memoryUsers(personaId).then((list) => {
      setUsers(list);
      setUserId(list[0] ?? "");
    });
  }, [personaId]);

  const reload = async () => {
    if (!personaId || !userId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    try {
      setDetail(await api.conversationDetail(personaId, userId));
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload().catch(() => undefined);
  }, [personaId, userId]);

  const afterCleanup = (label: string, result: { removed: number; invalidated: number; memoriesRemoved: number }) => {
    const parts = [`删除 ${result.removed} 条消息`, `标记 ${result.invalidated} 条流水无效`];
    if (result.memoriesRemoved) parts.push(`清理 ${result.memoriesRemoved} 条记忆`);
    push(`${label}：${parts.join("，")}`, "success");
    reload().catch(() => undefined);
  };

  const deleteMessage = async (index: number) => {
    if (!detail) return;
    if (!confirm(`确认删除第 ${index + 1} 条消息？删除后无法恢复。`)) return;
    try {
      afterCleanup("已删除", await api.deleteConversationMessage(personaId, userId, index, purgeMemories));
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const deleteFrom = async (index: number) => {
    if (!detail) return;
    if (!confirm(`确认删除第 ${index + 1} 条及其后的全部消息？删除后无法恢复。`)) return;
    try {
      afterCleanup("已清空后续", await api.deleteConversationFrom(personaId, userId, index, purgeMemories));
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const reset = async () => {
    if (!detail) return;
    if (!confirm("确认重置该会话？将清空全部聊天原文、滚动摘要与状态，并把历史流水标记为无效。")) return;
    try {
      afterCleanup("已重置", await api.resetConversation(personaId, userId, purgeMemories));
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>会话管理</CardTitle>
          <Button variant="outline" size="sm" onClick={() => reload()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-2">
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
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
          <label className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
            <input
              type="checkbox"
              checked={purgeMemories}
              onChange={(e) => setPurgeMemories(e.target.checked)}
              className="h-4 w-4 accent-stamp"
            />
            同时删除受影响日期的已有记忆（日记忆与原子事实）
          </label>
        </CardContent>
      </Card>

      {detail && (
        <Card>
          <CardHeader>
            <CardTitle>
              {detail.personaName} · {detail.userId}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{detail.messages.length} 条</Badge>
              <Button variant="destructive" size="sm" onClick={reset}>
                <Eraser className="h-4 w-4" />
                重置上下文
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <div className="border border-rule bg-ink/[0.02] p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                <span>滚动摘要</span>
                <span>已摘要至第 {detail.summarizedUpto} 条</span>
                {detail.updatedAt && <span>更新于 {formatDateTime(detail.updatedAt)}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words text-muted-foreground">
                {detail.summary.trim() || "（暂无摘要）"}
              </p>
            </div>

            {!detail.messages.length && <p className="text-sm text-muted-foreground">该会话暂无消息。</p>}

            <div className="space-y-2">
              {detail.messages.map((message) => (
                <div key={message.index} className="border border-rule bg-panel">
                  <div className="flex flex-wrap items-center gap-2 border-b border-rule px-3 py-2">
                    <Badge variant={message.role === "user" ? "secondary" : "default"}>
                      {roleLabels[message.role] ?? message.role}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">#{message.index + 1}</span>
                    {message.timestamp && (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {formatDateTime(message.timestamp)}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => deleteMessage(message.index)}>
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => deleteFrom(message.index)}>
                        <Eraser className="h-3.5 w-3.5" />
                        清空后续
                      </Button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words px-3 py-2 text-sm">{message.content || "（空）"}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
