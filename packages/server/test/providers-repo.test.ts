import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-provider-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("providerRepo：可创建无模型的「空提供商」并复用其配置", async () => {
  const { providerRepo } = await import("../src/db/repos/providers");
  const rec = providerRepo.create({ name: "deepseek", apiBase: "https://api.deepseek.com/v1", apiKey: "sk-abc" });
  assert.equal(rec.name, "deepseek");
  assert.equal(rec.apiBase, "https://api.deepseek.com/v1");
  assert.ok(rec.apiKey, "密钥应已加密存储");

  const found = providerRepo.findByName("deepseek");
  assert.ok(found);
  assert.equal(found!.id, rec.id);
});

test("providerRepo：更新名称/Base 时保留原密钥（留空不覆盖）", async () => {
  const { providerRepo } = await import("../src/db/repos/providers");
  const rec = providerRepo.create({ name: "openai-like", apiBase: "https://api.openai.com/v1", apiKey: "sk-keep" });
  const before = providerRepo.find(rec.id)!;
  const updated = providerRepo.update(rec.id, { name: "openai", apiBase: "https://api.openai.com/v1", apiKey: undefined })!;
  assert.equal(updated.name, "openai");
  assert.equal(updated.apiKey, before.apiKey, "未传密钥时不应丢失原密钥");
});

test("providerRepo：删除后不再可见", async () => {
  const { providerRepo } = await import("../src/db/repos/providers");
  const rec = providerRepo.create({ name: "tmp-provider", apiBase: null, apiKey: null });
  providerRepo.remove(rec.id);
  assert.equal(providerRepo.find(rec.id), null);
});
