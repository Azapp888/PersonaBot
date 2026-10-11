import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { config } from "../config";

export interface AdminClaims {
  sub: string;
  username: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    admin?: AdminClaims;
  }
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: config.admin.jwtSecret,
    // 同时支持 Authorization: Bearer 与 httpOnly cookie（pb_token）
    cookie: { cookieName: "pb_token", signed: false },
  });

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<AdminClaims>();
      request.admin = payload;
    } catch {
      return reply.code(401).send({ error: "unauthorized", message: "未登录或会话已过期" });
    }
  });
}
