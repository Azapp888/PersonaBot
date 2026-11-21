import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { apiKeyRepo } from "../db/repos/api-keys";
import { appUserRepo } from "../db/repos/app-users";
import { sha256Hex } from "../utils/crypto";
import { RateLimiter } from "../utils/rateLimit";

/**
 * 开放 API 鉴权：外部应用使用控制台签发的 API Key 调用 /api/v1/*。
 *
 * - 支持 `Authorization: Bearer pb_xxx` 与 `X-API-Key: pb_xxx` 两种写法；
 * - 密钥以 sha256 散列存储，数据库泄露也无法还原明文；
 * - 每条密钥绑定一个角色 + 一个用户，服务端据此决定「用谁的身份、以哪个角色对话」；
 * - 绑定用户被停用时立即拒绝，便于运营侧封禁；
 * - 按密钥做限流，防止单个接入方打满服务。
 */
export interface ApiClientClaims {
  keyId: string;
  keyName: string;
  personaId: string;
  userId: string;
}

declare module "fastify" {
  interface FastifyInstance {
    apiKeyAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    apiClient?: ApiClientClaims;
  }
}

/** 每分钟允许的请求数，可用 OPEN_API_RATE_LIMIT 覆盖。 */
const RATE_LIMIT_PER_MINUTE = Math.max(
  1,
  Number(process.env.OPEN_API_RATE_LIMIT ?? "") || 60,
);
const limiter = new RateLimiter({ windowMs: 60_000, max: RATE_LIMIT_PER_MINUTE });

function extractKey(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  const header = request.headers["x-api-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

export async function registerApiKeyAuth(app: FastifyInstance): Promise<void> {
  app.decorate("apiKeyAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = extractKey(request);
    if (!raw) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "缺少 API Key，请使用 Authorization: Bearer pb_xxx 或 X-API-Key: pb_xxx",
      });
    }

    const key = apiKeyRepo.findByHash(sha256Hex(raw));
    if (!key || !key.enabled) {
      return reply.code(401).send({ error: "unauthorized", message: "API Key 无效或已停用" });
    }

    const user = appUserRepo.findByExternalId(key.userId);
    if (user && !user.enabled) {
      return reply.code(403).send({ error: "forbidden", message: "该 API Key 绑定的用户已被停用" });
    }

    if (!limiter.hit(key.id)) {
      const retryAfterMs = limiter.retryAfterMs(key.id);
      reply.header("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return reply.code(429).send({
        error: "rate_limited",
        message: `调用过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`,
      });
    }

    request.apiClient = {
      keyId: key.id,
      keyName: key.name,
      personaId: key.personaId,
      userId: key.userId,
    };
  });
}
