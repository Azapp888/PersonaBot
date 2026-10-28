import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-identity-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

const PERSONA = "p-identity";

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

function makePersona(systemPrompt: string) {
  return {
    id: PERSONA,
    name: "阿瑜",
    avatar: null,
    description: "高中生",
    systemPrompt,
    personality: { traits: [], speakingStyle: "", catchphrases: [], emotionalTendency: "", canPaint: false },
    skills: [],
    commands: [],
    paintingConfig: { enabled: false, style: "", artistReference: "", characterDna: "" },
    scheduleTemplate: "",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  } as unknown as import("../src/types").Persona;
}

test("用户层按 userId 隔离：B 的提示词不含 A 的昵称/真名/关系/记忆", async () => {
  const { userIdentityRepo } = await import("../src/db/repos/user-identities");
  const { assembleSystemPrompt, buildMemoryContextBlock } = await import("../src/persona/prompt");

  userIdentityRepo.upsert({
    personaId: PERSONA,
    userId: "user-a",
    nickname: "泽宝",
    realName: "李雨泽",
    relationship: "恋人",
    addressPreference: "只有李雨泽可以叫你阿瑜",
    boundaries: "不要提他的前女友",
  });
  userIdentityRepo.upsert({
    personaId: PERSONA,
    userId: "user-b",
    nickname: "小林",
    realName: "林可",
    relationship: "同学",
  });

  const redactNames = userIdentityRepo
    .listByPersona(PERSONA)
    .flatMap((i) => [i.nickname, i.realName])
    .filter((n) => n && n.trim().length >= 2);

  const persona = makePersona("你是一名高二学生。");

  const a = assembleSystemPrompt(persona, {
    userId: "user-a",
    userIdentity: userIdentityRepo.find(PERSONA, "user-a"),
    redactNames,
    memoryFiles: { user: "用户 A 喜欢喝美式咖啡" },
  });
  assert.match(a.full, /泽宝/);
  assert.match(a.full, /李雨泽/);
  assert.match(a.full, /美式咖啡/);

  const b = assembleSystemPrompt(persona, {
    userId: "user-b",
    userIdentity: userIdentityRepo.find(PERSONA, "user-b"),
    redactNames,
    memoryFiles: { user: "用户 B 喜欢喝拿铁" },
  });
  assert.match(b.full, /小林/);
  assert.doesNotMatch(b.full, /泽宝/);
  assert.doesNotMatch(b.full, /李雨泽/);
  assert.doesNotMatch(b.full, /恋人/);
  assert.doesNotMatch(b.full, /前女友/);
  assert.doesNotMatch(b.full, /美式咖啡/);
  assert.match(b.full, /拿铁/);

  const memoryB = buildMemoryContextBlock({ relevant: "用户 B 的猫叫团子" });
  assert.doesNotMatch(memoryB, /泽宝|李雨泽/);
});

test("记忆层归属不一致直接抛错（阻断跨用户串号）", async () => {
  const { buildMemoryLayer } = await import("../src/persona/prompt");
  assert.throws(
    () => buildMemoryLayer({ userId: "user-a", files: { memory: "x" } }, "user-b"),
    /memory_user_mismatch/,
  );
});

test("角色层清洗：DB 里写死的用户专属句与用户名被剔除，其余人设保持不变", async () => {
  const { sanitizeRoleLayer, buildRoleLayer } = await import("../src/persona/prompt");
  const dirty = [
    "你是一名高二学生，性格活泼。",
    "只有李雨泽才可以叫你阿瑜。",
    "你与用户（李雨泽）是恋人关系。",
    "这句话只对李雨泽有效。",
    "你喜欢在放学后去便利店。",
  ].join("\n");

  const cleaned = sanitizeRoleLayer(dirty, ["李雨泽", "泽宝", "阿瑜"]);
  assert.doesNotMatch(cleaned, /李雨泽/);
  assert.doesNotMatch(cleaned, /只有.*才可以叫/);
  assert.doesNotMatch(cleaned, /恋人关系/);
  assert.match(cleaned, /你是一名高二学生，性格活泼。/);
  assert.match(cleaned, /你喜欢在放学后去便利店。/);

  const role = buildRoleLayer(makePersona(dirty), ["李雨泽", "泽宝"]);
  assert.doesNotMatch(role, /李雨泽/);
  assert.match(role, /便利店/);
});

test("没有身份记录时不注入用户层，也不回退到其他用户资料", async () => {
  const { assembleSystemPrompt } = await import("../src/persona/prompt");
  const persona = makePersona("你是一名高二学生。");
  const prompt = assembleSystemPrompt(persona, { userId: "user-unknown", userIdentity: null });
  assert.equal(prompt.user, "");
  assert.doesNotMatch(prompt.full, /泽宝|李雨泽|小林/);
});
