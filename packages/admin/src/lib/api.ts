import type {
  AppSettings,
  Bot,
  DashboardData,
  DiscoveredModel,
  Memory,
  ModelRecord,
  Persona,
  ProactiveRunResult,
  Skill,
  SystemTime,
  TrendPoint,
  UpdateInfo,
  UpdateResult,
} from "./types";

const TOKEN_KEY = "pb_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("pb:unauthorized"));
    throw new ApiError(401, "未登录或会话已过期");
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.message || data?.error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  // auth
  login: (username: string, password: string) =>
    request<{ token: string; username: string }>("POST", "/api/auth/login", { username, password }),
  logout: () => request<{ ok: boolean }>("POST", "/api/auth/logout"),
  me: () => request<{ username: string }>("GET", "/api/auth/me"),

  // dashboard / stats
  dashboard: () => request<DashboardData>("GET", "/api/stats/dashboard"),
  trends: (days = 14) => request<TrendPoint[]>("GET", `/api/stats/trends?days=${days}`),
  personaTrends: (id: string, days = 14) => request<TrendPoint[]>("GET", `/api/stats/persona/${id}?days=${days}`),
  recentMessages: (limit = 50) => request<any[]>("GET", `/api/stats/messages?limit=${limit}`),

  // bots
  bots: () => request<Bot[]>("GET", "/api/bots"),
  botStatus: () => request<Bot[]>("GET", "/api/bots/status"),
  createBot: (data: Partial<Bot> & { clientSecret?: string }) => request<Bot>("POST", "/api/bots", data),
  updateBot: (id: string, data: any) => request<Bot>("PUT", `/api/bots/${id}`, data),
  toggleBot: (id: string) => request<Bot>("POST", `/api/bots/${id}/toggle`),
  restartBot: (id: string) => request<{ ok: boolean }>("POST", `/api/bots/${id}/restart`),
  deleteBot: (id: string) => request<{ ok: boolean }>("DELETE", `/api/bots/${id}`),

  // personas
  personas: () => request<Persona[]>("GET", "/api/personas"),
  createPersona: (data: Partial<Persona>) => request<Persona>("POST", "/api/personas", data),
  updatePersona: (id: string, data: Partial<Persona>) => request<Persona>("PUT", `/api/personas/${id}`, data),
  deletePersona: (id: string) => request<{ ok: boolean }>("DELETE", `/api/personas/${id}`),
  simulate: (id: string, userId: string, message: string) =>
    request<{ reply: string; usage: any; painting?: any }>("POST", `/api/personas/${id}/simulate`, { userId, message }),

  // models
  models: () => request<ModelRecord[]>("GET", "/api/models"),
  createModel: (data: any) => request<ModelRecord>("POST", "/api/models", data),
  createModelsBatch: (data: {
    provider: string;
    models: { modelId: string; name?: string }[];
    apiKey?: string;
    apiBase?: string;
    temperature?: number;
    maxTokens?: number;
    enabled?: boolean;
  }) => request<{ ok: boolean; created: ModelRecord[]; skipped: string[]; reusedKey?: boolean }>("POST", "/api/models/batch", data),
  updateModel: (id: string, data: any) => request<ModelRecord>("PUT", `/api/models/${id}`, data),
  deleteModel: (id: string) => request<{ ok: boolean }>("DELETE", `/api/models/${id}`),
  testModel: (id: string) => request<{ ok: boolean; reply?: string; message?: string }>("POST", `/api/models/${id}/test`),
  discoverModels: (data: { provider: string; apiKey?: string; apiBase?: string }) =>
    request<{ ok: boolean; models: DiscoveredModel[]; reusedKey?: boolean }>("POST", "/api/models/discover", data),
  discoverModelById: (id: string, data: { provider?: string; apiKey?: string; apiBase?: string }) =>
    request<{ ok: boolean; models: DiscoveredModel[]; reusedKey?: boolean }>("POST", `/api/models/${id}/discover`, data),

  // memories
  memories: (personaId: string, userId?: string) =>
    request<Memory[]>("GET", `/api/memories?personaId=${personaId}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`),
  memoryUsers: (personaId: string) => request<string[]>("GET", `/api/memories/users?personaId=${personaId}`),
  triggerMemory: (personaId: string, userId: string, type: string) =>
    request<{ ok: boolean; content?: string; message?: string }>("POST", "/api/memories/trigger", { personaId, userId, type }),
  updateMemory: (id: string, content: string) => request<{ ok: boolean }>("PUT", `/api/memories/${id}`, { content }),
  deleteMemory: (id: string) => request<{ ok: boolean }>("DELETE", `/api/memories/${id}`),
  memoryFiles: (personaId: string, userId: string) =>
    request<string[]>("GET", `/api/memories/files?personaId=${personaId}&userId=${encodeURIComponent(userId)}`),
  memoryFile: (personaId: string, userId: string, name: string) =>
    request<{ name: string; content: string; userEdited: boolean; appendEnabled: boolean }>(
      "GET",
      `/api/memories/file?personaId=${personaId}&userId=${encodeURIComponent(userId)}&name=${encodeURIComponent(name)}`,
    ),
  saveMemoryFile: (personaId: string, userId: string, name: string, content: string) =>
    request<{ ok: boolean; name: string; userEdited: boolean }>("PUT", "/api/memories/file", {
      personaId,
      userId,
      name,
      content,
    }),
  resetMemoryFile: (personaId: string, userId: string, name: string) =>
    request<{ ok: boolean; name: string; content: string; userEdited: boolean }>("POST", "/api/memories/file/reset", {
      personaId,
      userId,
      name,
    }),
  setMemoryFileAppend: (personaId: string, userId: string, name: string, enabled: boolean) =>
    request<{ ok: boolean; name: string; appendEnabled: boolean }>("PUT", "/api/memories/file/append", {
      personaId,
      userId,
      name,
      enabled,
    }),
  importMemory: (personaId: string, userId: string, filename: string, content: string) =>
    request<{ ok: boolean; created: number; entries: { sourceDate: string; content: string }[]; message?: string }>(
      "POST",
      "/api/memories/import",
      { personaId, userId, filename, content },
    ),

  // settings
  settings: () => request<AppSettings>("GET", "/api/settings"),
  updateSettings: (data: Partial<AppSettings>) => request<AppSettings>("PUT", "/api/settings", data),
  systemInfo: () => request<any>("GET", "/api/system/info"),
  systemTime: () => request<SystemTime>("GET", "/api/system/time"),

  // skills
  skills: () => request<Skill[]>("GET", "/api/skills"),
  createSkill: (data: Partial<Skill>) => request<Skill>("POST", "/api/skills", data),
  updateSkill: (id: string, data: Partial<Skill>) => request<Skill>("PUT", `/api/skills/${id}`, data),
  deleteSkill: (id: string) => request<{ ok: boolean }>("DELETE", `/api/skills/${id}`),
  syncSkills: (repoUrl?: string, token?: string) =>
    request<{ updated: number; errors: string[] }>("POST", "/api/skills/sync", { repoUrl, token }),

  // system actions
  runProactive: () => request<ProactiveRunResult>("POST", "/api/system/proactive/run"),
  runDaily: () => request<ProactiveRunResult>("POST", "/api/system/daily/run"),
  refreshTokens: () => request<{ ok: boolean }>("POST", "/api/system/tokens/refresh"),
  reloadBots: () => request<{ ok: boolean }>("POST", "/api/system/bots/reload"),
  checkUpdate: () => request<UpdateInfo>("GET", "/api/system/update/check"),
  applyUpdate: () => request<UpdateResult>("POST", "/api/system/update/apply"),
};
