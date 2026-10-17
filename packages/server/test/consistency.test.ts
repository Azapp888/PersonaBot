import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPersonaConsistency, summarizeConsistency } from "../src/persona/consistency";
import type { Persona } from "../src/types";

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "p1",
    name: "阿瑜",
    avatar: null,
    description: "高二学生",
    systemPrompt: "你是一名高二学生。",
    personality: {
      traits: ["乐观", "活泼"],
      speakingStyle: "轻快俏皮",
      catchphrases: ["嘿嘿"],
      emotionalTendency: "开朗",
      canPaint: false,
    },
    skills: [],
    commands: [],
    paintingConfig: { enabled: false, style: "", artistReference: "", characterDna: "" },
    scheduleTemplate: "",
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Persona;
}

test("人格校验：信息完整的角色得满分且无问题", () => {
  const report = checkPersonaConsistency(makePersona());
  assert.equal(report.score, 100);
  assert.equal(report.issues.length, 0);
  assert.equal(report.errors, 0);
});

test("人格校验：缺少名称与身份时记 error 并显著扣分", () => {
  const report = checkPersonaConsistency(
    makePersona({ name: "", description: "", systemPrompt: "" }),
  );
  assert.equal(report.errors, 2);
  assert.ok(report.issues.some((i) => i.code === "missing_name"));
  assert.ok(report.issues.some((i) => i.code === "missing_identity"));
  assert.ok(report.score <= 50);
});

test("人格校验：性格标签语义相反时给出警告", () => {
  const report = checkPersonaConsistency(
    makePersona({ personality: { ...makePersona().personality, traits: ["乐观", "悲观"], emotionalTendency: "" } }),
  );
  assert.ok(report.warnings >= 1);
  assert.ok(report.issues.some((i) => i.code === "trait_conflict"));
});

test("人格校验：情绪倾向与性格标签冲突时给出警告", () => {
  const report = checkPersonaConsistency(
    makePersona({ personality: { ...makePersona().personality, emotionalTendency: "暴躁" } }),
  );
  assert.ok(report.issues.some((i) => i.code === "mood_trait_conflict"));
});

test("人格校验：说话风格与性格标签语感错配时给出提示", () => {
  const report = checkPersonaConsistency(
    makePersona({ personality: { ...makePersona().personality, speakingStyle: "正式书面" } }),
  );
  assert.ok(report.issues.some((i) => i.code === "style_tone_mismatch"));
});

test("人格校验：重复标签/口癖与不完整命令被识别", () => {
  const report = checkPersonaConsistency(
    makePersona({
      personality: { ...makePersona().personality, traits: ["乐观", "乐观"], catchphrases: ["嘿", "嘿"] },
      commands: [{ name: "打卡", trigger: "", description: "", prompt: "" }],
    }),
  );
  assert.ok(report.issues.some((i) => i.code === "duplicate_traits"));
  assert.ok(report.issues.some((i) => i.code === "duplicate_catchphrases"));
  assert.ok(report.issues.some((i) => i.code === "incomplete_command"));
});

test("一致性汇总：统计健康数、平均分与最差角色", () => {
  const good = makePersona({ id: "good", name: "好角色" });
  const bad = makePersona({ id: "bad", name: "坏角色", personality: { ...makePersona().personality, traits: ["乐观", "悲观"] } });
  const summary = summarizeConsistency([good, bad]);
  assert.equal(summary.total, 2);
  assert.equal(summary.healthy, 1);
  assert.equal(summary.withWarnings, 1);
  assert.ok(summary.averageScore < 100);
  assert.equal(summary.worst[0].personaId, "bad");
});

test("一致性汇总：空列表时默认满分且无最差项", () => {
  const summary = summarizeConsistency([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.averageScore, 100);
  assert.equal(summary.worst.length, 0);
});
