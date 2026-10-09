import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { BotsPage } from "@/pages/Bots";
import { PersonasPage } from "@/pages/Personas";
import { ModelsPage } from "@/pages/Models";
import { MemoriesPage } from "@/pages/Memories";
import { StatsPage } from "@/pages/Stats";
import { SkillsPage } from "@/pages/Skills";
import { SettingsPage } from "@/pages/Settings";

function Protected() {
  const { username, ready } = useAuth();
  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>;
  }
  if (!username) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
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
              <Route path="/stats" element={<StatsPage />} />
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
