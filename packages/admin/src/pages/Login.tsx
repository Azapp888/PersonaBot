import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-purple-950 p-4">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-indigo-500/20 blur-3xl" />

      <div className="animate-in relative w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.06] p-7 shadow-2xl backdrop-blur-xl sm:p-8">
        <div className="mb-7 flex flex-col items-center gap-3 text-center text-white">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/20 ring-1 ring-primary/40">
            <Sparkles className="h-7 w-7 text-primary" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Persona<span className="text-primary">Bot</span> 管理后台
            </h1>
            <p className="mt-1 text-xs text-slate-400">轻量级角色扮演 QQ Bot 管理系统</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label className="text-slate-300">用户名</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <Label className="text-slate-300">密码</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
            />
          </div>
          {error && <div className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-300">{error}</div>}
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-500">
          默认账号见 .env 中的
          <br />
          ADMIN_USERNAME / ADMIN_PASSWORD
        </p>
      </div>
    </div>
  );
}
