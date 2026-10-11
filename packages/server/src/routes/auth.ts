import type { FastifyInstance } from "fastify";
import { config } from "../config";
import type { AdminClaims } from "../auth/plugin";
import { RateLimiter } from "../utils/rateLimit";
import { verifyPassword } from "../utils/password";

// 登录限流：同一 IP 15 分钟内最多 10 次尝试，抵御暴力破解。
const loginLimiter = new RateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const ip = request.ip || "unknown";
    if (!loginLimiter.hit(ip)) {
      const retryAfter = Math.ceil(loginLimiter.retryAfterMs(ip) / 1000);
      reply.header("Retry-After", String(retryAfter));
      return reply.code(429).send({ error: "too_many_requests", message: "登录尝试过于频繁，请稍后再试" });
    }

    const body = request.body as { username?: string; password?: string } | undefined;
    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    const storedSecret = config.admin.passwordHash || config.admin.password;
    const userOk = username === config.admin.username;
    const passOk = verifyPassword(password, storedSecret, config.admin.password);
    if (!userOk || !passOk) {
      return reply.code(401).send({ error: "invalid_credentials", message: "用户名或密码错误" });
    }
    // 登录成功，清除该 IP 的失败计数
    loginLimiter.reset(ip);
    const claims: AdminClaims = { sub: username, username };
    const token = app.jwt.sign(claims, { expiresIn: config.admin.tokenTtl });
    reply.setCookie("pb_token", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProd,
      maxAge: 7 * 24 * 60 * 60,
    });
    return { token, username };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    reply.clearCookie("pb_token", { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: [app.authenticate] }, async (request) => {
    return { username: request.admin?.username ?? config.admin.username };
  });
}
