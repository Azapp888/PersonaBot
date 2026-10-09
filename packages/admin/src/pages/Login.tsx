import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button, Input, Label } from "@/components/ui/primitives";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-8 backdrop-blur">
        <div className="mb-6 flex flex-col items-center gap-2 text-white">
          <Sparkles className="h-8 w-8 text-primary" />
          <h1 className="text-xl font-semibold">PersonaBot 管理后台</h1>
          <p className="text-xs text-slate-400">轻量级角色扮演 QQ Bot 管理系统</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-slate-300">用户名</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" autoFocus />
          </div>
          <div>
            <Label className="text-slate-300">密码</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
            />
          </div>
          {error && <div className="rounded-md bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">默认账号见 .env 中的 ADMIN_USERNAME / ADMIN_PASSWORD</p>
      </div>
    </div>
  );
}
