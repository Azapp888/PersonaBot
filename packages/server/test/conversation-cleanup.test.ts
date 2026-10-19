import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "personabot-conv-cleanup-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("conversationRepo：删除单条 / 清空后续 / 清空全部", async () => {
  const { conversationRepo } = await import("../src/db/repos/conversations");
  const personaId = "p_cleanup";
  const userId = "u_cleanup";

  conversationRepo.append(personaId, userId, [
    { role: "user", content: "第一问", timestamp: 1000 },
    { role: "assistant", content: "第一答", timestamp: 1001 },
    { role: "user", content: "第二问", timestamp: 1002 },
    { role: "assistant", content: "第二答", timestamp: 1003 },
  ]);

  const removed = conversationRepo.deleteAt(personaId, userId, 1);
  assert.equal(removed?.content, "第一答");
  assert.deepEqual(
    conversationRepo.find(personaId, userId)?.messages.map((m) => m.content),
    ["第一问", "第二问", "第二答"],
  );

  const fromRemoved = conversationRepo.deleteFrom(personaId, userId, 1);
  assert.equal(fromRemoved.length, 2);
  assert.deepEqual(
    conversationRepo.find(personaId, userId)?.messages.map((m) => m.content),
    ["第一问"],
  );

  conversationRepo.clear(personaId, userId);
  assert.equal(conversationRepo.find(personaId, userId)?.messages.length, 0);

  assert.equal(conversationRepo.deleteAt(personaId, userId, 99), null);
});

test("logRepo：标记无效后记忆整理不再读取该条流水", async () => {
  const { logRepo } = await import("../src/db/repos/logs");
  const personaId = "p_cleanup";
  const userId = "u_cleanup";
  const at = Date.now();

  logRepo.message({ personaId, userId, direction: "out", content: "错误的回复" });
  const before = logRepo.allMessagesBetween(personaId, userId, 0, at + 60_000);
  assert.equal(before.length, 1);

  const changed = logRepo.invalidateByContent(personaId, userId, "out", "错误的回复", at);
  assert.equal(changed, 1);
  assert.equal(logRepo.allMessagesBetween(personaId, userId, 0, at + 60_000).length, 0);

  // 已无效的记录不会重复标记
  assert.equal(logRepo.invalidateByContent(personaId, userId, "out", "错误的回复", at), 0);
  assert.equal(logRepo.invalidateBetween(personaId, userId, 0, at + 60_000), 0);
});

test("inspectReply：拦截空回复、复读、提示词泄露与角色前缀", async () => {
  const { inspectReply } = await import("../src/pipeline/reply-quality");

  assert.deepEqual(inspectReply("今天想聊什么？"), []);
  assert.equal(inspectReply("   ")[0]?.code, "empty");
  assert.equal(inspectReply("今天先好好休息吧", "今天先好好休息吧")[0]?.code, "repeat");
  assert.equal(inspectReply("【系统强制警告】你必须先完成作业")[0]?.code, "prompt_leak");
  assert.equal(inspectReply("assistant: 我在呢")[0]?.code, "role_prefix");
  assert.equal(inspectReply("正常语气\u0000\u0001")[0]?.code, "control_chars");
});
