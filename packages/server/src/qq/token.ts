import { config } from "../config";
import { logger } from "../logger";
import { botRepo } from "../db/repos/bots";
import { fetchWithTimeout } from "../utils/http";
import type { Bot } from "../types";

interface CacheEntry {
  token: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

/**
 * 统一管理 QQ access_token 的获取与自动刷新。
 * 凭证有效期约 7200 秒，提前 5 分钟刷新。
 */
export async function getAccessToken(bot: Bot): Promise<string> {
  const cached = cache.get(bot.id);
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }
  const pending = inflight.get(bot.id);
  if (pending) {
    return (await pending).token;
  }
  const task = refreshToken(bot);
  inflight.set(bot.id, task);
  try {
    const entry = await task;
    return entry.token;
  } finally {
    inflight.delete(bot.id);
  }
}

async function refreshToken(bot: Bot): Promise<CacheEntry> {
  const clientSecret = botRepo.decryptedSecret(bot);
  const res = await fetchWithTimeout(config.qq.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: bot.appId, clientSecret }),
    timeoutMs: 15000,
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error({ botId: bot.id, status: res.status, body: text }, "failed to obtain QQ access token");
    throw new Error(`获取 QQ access_token 失败: ${res.status} ${text}`);
  }
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`QQ token 响应解析失败: ${text}`);
  }
  const accessToken: string | undefined = data.access_token;
  if (!accessToken) {
    throw new Error(`QQ token 响应缺少 access_token: ${text}`);
  }
  const expiresIn = Number(data.expires_in ?? 7200);
  const entry: CacheEntry = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  cache.set(bot.id, entry);
  botRepo.updateToken(bot.id, accessToken, entry.expiresAt);
  logger.info({ botId: bot.id, expiresIn }, "QQ access token refreshed");
  return entry;
}

export function invalidateToken(botId: string): void {
  cache.delete(botId);
  inflight.delete(botId);
}

/** 定时任务：刷新即将过期的 token（提前刷新窗口内） */
export async function refreshExpiringTokens(): Promise<void> {
  for (const bot of botRepo.listEnabled()) {
    try {
      await getAccessToken(bot);
    } catch (err) {
      logger.warn({ botId: bot.id, err: (err as Error).message }, "scheduled token refresh failed");
    }
  }
}
