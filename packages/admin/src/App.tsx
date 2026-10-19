import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/Login";

// 路由级代码分割：各管理页按需加载，降低首屏体积
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const BotsPage = lazy(() => import("@/pages/Bots").then((m) => ({ default: m.BotsPage })));
const PersonasPage = lazy(() => import("@/pages/Personas").then((m) => ({ default: m.PersonasPage })));
const ModelsPage = lazy(() => import("@/pages/Models").then((m) => ({ default: m.ModelsPage })));
const MemoriesPage = lazy(() => import("@/pages/Memories").then((m) => ({ default: m.MemoriesPage })));
const ConversationsPage = lazy(() =>
  import("@/pages/Conversations").then((m) => ({ default: m.ConversationsPage })),
);
const StatsPage = lazy(() => import("@/pages/Stats").then((m) => ({ default: m.StatsPage })));
const LogsPage = lazy(() => import("@/pages/Logs").then((m) => ({ default: m.LogsPage })));
const SkillsPage = lazy(() => import("@/pages/Skills").then((m) => ({ default: m.SkillsPage })));
const SettingsPage = lazy(() => import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })));

function PageFallback() {
  return <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">加载中...</div>;
}

function Protected() {
  const { username, ready } = useAuth();
  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (!username) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Protected />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/bots" element={<BotsPage />} />
              <Route path="/personas" element={<PersonasPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/memories" element={<MemoriesPage />} />
              <Route path="/conversations" element={<ConversationsPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/logs" element={<LogsPage />} />
              <Route path="/skills" element={<SkillsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
