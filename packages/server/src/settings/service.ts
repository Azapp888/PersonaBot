import { config } from "../config";
import { settingRepo } from "../db/repos/settings";
import type { AppSettings } from "../types";

function defaultSettings(): AppSettings {
  return {
    adminPort: config.defaults.adminPort,
    botServiceNote: "Bot 服务独立进程运行，支持 systemd / pm2 管理。",
    cacheEnabled: true,
    memoryInjectConversationLimit: config.defaults.memoryInjectConversationLimit,
    paintingGlobalDailyLimit: config.defaults.paintingGlobalDailyLimit,
    paintingPersonaDailyLimit: config.defaults.paintingPersonaDailyLimit,
    paintingEnabled: true,
    paintingProvider: "openai",
    paintingApiBase: "https://api.openai.com/v1",
    paintingApiKey: "",
    paintingModel: "gpt-image-1",
    paintingSize: "1024x1024",
    proactiveEnabled: config.defaults.proactiveEnabled,
    proactiveMaxMessages: config.defaults.proactiveMaxMessages,
    skillRepoUrl: "",
    skillBranch: "main",
    githubToken: "",
    skillUpdateCron: config.defaults.skillUpdateCron,
    messageDebounceMs: config.defaults.messageDebounceMs,
    splitMessages: config.defaults.splitMessages,
    splitMaxMessages: config.defaults.splitMaxMessages,
    timezone: config.defaults.timezone,
    dailyMessageEnabled: config.defaults.dailyMessageEnabled,
    dailyMessageHour: config.defaults.dailyMessageHour,
    contextRecentRounds: config.defaults.contextRecentRounds,
    contextSummaryEnabled: config.defaults.contextSummaryEnabled,
    guardrailEnabled: config.defaults.guardrailEnabled,
    fileHandlingEnabled: config.defaults.fileHandlingEnabled,
    fileMaxBytes: config.defaults.fileMaxBytes,
    agentShellPrefix: config.defaults.agentShellPrefix,
    agentShellTimeoutMs: config.defaults.agentShellTimeoutMs,
    agentShellMaxOutputChars: config.defaults.agentShellMaxOutputChars,
  };
}

type SettingKey = keyof AppSettings;

function coerce<K extends SettingKey>(key: K, raw: string): AppSettings[K] {
  const fallback = defaultSettings()[key];
  if (typeof fallback === "number") {
    const n = Number(raw);
    return (Number.isFinite(n) ? n : fallback) as AppSettings[K];
  }
  if (typeof fallback === "boolean") {
    return (raw === "true" || raw === "1") as AppSettings[K];
  }
  return raw as AppSettings[K];
}

export const settingsService = {
  get(): AppSettings {
    const stored = settingRepo.all();
    const result = defaultSettings();
    for (const key of Object.keys(result) as SettingKey[]) {
      if (stored[key] !== undefined) {
        (result as any)[key] = coerce(key, stored[key]);
      }
    }
    return result;
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null) entries[k] = String(v);
    }
    if (Object.keys(entries).length) settingRepo.setMany(entries);
    return this.get();
  },
};
