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
  MessagesSquare,
  ScrollText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";

const navItems = [
  { to: "/", label: "仪表盘", icon: LayoutDashboard, code: "01" },
  { to: "/bots", label: "Bot 管理", icon: Bot, code: "02" },
  { to: "/personas", label: "角色管理", icon: UserRound, code: "03" },
  { to: "/models", label: "模型管理", icon: Boxes, code: "04" },
  { to: "/memories", label: "记忆管理", icon: Brain, code: "05" },
  { to: "/conversations", label: "会话管理", icon: MessagesSquare, code: "06" },
  { to: "/stats", label: "统计", icon: BarChart3, code: "07" },
  { to: "/logs", label: "日志", icon: ScrollText, code: "08" },
  { to: "/skills", label: "技能", icon: Sparkles, code: "09" },
  { to: "/settings", label: "系统设置", icon: Settings, code: "10" },
];

function Brand() {
  return (
    <div className="flex items-baseline gap-2">
      <span className="font-display text-[19px] font-semibold uppercase tracking-[0.08em] text-paper">
        Persona<span className="text-stamp">Bot</span>
      </span>
    </div>
  );
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto py-2">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 border-l-[3px] py-2.5 pl-3 pr-4 text-sm transition-colors",
              isActive
                ? "border-stamp bg-paper/[0.06] text-paper"
                : "border-transparent text-paper/55 hover:bg-paper/[0.04] hover:text-paper/85",
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{item.label}</span>
              <span className={cn("font-mono text-[11px] tracking-[0.1em]", isActive ? "text-stamp" : "text-paper/60")}>
                {item.code}
              </span>
            </>
          )}
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

  const current = navItems.find((n) => n.to === location.pathname);
  const title = current?.label ?? "PersonaBot";

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-paper">
      {/* Desktop rail */}
      <aside className="rail fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-paper/10 bg-ink lg:flex">
        <div className="flex min-h-[3.5rem] items-center border-b border-paper/10 px-4 py-2.5">
          <Brand />
        </div>
        <NavItems />
        <div className="border-t border-paper/10 p-3">
          <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-[0.1em] text-paper/55">
            <span className="flex h-5 w-5 items-center justify-center rounded-sm border border-paper/25 text-[11px] text-paper/75">
              {(username ?? "A").slice(0, 1).toUpperCase()}
            </span>
            <span className="truncate">{username ?? "admin"}</span>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-paper/50 transition-colors hover:bg-paper/[0.06] hover:text-paper"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      <div
        onClick={() => setDrawerOpen(false)}
        className={cn(
          "fixed inset-0 z-50 bg-ink/70 transition-opacity duration-200 lg:hidden",
          drawerOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "rail fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col bg-ink transition-transform duration-200 ease-out lg:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex min-h-[3.5rem] items-center justify-between border-b border-paper/10 px-4 py-2.5">
          <Brand />
          <button
            onClick={() => setDrawerOpen(false)}
            className="rounded-sm p-2 text-paper/60 hover:bg-paper/10 hover:text-paper"
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <NavItems onNavigate={() => setDrawerOpen(false)} />
        <div className="border-t border-paper/10 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] text-paper/50 transition-colors hover:bg-paper/[0.06] hover:text-paper"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex min-h-[3.5rem] items-center gap-3 border-b border-rule bg-paper/90 px-4 py-2 backdrop-blur md:px-6">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-rule text-ink transition-colors hover:bg-ink/[0.05] lg:hidden"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            {current && (
              <span className="font-mono text-[11px] tracking-[0.14em] text-stamp">{current.code}</span>
            )}
            <h1 className="truncate font-display text-[21px] font-medium uppercase tracking-[0.05em] text-ink">
              {title}
            </h1>
          </div>
          <button
            onClick={() => setDark((d) => !d)}
            className="flex h-9 w-9 items-center justify-center rounded-sm border border-rule text-ink transition-colors hover:bg-ink/[0.05]"
            aria-label="切换主题"
          >
            {dark ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
          </button>
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.1em] text-muted sm:inline">{username}</span>
        </header>
        <main className="flex-1 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">{children}</main>
      </div>
    </div>
  );
}
