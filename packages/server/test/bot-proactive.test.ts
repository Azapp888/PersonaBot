import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-botproactive-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("botRepo：主动消息按 Bot 保存，默认关闭且默认 3 条", async () => {
  const { botRepo } = await import("../src/db/repos/bots");
  const created = botRepo.create({ name: "主动测试", appId: "app-proactive", clientSecret: "secret" });
  assert.equal(created.proactiveEnabled, false);
  assert.equal(created.proactiveMaxMessages, 3);

  const updated = botRepo.update(created.id, { proactiveEnabled: true, proactiveMaxMessages: 5 })!;
  assert.equal(updated.proactiveEnabled, true);
  assert.equal(updated.proactiveMaxMessages, 5);

  // 修改其它字段时不应重置主动消息配置
  const renamed = botRepo.update(created.id, { name: "改名后" })!;
  assert.equal(renamed.proactiveEnabled, true);
  assert.equal(renamed.proactiveMaxMessages, 5);
});

test("botRepo：主动消息条数收敛到 1-10", async () => {
  const { botRepo } = await import("../src/db/repos/bots");
  const created = botRepo.create({ name: "边界测试", appId: "app-clamp", clientSecret: "secret" });

  assert.equal(botRepo.update(created.id, { proactiveMaxMessages: 99 })!.proactiveMaxMessages, 10);
  assert.equal(botRepo.update(created.id, { proactiveMaxMessages: 0 })!.proactiveMaxMessages, 1);
  assert.equal(botRepo.update(created.id, { proactiveMaxMessages: Number.NaN })!.proactiveMaxMessages, 3);
});
