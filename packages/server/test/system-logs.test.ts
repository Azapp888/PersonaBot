import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-syslog-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("systemLogRepo：写入后可筛选级别/类别/用户", async () => {
  const { systemLogRepo } = await import("../src/db/repos/system-logs");
  systemLogRepo.write({
    level: "info",
    category: "pipeline",
    personaId: "p1",
    userId: "u1",
    stage: "start",
    message: "开始生成回复",
    detail: { historyCount: 3 },
  });
  systemLogRepo.write({
    level: "error",
    category: "error",
    personaId: "p1",
    userId: "u2",
    stage: "generate_reply",
    message: "生成回复失败：timeout",
    detail: { error: "timeout" },
  });

  assert.equal(systemLogRepo.count({}), 2);
  assert.equal(systemLogRepo.count({ level: "error" }), 1);
  assert.equal(systemLogRepo.count({ category: "pipeline" }), 1);
  assert.equal(systemLogRepo.count({ userId: "u1" }), 1);
  assert.equal(systemLogRepo.count({ q: "timeout" }), 1);

  const errors = systemLogRepo.list({ level: "error" }, 10, 0);
  assert.equal(errors.length, 1);
  assert.ok(String(errors[0].detail).includes("timeout"), "detail 应以 JSON 字符串保存");
});

test("systemLogRepo：distinctUsers 聚合且可按角色过滤", async () => {
  const { systemLogRepo } = await import("../src/db/repos/system-logs");
  systemLogRepo.write({ level: "info", category: "system", personaId: "p2", userId: "u9", message: "x" });
  systemLogRepo.write({ level: "info", category: "system", personaId: "p2", userId: "", message: "no user" });

  assert.deepEqual(systemLogRepo.distinctUsers("p2"), ["u9"]);
  assert.ok(systemLogRepo.distinctUsers().includes("u1"));
});

test("systemLogRepo：超长 detail 会截断", async () => {
  const { systemLogRepo } = await import("../src/db/repos/system-logs");
  const big = "a".repeat(25000);
  systemLogRepo.write({ level: "debug", category: "model", message: "big", detail: { big } });
  const rows = systemLogRepo.list({ q: "big" }, 10, 0);
  assert.equal(rows.length, 1);
  assert.ok(String(rows[0].detail).length < 25000);
  assert.ok(String(rows[0].detail).includes("已截断"));
});

test("systemLogRepo：pruneBefore 删除旧记录", async () => {
  const { systemLogRepo } = await import("../src/db/repos/system-logs");
  const removed = systemLogRepo.pruneBefore(Date.now() + 1000);
  assert.ok(removed >= 1);
  assert.equal(systemLogRepo.count({}), 0);
});
