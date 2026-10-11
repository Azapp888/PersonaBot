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
    password: str("ADMIN_PASSWORD", "changeme"),
    jwtSecret: str("JWT_SECRET", "personabot-dev-secret-change-me"),
    tokenTtl: str("JWT_TTL", "7d"),
  },

  encryptionKey: str("ENCRYPTION_KEY", "personabot-dev-encryption-key"),

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
    injectSystemTime: true,
    timezone: str("TIMEZONE", "Asia/Shanghai"),
    contextRecentRounds: num("CONTEXT_RECENT_ROUNDS", 10),
    contextSummaryEnabled: true,
    guardrailEnabled: true,
    fileHandlingEnabled: true,
    fileMaxBytes: num("FILE_MAX_BYTES", 2_000_000),
    agentShellPrefix: str("AGENT_SHELL_PREFIX", "/sh"),
    agentShellTimeoutMs: num("AGENT_SHELL_TIMEOUT_MS", 15000),
    agentShellMaxOutputChars: num("AGENT_SHELL_MAX_OUTPUT_CHARS", 3500),
  },
};

export function ensureRuntimeDirs(): void {
  for (const dir of [config.dataDir, config.logDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
