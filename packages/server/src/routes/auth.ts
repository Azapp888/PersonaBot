import type { FastifyInstance } from "fastify";
import { config } from "../config";
import type { AdminClaims } from "../auth/plugin";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/login", async (request, reply) => {
    const body = request.body as { username?: string; password?: string } | undefined;
    const username = body?.username?.trim() ?? "";
    const password = body?.password ?? "";
    if (username !== config.admin.username || password !== config.admin.password) {
      return reply.code(401).send({ error: "invalid_credentials", message: "用户名或密码错误" });
    }
    const claims: AdminClaims = { sub: username, username };
    const token = app.jwt.sign(claims, { expiresIn: config.admin.tokenTtl });
    reply.setCookie("pb_token", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
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
