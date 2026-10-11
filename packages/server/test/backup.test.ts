import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const dir = mkdtempSync(join(tmpdir(), "personabot-backup-"));
process.env.DATA_DIR = dir;

test("backupDatabase 生成一致性快照并保留最近 N 份", async () => {
  // 准备一个带数据的数据库
  const dbFile = resolve(dir, "personabot.db");
  const db = new Database(dbFile);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'),('b');");
  db.close();

  const { backupDatabase } = await import("../src/scripts/backup");
  const first = backupDatabase(2);
  assert.ok(existsSync(first));

  // 快照内容可独立打开且数据完整
  const snap = new Database(first, { readonly: true });
  const count = (snap.prepare("SELECT COUNT(*) AS c FROM t").get() as any).c;
  snap.close();
  assert.equal(count, 2);

  const backupDir = resolve(dir, "backups");
  for (let i = 0; i < 3; i++) backupDatabase(2);
  const remaining = readdirSync(backupDir).filter((f) => f.endsWith(".db"));
  assert.ok(remaining.length <= 2, `期望保留不超过 2 份，实际 ${remaining.length}`);
});

test("缺少数据库时抛出明确错误", async () => {
  const empty = mkdtempSync(join(tmpdir(), "personabot-nodb-"));
  process.env.DATA_DIR = empty;
  // 重新加载模块以刷新 config.dataDir
  delete require.cache[require.resolve("../src/config")];
  delete require.cache[require.resolve("../src/scripts/backup")];
  writeFileSync(join(empty, ".keep"), "");
  const mod = await import("../src/scripts/backup?ts=" + Date.now());
  assert.throws(() => mod.backupDatabase(1));
});
