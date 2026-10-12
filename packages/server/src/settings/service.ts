import { config } from "../config";
import { settingRepo } from "../db/repos/settings";
import { decryptSecret, encryptSecret } from "../utils/crypto";
import type { AppSettings } from "../types";

/**
 * 需要加密存储的设置项（如绘画 API Key、GitHub Token）。
 * 这些字段在数据库中加密落盘，读取时解密；对外 API 永远只返回是否已设置。
 */
export const SENSITIVE_SETTING_KEYS = ["paintingApiKey", "githubToken"] as const;
type SensitiveKey = (typeof SENSITIVE_SETTING_KEYS)[number];

function isSensitive(key: string): key is SensitiveKey {
  return (SENSITIVE_SETTING_KEYS as readonly string[]).includes(key);
}

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
    conversationMaxMessages: config.defaults.conversationMaxMessages,
    guardrailEnabled: config.defaults.guardrailEnabled,
    fileHandlingEnabled: config.defaults.fileHandlingEnabled,
    fileMaxBytes: config.defaults.fileMaxBytes,
    agentShellPrefix: config.defaults.agentShellPrefix,
    agentShellTimeoutMs: config.defaults.agentShellTimeoutMs,
    agentShellMaxOutputChars: config.defaults.agentShellMaxOutputChars,
    agentShellAllowedUsers: config.defaults.agentShellAllowedUsers,
    keywordFilterEnabled: config.defaults.keywordFilterEnabled,
    keywordFilterAction: config.defaults.keywordFilterAction,
    keywordFilterWords: config.defaults.keywordFilterWords,
    memoryFileAppendEnabled: config.defaults.memoryFileAppendEnabled,
    updateRepoUrl: config.defaults.updateRepoUrl,
    updateBranch: config.defaults.updateBranch,
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
    for (const key of SENSITIVE_SETTING_KEYS) {
      if (result[key]) result[key] = decryptSecret(result[key]);
    }
    return result;
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      const value = String(v);
      // 敏感字段加密落盘；空字符串表示不修改（由调用方过滤）
      entries[k] = isSensitive(k) && value ? encryptSecret(value) : value;
    }
    if (Object.keys(entries).length) settingRepo.setMany(entries);
    return this.get();
  },
};
