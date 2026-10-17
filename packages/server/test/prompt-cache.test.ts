import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUsage } from "../src/llm/openai";
import { buildStablePrefix, buildDynamicSuffix, buildTurnContext } from "../src/persona/prompt";
import type { Persona } from "../src/types";

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: "p1",
    name: "阿瑜",
    avatar: null,
    description: "高中生",
    systemPrompt: "你是一名高二学生。",
    personality: { traits: ["乐观"], speakingStyle: "活泼", catchphrases: [], emotionalTendency: "开朗", canPaint: false },
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

test("parseUsage：火山方舟（豆包）prompt_tokens_details.cached_tokens 可解析", () => {
  const usage = parseUsage(
    { usage: { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 800 } } },
    "volcengine",
  );
  assert.equal(usage.cacheHitTokens, 800);
  assert.equal(usage.cacheMissTokens, 200);
  assert.equal(usage.inputTokens, 1000);
});

test("parseUsage：DeepSeek 显式 hit/miss 字段优先", () => {
  const usage = parseUsage(
    { usage: { prompt_tokens: 1000, completion_tokens: 100, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 360 } },
    "deepseek",
  );
  assert.equal(usage.cacheHitTokens, 640);
  assert.equal(usage.cacheMissTokens, 360);
});

test("parseUsage：字段风格不匹配时自动兜底而非记 0", () => {
  // 以 openai 风格声明，但上游实际返回 deepseek 字段 —— 仍应解析出命中
  const usage = parseUsage(
    { usage: { prompt_tokens: 500, prompt_cache_hit_tokens: 300 } },
    "openai",
  );
  assert.equal(usage.cacheHitTokens, 300);
  assert.equal(usage.cacheMissTokens, 200);
});

test("parseUsage：无任何缓存字段时命中为 0、miss 等于输入", () => {
  const usage = parseUsage({ usage: { prompt_tokens: 300, completion_tokens: 50 } });
  assert.equal(usage.cacheHitTokens, 0);
  assert.equal(usage.cacheMissTokens, 300);
});

test("动态后缀：仅承载低频内容，不含每轮变化的记忆片段/状态/时间", () => {
  const persona = makePersona();
  const suffix = buildDynamicSuffix(persona, {
    memoryFiles: { memory: "记忆内容" },
    coreMemories: "- 约定：周末爬山",
    schedule: "现在正在上课",
    relevant: "- 相关片段",
    contextSummary: "之前的摘要",
    timezone: "Asia/Shanghai",
    now: Date.parse("2026-01-01T00:00:00Z"),
  });
  for (const keep of ["记忆档案", "核心记忆", "你今天的日程", "对话上下文摘要"]) {
    assert.ok(suffix.includes(keep), `${keep} 应保留在 system 动态后缀中`);
  }
  for (const moved of ["与当前话题相关的记忆片段", "当前状态", "当前时间"]) {
    assert.ok(!suffix.includes(moved), `${moved} 应移出 system 后缀`);
  }
});

test("本轮上下文：承载相关记忆/当前状态/当前时间，并挂在用户消息侧", () => {
  const state = {
    homeworkUnfinished: true,
    pendingSubjects: ["物理"],
    completedSubjects: [],
    mood: ["焦虑"],
    longTermPoints: [],
    sessionStartedAt: 0,
    updatedAt: 0,
  };
  const turn = buildTurnContext({
    relevant: "- 相关片段",
    conversationState: state as any,
    timezone: "Asia/Shanghai",
    now: Date.parse("2026-01-01T00:00:00Z"),
  });
  assert.ok(turn.includes("与当前话题相关的记忆片段"));
  assert.ok(turn.includes("当前状态"));
  assert.ok(turn.includes("当前时间"));
  const timeIdx = turn.lastIndexOf("当前时间");
  assert.ok(timeIdx > turn.indexOf("当前状态"), "时间应排在状态之后");
});

test("动态后缀：同一分钟内的两次调用前缀字节级一致", () => {
  const persona = makePersona();
  const ctxA = { timezone: "Asia/Shanghai", now: Date.parse("2026-01-01T00:00:10Z") };
  const ctxB = { timezone: "Asia/Shanghai", now: Date.parse("2026-01-01T00:00:50Z") };
  assert.equal(buildStablePrefix(persona), buildStablePrefix(persona));
  assert.equal(buildDynamicSuffix(persona, ctxA as any), buildDynamicSuffix(persona, ctxB as any));
});

test("system prompt 跨轮稳定：时间/状态变化不影响已组装的后缀", () => {
  const persona = makePersona();
  const base = buildStablePrefix(persona) + "\n" + buildDynamicSuffix(persona, {
    memoryFiles: { memory: "记忆" },
    coreMemories: "- 约定：爬山",
    schedule: "日程",
    contextSummary: "摘要",
  });
  const later = buildStablePrefix(persona) + "\n" + buildDynamicSuffix(persona, {
    memoryFiles: { memory: "记忆" },
    coreMemories: "- 约定：爬山",
    schedule: "日程",
    contextSummary: "摘要",
  });
  assert.equal(base, later);
});
