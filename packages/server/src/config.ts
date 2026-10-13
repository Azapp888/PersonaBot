import { config as loadEnv } from "dotenv";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

loadEnv();

function str(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 从当前文件向上查找 monorepo 根目录（含 pnpm-workspace.yaml），保证 data/logs 落在仓库根。 */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const rootDir = findRoot(__dirname);

function resolveDir(value: string): string {
  return resolve(rootDir, value);
}

const DEFAULT_ADMIN_PASSWORD = "changeme";
const DEFAULT_JWT_SECRET = "personabot-dev-secret-change-me";
const DEFAULT_ENCRYPTION_KEY = "personabot-dev-encryption-key";

export const config = {
  nodeEnv: str("NODE_ENV", "development"),
  get isProd(): boolean {
    return this.nodeEnv === "production";
  },
  host: str("HOST", "0.0.0.0"),
  port: num("PORT", 3000),
  logLevel: str("LOG_LEVEL", "info"),

  admin: {
    username: str("ADMIN_USERNAME", "admin"),
    password: str("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD),
    // 可选：`scrypt$salt$hash` 形式的密码哈希，设置后优先于明文密码校验
    passwordHash: str("ADMIN_PASSWORD_HASH", ""),
    jwtSecret: str("JWT_SECRET", DEFAULT_JWT_SECRET),
    tokenTtl: str("JWT_TTL", "7d"),
  },

  encryptionKey: str("ENCRYPTION_KEY", DEFAULT_ENCRYPTION_KEY),

  // 允许携带凭据访问 API 的来源（逗号分隔）。为空时仅允许同源（由 CORS 反射同源）。
  corsOrigins: str("CORS_ORIGINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  dataDir: resolveDir(str("DATA_DIR", "./data")),
  logDir: resolveDir(str("LOG_DIR", "./logs")),

  qq: {
    apiBase: str("QQ_API_BASE", "https://api.sgroup.qq.com"),
    tokenUrl: str("QQ_TOKEN_URL", "https://bots.qq.com/app/getAppAccessToken"),
    intents: num("QQ_INTENTS", 1 << 25),
  },

  // 绘制 / 主动消息 / 缓存等默认值，可被 settings 表覆盖
  defaults: {
    adminPort: num("PORT", 3000),
    paintingGlobalDailyLimit: 50,
    paintingPersonaDailyLimit: 1,
    proactiveMaxMessages: 3,
    proactiveEnabled: true,
    skillUpdateCron: "0 */6 * * *",
    messageDebounceMs: 1200,
    memoryInjectConversationLimit: 40,
    splitMessages: true,
    splitMaxMessages: 4,
    timezone: str("TIMEZONE", "Asia/Shanghai"),
    dailyMessageEnabled: true,
    dailyMessageHour: num("DAILY_MESSAGE_HOUR", 9),
    contextRecentRounds: num("CONTEXT_RECENT_ROUNDS", 10),
    contextSummaryEnabled: true,
    // 会话历史保留的最大消息条数（超出后裁剪最旧的，避免单会话 JSON 无限增长）
    conversationMaxMessages: num("CONVERSATION_MAX_MESSAGES", 400),
    guardrailEnabled: true,
    fileHandlingEnabled: true,
    fileMaxBytes: num("FILE_MAX_BYTES", 2_000_000),
    agentShellPrefix: str("AGENT_SHELL_PREFIX", "/sh"),
    agentShellTimeoutMs: num("AGENT_SHELL_TIMEOUT_MS", 15000),
    agentShellMaxOutputChars: num("AGENT_SHELL_MAX_OUTPUT_CHARS", 3500),
    // 允许使用服务器 Agent 命令的用户白名单（逗号/换行分隔的 QQ 号）；留空表示不限制
    agentShellAllowedUsers: str("AGENT_SHELL_ALLOWED_USERS", ""),
    // 敏感词过滤（可选）：命中用户消息时按策略处理，默认关闭
    keywordFilterEnabled: false,
    keywordFilterAction: "block" as string, // block | replace
    keywordFilterWords: "",
    // 记忆文件 AI 追加：用户手改后仍允许 AI 在追加区累积（默认关闭）
    memoryFileAppendEnabled: false,
    // 日记忆保留天数：三日记忆生成后剪掉更早的日记忆（原子事实不受影响）
    memoryDailyRetainDays: num("MEMORY_DAILY_RETAIN_DAYS", 2),
    // 进入核心记忆（受保护区）的最低重要性
    memoryCoreImportance: num("MEMORY_CORE_IMPORTANCE", 8),
    // 核心记忆注入条数上限
    memoryCoreMaxFacts: num("MEMORY_CORE_MAX_FACTS", 40),
    // 一键更新：展示用仓库地址与跟踪分支（实际更新以本地 git remote.origin 为准）
    updateRepoUrl: str("UPDATE_REPO_URL", "https://github.com/Azapp888/PersonaBot"),
    updateBranch: str("UPDATE_BRANCH", "main"),
  },
};

export function ensureRuntimeDirs(): void {
  for (const dir of [config.dataDir, config.logDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * 校验安全相关配置，返回问题列表。
 * 生产环境若仍在使用默认密钥会拒绝启动，避免密钥可预测导致鉴权/加密被绕过。
 */
export function securityIssues(): string[] {
  const issues: string[] = [];
  if (config.admin.password === DEFAULT_ADMIN_PASSWORD) issues.push("ADMIN_PASSWORD 仍为默认值 changeme");
  if (config.admin.jwtSecret === DEFAULT_JWT_SECRET) issues.push("JWT_SECRET 仍为默认值");
  else if (config.admin.jwtSecret.length < 16) issues.push("JWT_SECRET 长度不足 16，建议使用 32 位以上随机字符串");
  if (config.encryptionKey === DEFAULT_ENCRYPTION_KEY) issues.push("ENCRYPTION_KEY 仍为默认值");
  return issues;
}
