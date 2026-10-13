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

function makePersona(modelId?: string) {
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
    modelConfig: modelId ? { modelId } : {},
    scheduleTemplate: "",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  } as any;
}

test("resolveProviderForBot：Bot 配置的模型优先于角色", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  const botModel = modelRepo.create({ name: "bot用", provider: "mock", modelId: "mock-bot" });
  const personaModel = modelRepo.create({ name: "角色用", provider: "mock", modelId: "mock-persona" });

  const persona = makePersona(personaModel.id);
  const { model } = resolveProviderForBot({ modelId: botModel.id }, persona);
  assert.equal(model?.id, botModel.id);
});

test("resolveProviderForBot：Bot 未配置模型时回退到角色模型", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  const personaModel = modelRepo.create({ name: "角色用2", provider: "mock", modelId: "mock-persona-2" });

  const persona = makePersona(personaModel.id);
  const { model } = resolveProviderForBot({ modelId: null }, persona);
  assert.equal(model?.id, personaModel.id);
});

test("resolveProviderForBot：Bot 指向的模型被禁用时回退到角色模型", async () => {
  const { modelRepo } = await import("../src/db/repos/models");
  const { resolveProviderForBot } = await import("../src/llm/factory");
  const disabled = modelRepo.create({ name: "停用", provider: "mock", modelId: "mock-disabled", enabled: false });
  const personaModel = modelRepo.create({ name: "角色用3", provider: "mock", modelId: "mock-persona-3" });

  const persona = makePersona(personaModel.id);
  const { model } = resolveProviderForBot({ modelId: disabled.id }, persona);
  assert.equal(model?.id, personaModel.id);
});
