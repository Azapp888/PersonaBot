import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import type { ApiKey, AppUser, Persona } from "@/lib/types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";

/**
 * 开放 API 页：签发密钥、维护外部用户。
 *
 * 每条密钥绑定「一个角色 + 一个用户」，外部应用凭密钥调用 /api/v1/chat，
 * 服务端据此决定用哪个角色、以谁的身份对话；不同用户之间的会话与记忆完全隔离。
 */
export function OpenApiPage() {
  const { push } = useToast();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [userExternalId, setUserExternalId] = useState("");
  const [userDisplayName, setUserDisplayName] = useState("");
  const [userNote, setUserNote] = useState("");

  const [keyName, setKeyName] = useState("");
  const [keyPersonaId, setKeyPersonaId] = useState("");
  const [keyUserId, setKeyUserId] = useState("");

  const load = async () => {
    const [u, k, p] = await Promise.all([api.appUsers(), api.apiKeys(), api.personas()]);
    setUsers(u);
    setKeys(k);
    setPersonas(p);
    setKeyPersonaId((prev) => prev || p[0]?.id || "");
    setKeyUserId((prev) => prev || u[0]?.externalId || "");
  };

  useEffect(() => {
    load().catch((err) => push((err as Error).message, "error"));
  }, []);

  const createUser = async () => {
    if (!userExternalId.trim()) return push("请填写用户标识", "error");
    try {
      await api.createAppUser({
        externalId: userExternalId.trim(),
        displayName: userDisplayName.trim() || undefined,
        note: userNote,
      });
      setUserExternalId("");
      setUserDisplayName("");
      setUserNote("");
      push("用户已创建", "success");
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const createKey = async () => {
    if (!keyName.trim() || !keyPersonaId || !keyUserId) {
      return push("请填写密钥名称并选择角色与用户", "error");
    }
    try {
      const res = await api.createApiKey({
        name: keyName.trim(),
        personaId: keyPersonaId,
        userId: keyUserId,
      });
      setCreatedKey(res.plaintext);
      setKeyName("");
      push("密钥已生成，请立即复制保存（只显示这一次）", "success");
      await load();
    } catch (err) {
      push((err as Error).message, "error");
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      push("已复制到剪贴板", "success");
    } catch {
      push("复制失败，请手动选中复制", "error");
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>接入说明</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[13px] leading-relaxed text-muted">
            外部应用使用 API Key 调用 <code className="font-mono text-[12px] text-ink">/api/v1/*</code>，密钥绑定角色与用户，
            调用方无需指定身份。每个用户独立拥有自己的会话与记忆，一台服务器即可服务多个用户。
          </p>
          <pre className="overflow-x-auto border border-rule bg-field px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink">
{`curl -X POST http://<你的服务器>:3000/api/v1/chat \\
  -H "Authorization: Bearer pb_xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"今天有点累"}'`}
          </pre>
          <p className="text-[12px] text-muted">
            可用接口：<code className="font-mono">GET /api/v1/me</code>、
            <code className="font-mono">GET /api/v1/persona</code>、
            <code className="font-mono">POST /api/v1/chat</code>、
            <code className="font-mono">POST /api/v1/chat/stream</code>（SSE）、
            <code className="font-mono">GET /api/v1/conversation</code>、
            <code className="font-mono">POST /api/v1/conversation/reset</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>用户管理</CardTitle>
          <span className="font-mono text-[11px] text-muted">共 {users.length} 个用户</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <Label>用户标识（externalId）</Label>
              <Input
                value={userExternalId}
                onChange={(e) => setUserExternalId(e.target.value)}
                placeholder="如 wx_openid_123"
              />
            </div>
            <div>
              <Label>显示名称</Label>
              <Input value={userDisplayName} onChange={(e) => setUserDisplayName(e.target.value)} placeholder="可选" />
            </div>
            <div>
              <Label>备注</Label>
              <Input value={userNote} onChange={(e) => setUserNote(e.target.value)} placeholder="可选" />
            </div>
            <div className="flex items-end">
              <Button onClick={createUser}>
                <Plus className="h-3.5 w-3.5" /> 新建用户
              </Button>
            </div>
          </div>

          {users.length === 0 && <p className="font-mono text-[12px] text-muted">暂无用户，先创建一个再签发密钥。</p>}
          {users.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <Users className="h-3.5 w-3.5 text-muted" />
                <span className="font-mono text-[12.5px] text-ink">{u.externalId}</span>
                <span className="text-[13px] text-ink">{u.displayName}</span>
                {u.note && <span className="text-[12px] text-muted">{u.note}</span>}
                {u.enabled ? <Badge variant="secondary">启用</Badge> : <Badge variant="warning">已停用</Badge>}
                <span className="font-mono text-[10.5px] text-muted">
                  密钥 {u.activeKeyCount ?? 0}/{u.keyCount ?? 0}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api.updateAppUser(u.id, { enabled: !u.enabled });
                    push(u.enabled ? "已停用该用户" : "已启用该用户", "success");
                    await load();
                  }}
                >
                  {u.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!confirm(`确认删除用户 ${u.externalId}？`)) return;
                    try {
                      await api.deleteAppUser(u.id);
                      push("已删除", "success");
                      await load();
                    } catch (err) {
                      push((err as Error).message, "error");
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API 密钥</CardTitle>
          <span className="font-mono text-[11px] text-muted">共 {keys.length} 条</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div>
              <Label>密钥名称</Label>
              <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="如 微信小程序" />
            </div>
            <div>
              <Label>绑定角色</Label>
              <Select value={keyPersonaId} onChange={(e) => setKeyPersonaId(e.target.value)}>
                <option value="">选择角色</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>绑定用户</Label>
              <Select value={keyUserId} onChange={(e) => setKeyUserId(e.target.value)}>
                <option value="">选择用户</option>
                {users.map((u) => (
                  <option key={u.id} value={u.externalId}>
                    {u.displayName}（{u.externalId}）
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={createKey}>
                <KeyRound className="h-3.5 w-3.5" /> 签发密钥
              </Button>
            </div>
          </div>

          {createdKey && (
            <div className="border border-stamp/50 bg-stamp/[0.06] px-3 py-2.5">
              <p className="mb-1 text-[12px] text-ink">新密钥（只显示这一次，请立即保存）：</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all font-mono text-[12px] text-ink">{createdKey}</code>
                <Button size="sm" variant="outline" onClick={copyKey}>
                  <Copy className="h-3.5 w-3.5" /> 复制
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCreatedKey(null)}>
                  我已保存
                </Button>
              </div>
            </div>
          )}

          {keys.length === 0 && <p className="font-mono text-[12px] text-muted">还没有密钥。</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-muted" />
                <span className="text-[13px] font-medium text-ink">{k.name}</span>
                <code className="font-mono text-[11px] text-muted">{k.keyPrefix}…</code>
                <Badge variant="secondary">{k.personaName}</Badge>
                <Badge variant="secondary">{k.userDisplayName}</Badge>
                {k.enabled ? <Badge variant="default">启用</Badge> : <Badge variant="warning">已停用</Badge>}
                <span className="font-mono text-[10.5px] text-muted">
                  调用 {k.usageCount} 次 · {k.lastUsedAt ? `最近 ${formatDateTime(k.lastUsedAt)}` : "未使用"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await api.updateApiKey(k.id, { enabled: !k.enabled });
                    push(k.enabled ? "已停用" : "已启用", "success");
                    await load();
                  }}
                >
                  {k.enabled ? "停用" : "启用"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    if (!confirm(`确认删除密钥 ${k.name}？调用方将立即无法访问。`)) return;
                    await api.deleteApiKey(k.id);
                    push("已删除", "success");
                    await load();
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
