import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bot,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sparkles,
  Sun,
  UserRound,
  X,
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

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2.5 text-lg font-semibold text-white", compact && "text-base")}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 ring-1 ring-primary/30">
        <Sparkles className="h-5 w-5 text-primary" />
      </span>
      <span className="tracking-tight">
        Persona<span className="text-primary">Bot</span>
      </span>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all active:scale-[0.98]",
              isActive
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                : "text-slate-400 hover:bg-white/5 hover:text-white",
            )
          }
        >
          <item.icon className="h-[18px] w-[18px] shrink-0" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { username, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [dark, setDark] = useState(() => localStorage.getItem("pb_theme") === "dark");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("pb_theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [drawerOpen]);

  const title = navItems.find((n) => n.to === location.pathname)?.label ?? "PersonaBot";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-white/5 bg-gradient-to-b from-slate-900 to-slate-950 lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <NavItems />
        <div className="border-t border-white/10 p-3">
          <div className="mb-2 flex items-center gap-2 px-2 text-xs text-slate-500">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-medium text-slate-300">
              {(username ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{username ?? "admin"}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        onClick={() => setDrawerOpen(false)}
        className={cn(
          "fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col bg-gradient-to-b from-slate-900 to-slate-950 transition-transform duration-300 ease-out lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Brand compact />
          <button
            onClick={() => setDrawerOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <NavItems onNavigate={() => setDrawerOpen(false)} />
        <div className="border-t border-white/10 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mb-2 flex items-center gap-2 px-2 text-xs text-slate-500">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[11px] font-medium text-slate-300">
              {(username ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{username ?? "admin"}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 dark:border-slate-800 dark:bg-slate-950/80 lg:h-16 lg:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted lg:hidden"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="flex-1 truncate text-base font-semibold lg:text-lg">{title}</h1>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              cn(
                "flex h-10 w-10 items-center justify-center rounded-lg transition-colors lg:hidden",
                isActive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted",
              )
            }
            aria-label="系统设置"
          >
            <Settings className="h-5 w-5" />
          </NavLink>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-border transition-colors hover:bg-muted dark:border-slate-700"
            aria-label="切换主题"
          >
            {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
          </button>
          <span className="hidden text-sm text-muted-foreground sm:inline">{username}</span>
        </header>
        <main className="flex-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:p-6">{children}</main>
      </div>
    </div>
  );
}
