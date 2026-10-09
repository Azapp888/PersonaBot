import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  LayoutDashboard,
  LogOut,
  Moon,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  Boxes,
  BarChart3,
  Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const navItems = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard },
  { to: "/bots", label: "Bot 管理", icon: Bot },
  { to: "/personas", label: "角色管理", icon: UserRound },
  { to: "/models", label: "模型管理", icon: Boxes },
  { to: "/memories", label: "记忆管理", icon: Brain },
  { to: "/stats", label: "统计", icon: BarChart3 },
  { to: "/skills", label: "技能", icon: Sparkles },
  { to: "/settings", label: "系统设置", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  const { username, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("pb_theme") === "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("pb_theme", dark ? "dark" : "light");
  }, [dark]);

  const title = navItems.find((n) => n.to === location.pathname)?.label ?? "PersonaBot";

  return (
    <div className="flex min-h-screen bg-muted/40 dark:bg-slate-950">
      <aside className="hidden w-60 flex-col bg-sidebar text-slate-300 md:flex">
        <div className="flex h-16 items-center gap-2 px-5 text-lg font-semibold text-white">
          <Sparkles className="h-5 w-5 text-primary" />
          PersonaBot
        </div>
        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  isActive ? "bg-primary/20 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3 text-xs text-slate-500">
          <div className="mb-2">管理后台 · 轻量角色扮演 QQ Bot</div>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-border bg-background px-4 dark:bg-slate-900 dark:border-slate-800 md:px-6">
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDark((d) => !d)}
              className="rounded-md border border-border p-2 hover:bg-muted dark:border-slate-700"
              aria-label="切换主题"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <span className="text-sm text-muted-foreground">{username}</span>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
