import { test } from "node:test";
import assert from "node:assert/strict";
import { inferVisionFromName, visionSpecFor, PROVIDER_VISION } from "../src/llm/vision";

test("视觉知识库：覆盖主要提供商并对不支持的给出明确结论", () => {
  for (const p of ["openai", "deepseek", "anthropic", "custom", "mock"]) {
    assert.ok(PROVIDER_VISION[p], `缺少 ${p} 的视觉规格`);
  }
  assert.equal(visionSpecFor("deepseek").supportsVision, false);
  assert.equal(visionSpecFor("mock").supportsVision, false);
  assert.equal(visionSpecFor("openai").imageTransport, "content-parts-image-url");
  assert.equal(visionSpecFor("anthropic").imageTransport, "content-parts-base64");
  // 未知提供商标提供商回退到自定义（OpenAI 兼容）
  assert.equal(visionSpecFor("whatever").imageTransport, "content-parts-image-url");
});

test("命名推断：OpenAI 视觉模型命中", () => {
  assert.equal(inferVisionFromName("openai", "gpt-4o"), true);
  assert.equal(inferVisionFromName("openai", "gpt-4.1-mini"), true);
  assert.equal(inferVisionFromName("openai", "gpt-3.5-turbo"), false);
});

test("命名推断：DeepSeek 文本模型判为不支持，VL 判为支持", () => {
  assert.equal(inferVisionFromName("deepseek", "deepseek-chat"), false);
  assert.equal(inferVisionFromName("deepseek", "deepseek-reasoner"), false);
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
