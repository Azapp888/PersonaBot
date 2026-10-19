import Fastify, { type FastifyInstance } from "fastify";
import fastifyCors from "@fastify/cors";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config";
import { logger } from "./logger";
import { registerAuth } from "./auth/plugin";
import { authRoutes } from "./routes/auth";
import { botRoutes } from "./routes/bots";
import { personaRoutes } from "./routes/personas";
import { modelRoutes } from "./routes/models";
import { memoryRoutes } from "./routes/memories";
import { statsRoutes } from "./routes/stats";
import { settingsRoutes } from "./routes/settings";
import { skillRoutes } from "./routes/skills";
import { systemRoutes } from "./routes/system";
import { logRoutes } from "./routes/logs";
import { conversationRoutes } from "./routes/conversations";

function findAdminDist(): string | null {
  const candidates = [
    process.env.ADMIN_DIST,
    resolve(process.cwd(), "packages", "admin", "dist"),
    resolve(__dirname, "..", "public"),
    resolve(__dirname, "public"),
  ].filter(Boolean) as string[];
  for (const dir of candidates) {
    if (dir && existsSync(resolve(dir, "index.html"))) return dir;
  }
  return null;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 10 * 1024 * 1024,
  } as any) as unknown as FastifyInstance;

  // 默认不开启 CORS：生产环境管理后台与 API 同源，无需跨域。
  // 仅当显式配置 CORS_ORIGINS 时才允许列出的来源携带凭据访问，避免任意来源反射凭据。
  if (config.corsOrigins.length > 0) {
    await app.register(fastifyCors, {
      origin: config.corsOrigins,
      credentials: true,
    });
    logger.info({ origins: config.corsOrigins }, "CORS enabled for configured origins");
  }

  // 基础安全响应头（等价于 helmet 的最小集合，避免引入额外依赖）
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-XSS-Protection", "0");
    if (config.isProd) {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    return payload;
  });

  // 统一错误处理：避免向客户端泄露堆栈 / 内部细节
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) {
      logger.error({ err: error.message, url: request.url }, "request failed");
    }
    reply.code(status).send({
      error: status >= 500 ? "internal_error" : "request_error",
      message: status >= 500 ? "服务器内部错误" : error.message,
    });
  });

  await registerAuth(app);

  await app.register(authRoutes);
  await app.register(botRoutes);
  await app.register(personaRoutes);
  await app.register(modelRoutes);
  await app.register(memoryRoutes);
  await app.register(statsRoutes);
  await app.register(logRoutes);
  await app.register(conversationRoutes);
  await app.register(settingsRoutes);
  await app.register(skillRoutes);
  await app.register(systemRoutes);

  const adminDist = findAdminDist();
  if (adminDist) {
    const fastifyStatic = require("@fastify/static");
    await app.register(fastifyStatic, { root: adminDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url && request.raw.url.startsWith("/api")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return (reply as any).sendFile("index.html");
    });
    logger.info({ adminDist }, "serving admin frontend");
  } else {
    logger.warn("admin dist not found, only API will be served (use vite dev for frontend)");
  }

  return app;
}
