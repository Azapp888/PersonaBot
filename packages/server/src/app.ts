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

  await app.register(fastifyCors, {
    origin: true,
    credentials: true,
  });

  await registerAuth(app);

  await app.register(authRoutes);
  await app.register(botRoutes);
  await app.register(personaRoutes);
  await app.register(modelRoutes);
  await app.register(memoryRoutes);
  await app.register(statsRoutes);
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
