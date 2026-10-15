import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-botmodel-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

function makePersona() {
  return {
    id: "per_1",
    name: "阿瑜",
    avatar: null,
    description: "",
    systemPrompt: "",
    personality: { traits: [], speakingStyle: "", catchphrases: [], emotionalTendency: "", canPaint: false },
    skills: [],
    commands: [],
    paintingConfig: { enabled: false, style: "", artistReference: "", characterDna: "" },
    scheduleTemplate: "",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  } as any;
}

test("resolveProviderForBot：Bot 分配的模型优先生效", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  const botModel = modelRepo.create({ name: "bot用", provider: "mock", modelId: "mock-bot" });
  modelRepo.create({ name: "其它", provider: "mock", modelId: "mock-other" });

  const { model } = resolveProviderForBot({ modelId: botModel.id }, makePersona());
  assert.equal(model?.id, botModel.id);
});

test("resolveProviderForBot：Bot 未配置模型时回退到默认模型", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  // 第一个启用的非 mock 模型即默认模型
  const defaultModel = modelRepo.create({ name: "默认", provider: "custom", modelId: "default-1" });

  const { model } = resolveProviderForBot({ modelId: null }, makePersona());
  assert.equal(model?.id, defaultModel.id);
});

test("resolveProviderForBot：Bot 指向的模型被禁用时回退到默认模型", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  const disabled = modelRepo.create({ name: "停用", provider: "mock", modelId: "mock-disabled", enabled: false });

  const { model } = resolveProviderForBot({ modelId: disabled.id }, makePersona());
  assert.notEqual(model?.id, disabled.id);
  assert.equal(model?.enabled, true);
});
