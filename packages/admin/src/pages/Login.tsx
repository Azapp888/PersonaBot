import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
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
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <div className="animate-in w-full max-w-sm">
        <div className="border border-paper/15 bg-paper">
          <div className="flex items-baseline justify-between border-b border-rule px-5 py-3">
            <span className="font-display text-[20px] font-semibold uppercase tracking-[0.08em] text-ink">
              Persona<span className="text-stamp">Bot</span>
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Call Sheet</span>
          </div>
          <div className="px-5 py-5">
            <p className="mb-5 text-[12.5px] leading-relaxed text-muted">
              轻量级角色扮演 QQ Bot 管理系统。请核对身份后进入后台。
            </p>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="login-user">用户名</Label>
                <Input
                  id="login-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  autoFocus
                  autoComplete="username"
                />
              </div>
              <div>
                <Label htmlFor="login-pass">密码</Label>
                <Input
                  id="login-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <div className="border-l-[3px] border-alert bg-alert/10 px-3 py-2 text-[13px] text-alert">{error}</div>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "登录中" : "签到登录"}
              </Button>
            </form>
          </div>
          <p className="border-t border-rule px-5 py-3 font-mono text-[10.5px] leading-relaxed text-muted">
            默认账号见 .env 中的 ADMIN_USERNAME / ADMIN_PASSWORD
          </p>
        </div>
      </div>
    </div>
  );
}
