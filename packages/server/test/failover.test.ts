import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-failover-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

beforeEach(async () => {
  const { circuitBreaker } = await import("../src/llm/circuit-breaker");
  circuitBreaker.reset();
});

test("熔断器：连续失败达到阈值后打开，冷却到期自动恢复", async () => {
  const { circuitBreaker } = await import("../src/llm/circuit-breaker");
  const now = 1_000_000;
  assert.equal(circuitBreaker.isOpen("m1", now), false);
  circuitBreaker.recordFailure("m1", now);
  circuitBreaker.recordFailure("m1", now);
  assert.equal(circuitBreaker.isOpen("m1", now), false);
  circuitBreaker.recordFailure("m1", now);
  assert.equal(circuitBreaker.isOpen("m1", now), true);
  assert.equal(circuitBreaker.isOpen("m1", now + 61_000), false);
});

test("熔断器：成功一次即清零失败计数", async () => {
  const { circuitBreaker } = await import("../src/llm/circuit-breaker");
  const now = 2_000_000;
  circuitBreaker.recordFailure("m2", now);
  circuitBreaker.recordFailure("m2", now);
  circuitBreaker.recordSuccess("m2");
  circuitBreaker.recordFailure("m2", now);
  circuitBreaker.recordFailure("m2", now);
  assert.equal(circuitBreaker.isOpen("m2", now), false);
});

test("候选链：Bot 绑定模型优先，其余真实模型兜底，mock 排最后且不重复", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderChain } = await import("../src/llm/factory");

  const primary = modelRepo.create({ name: "主", provider: "openai", modelId: "gpt-primary", enabled: true, apiKey: "k" });
  const secondary = modelRepo.create({ name: "备", provider: "deepseek", modelId: "ds-secondary", enabled: true, apiKey: "k" });
  const fallbackMock = modelRepo.create({ name: "兜底", provider: "mock", modelId: "mock-model", enabled: true });

  const chain = resolveProviderChain({ modelId: primary.id }, {} as any);
  assert.equal(chain[0].model?.id, primary.id);
  const ids = chain.map((c) => c.model?.id);
  assert.equal(new Set(ids).size, ids.length, "候选模型不得重复");
  assert.ok(ids.includes(secondary.id));
  assert.equal(ids[ids.length - 1], fallbackMock.id, "mock 只能作为最后兜底");
});

test("候选链：Bot 绑定的模型被禁用时回退到其他真实模型", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderChain } = await import("../src/llm/factory");

  const disabled = modelRepo.create({ name: "禁用", provider: "openai", modelId: "gpt-disabled", enabled: false, apiKey: "k" });
  const usable = modelRepo.create({ name: "可用", provider: "moonshot", modelId: "kimi-usable", enabled: true, apiKey: "k" });

  const chain = resolveProviderChain({ modelId: disabled.id }, {} as any);
  assert.notEqual(chain[0].model?.id, disabled.id);
  assert.ok(chain.some((c) => c.model?.id === usable.id));
});
