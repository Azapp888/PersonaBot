import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

// 使用独立的临时数据目录，避免污染开发数据；必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-http-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "test-pass-123";
process.env.JWT_SECRET = "test-jwt-secret-xxxxxxxxxxxxxxxx";
process.env.ENCRYPTION_KEY = "test-encryption-key";

let app: FastifyInstance;
let token = "";
let personaId = "";

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  const { seed } = await import("../src/db/seed");
  const { buildApp } = await import("../src/app");

  runMigrations(getDb());
  await seed();
  app = await buildApp();
  await app.ready();
});

after(async () => {
  if (app) await app.close();
});

test("登录：错误凭据返回 401", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "wrong" },
  });
  assert.equal(res.statusCode, 401);
});

test("登录：正确凭据返回 token", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username: "admin", password: "test-pass-123" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.token);
  token = body.token;

  const created = await app.inject({
    method: "POST",
    url: "/api/personas",
    headers: { authorization: `Bearer ${token}` },
    payload: { name: "测试角色" },
  });
  assert.equal(created.statusCode, 200);
  personaId = created.json().id;
});

test("受保护接口：无 token 返回 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(res.statusCode, 401);
});

test("设置接口：不泄露敏感明文，仅返回 *Set 标记", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/settings",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.paintingApiKey, undefined);
  assert.equal(body.githubToken, undefined);
  assert.equal(typeof body.paintingApiKeySet, "boolean");
  assert.equal(typeof body.githubTokenSet, "boolean");
});

test("安全响应头存在", async () => {
  const res = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
});

test("未知 API 路径返回 404", async () => {
  const res = await app.inject({ method: "GET", url: "/api/does-not-exist" });
  assert.equal(res.statusCode, 404);
});

test("记忆文件写入：非法文件名返回 400", async () => {
  const res = await app.inject({
    method: "PUT",
    url: "/api/memories/file",
    headers: { authorization: `Bearer ${token}` },
    payload: { personaId, userId: "u1", name: "../../evil", content: "x" },
  });
  assert.equal(res.statusCode, 400);
});

test("模型检测：mock provider 返回内置模型", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/discover",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "mock" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.models));
  assert.equal(body.models[0].id, "mock-roleplay");
});

test("模型检测：缺少 provider 返回 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/discover",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(res.statusCode, 400);
});

test("模型检测：openai 缺少 apiKey 返回 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/discover",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "openai" },
  });
  assert.equal(res.statusCode, 400);
});

test("模型检测：不存在的模型 id 返回 404", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/mdl_not_exist/discover",
    headers: { authorization: `Bearer ${token}` },
    payload: {},
  });
  assert.equal(res.statusCode, 404);
});

test("模型批量创建：一次加入多个并跳过重复", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/batch",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "mock", models: [{ modelId: "mock-a" }, { modelId: "mock-b" }] },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.created.length, 2);

  const again = await app.inject({
    method: "POST",
    url: "/api/models/batch",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "mock", models: [{ modelId: "mock-a" }] },
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created.length, 0);
  assert.deepEqual(again.json().skipped, ["mock-a"]);
});

test("模型批量创建：缺少 models 返回 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/api/models/batch",
    headers: { authorization: `Bearer ${token}` },
    payload: { provider: "mock", models: [] },
  });
  assert.equal(res.statusCode, 400);
});

test("检查更新：未授权返回 401", async () => {
  const res = await app.inject({ method: "GET", url: "/api/system/update/check" });
  assert.equal(res.statusCode, 401);
});

test("检查更新：返回结构化更新信息", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/system/update/check",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.available, "boolean");
  assert.equal(typeof body.ok, "boolean");
  assert.equal(typeof body.behind, "number");
  assert.equal(typeof body.ahead, "number");
  assert.equal(typeof body.message, "string");
  assert.ok(["git", "docker", "unknown"].includes(body.mode));
  assert.equal(typeof body.canAutoUpdate, "boolean");
});

test("部署方式检测：测试环境为 git 工作区", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/system/update/check",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = res.json();
  assert.equal(body.mode, "git");
  assert.equal(body.canAutoUpdate, true);
});

test("一键更新：未授权返回 401", async () => {
  const res = await app.inject({ method: "POST", url: "/api/system/update/apply" });
  assert.equal(res.statusCode, 401);
});

test("更新版本信息：返回仓库根目录", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/system/update/version",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.repoRoot, "string");
  assert.ok(body.repoRoot.length > 0);
});
