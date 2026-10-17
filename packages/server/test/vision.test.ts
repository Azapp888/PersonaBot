import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferVisionFromName,
  visionSpecFor,
  PROVIDER_VISION,
  pickVisionFallback,
  detectModelVisionCached,
  clearVisionCache,
} from "../src/llm/vision";
import type { LLMProvider } from "../src/llm/provider";

function fakeProvider(): { calls: number; provider: LLMProvider } {
  const box = {
    calls: 0,
    provider: {
      chat: async () => {
        box.calls += 1;
        return { content: "y", toolCalls: [], finishReason: "stop" };
      },
    } as unknown as LLMProvider,
  };
  return box;
}

test("视觉知识库：覆盖主要提供商并对不支持的给出明确结论", () => {
  for (const p of ["openai", "deepseek", "anthropic", "google", "dashscope", "custom", "mock"]) {
    assert.ok(PROVIDER_VISION[p], `缺少 ${p} 的视觉规格`);
  }
  assert.equal(visionSpecFor("mock").supportsVision, false);
  assert.equal(visionSpecFor("deepseek").supportsVision, true);
  assert.equal(visionSpecFor("openai").imageTransport, "content-parts-image-url");
  assert.equal(visionSpecFor("anthropic").imageTransport, "content-parts-base64");
  assert.equal(visionSpecFor("google").imageTransport, "content-parts-inline-data");
  // 未知提供商标提供商回退到自定义（OpenAI 兼容）
  assert.equal(visionSpecFor("whatever").imageTransport, "content-parts-image-url");
});

test("命名推断：OpenAI 视觉模型命中", () => {
  assert.equal(inferVisionFromName("openai", "gpt-4o"), true);
  assert.equal(inferVisionFromName("openai", "gpt-4.1-mini"), true);
  assert.equal(inferVisionFromName("openai", "gpt-3.5-turbo"), false);
});

test("命名推断：DeepSeek 文本模型判为不支持，视觉模型判为支持", () => {
  assert.equal(inferVisionFromName("deepseek", "deepseek-chat"), false);
  assert.equal(inferVisionFromName("deepseek", "deepseek-reasoner"), false);
  assert.equal(inferVisionFromName("deepseek", "deepseek-v4-flash-vision-exp"), true);
  assert.equal(inferVisionFromName("deepseek", "deepseek-vl2"), true);
});

test("命名推断：Anthropic Claude 系列命中", () => {
  assert.equal(inferVisionFromName("anthropic", "claude-3-5-sonnet-latest"), true);
  assert.equal(inferVisionFromName("anthropic", "claude-4-opus"), true);
});

test("命名推断：自定义网关识别常见多模态命名", () => {
  assert.equal(inferVisionFromName("custom", "qwen-vl-max"), true);
  assert.equal(inferVisionFromName("custom", "glm-4v"), true);
  assert.equal(inferVisionFromName("custom", "gemini-1.5-pro"), true);
  // 无法判断时返回 null，交由实测
  assert.equal(inferVisionFromName("custom", "some-random-model"), null);
});

test("视觉副模型选择：优先显式配置，其次首个支持读图且非主模型的模型", () => {
  const models = [
    { id: "a", provider: "openai" as const, modelId: "gpt-4o", supportsVision: true },
    { id: "b", provider: "deepseek" as const, modelId: "deepseek-chat", supportsVision: false },
    { id: "c", provider: "dashscope" as const, modelId: "qwen-vl-plus", supportsVision: true },
  ];
  assert.equal(pickVisionFallback(models, "c", "a")?.id, "c");
  assert.equal(pickVisionFallback(models, null, "a")?.id, "c");
  assert.equal(pickVisionFallback(models, "b", "a")?.id, "c");
  assert.equal(pickVisionFallback(models, null, "c")?.id, "a");
  assert.equal(pickVisionFallback([models[1]], null, "b"), null);
});

test("视觉缓存：命名可判定的模型不触发实测，且同键只计算一次", async () => {
  clearVisionCache();
  const box = fakeProvider();
  const first = await detectModelVisionCached(box.provider, "openai", "gpt-4o");
  assert.equal(first.supported, true);
  assert.notEqual(first.source, "probe");
  assert.equal(box.calls, 0, "静态可判定时不应发起实测");

  const second = await detectModelVisionCached(box.provider, "openai", "gpt-4o");
  assert.deepEqual(second, first);
  assert.equal(box.calls, 0);
});

test("视觉缓存：clearVisionCache 后可重新判定", async () => {
  clearVisionCache();
  const a = await detectModelVisionCached(fakeProvider().provider, "deepseek", "deepseek-chat");
  assert.equal(a.supported, false);
  clearVisionCache();
  const b = await detectModelVisionCached(fakeProvider().provider, "deepseek", "deepseek-chat");
  assert.equal(b.supported, false);
});

test("视觉缓存：无法静态判定的模型才走实测，并缓存确定性结论", async () => {
  clearVisionCache();
  const box = fakeProvider();
  const r1 = await detectModelVisionCached(box.provider, "custom", "some-unknown-model-x");
  assert.equal(r1.source, "probe");
  assert.equal(r1.supported, true);
  assert.equal(box.calls, 1);

  const r2 = await detectModelVisionCached(box.provider, "custom", "some-unknown-model-x");
  assert.equal(r2.source, "probe");
  assert.equal(box.calls, 1, "第二次应命中缓存，不再实测");
});
