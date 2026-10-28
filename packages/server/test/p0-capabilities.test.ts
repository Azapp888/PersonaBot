import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capabilitiesFor,
  normalizeMaxTokens,
  thinkingDisabledBody,
} from "../src/llm/capabilities";
import { OpenAICompatibleProvider } from "../src/llm/openai";
import { AnthropicProvider } from "../src/llm/anthropic";

function captureFetch(): { getBody: () => any; restore: () => void } {
  const original = globalThis.fetch;
  let body: any = null;
  (globalThis as any).fetch = async (_url: string, init: any) => {
    body = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        model: "test-model",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  return { getBody: () => body, restore: () => ((globalThis as any).fetch = original) };
}

test("能力声明：GLM/豆包识别为可关闭思考，输出上限 8192", () => {
  const glm = capabilitiesFor({ provider: "zhipu", modelId: "glm-4.6" });
  assert.equal(glm.supportsThinking, true);
  assert.equal(glm.thinkingParam, "thinking");
  assert.equal(glm.maxOutputTokens, 8192);

  const ark = capabilitiesFor({ provider: "volcengine", modelId: "doubao-seed-1-6" });
  assert.equal(ark.thinkingParam, "thinking");
  assert.deepEqual(thinkingDisabledBody(ark)?.thinking, { type: "disabled" });
});

test("能力声明：推理模型默认不写关闭参数，避免破坏其推理能力", () => {
  const r1 = capabilitiesFor({ provider: "deepseek", modelId: "deepseek-r1" });
  assert.equal(r1.reasoning, true);
  assert.equal(r1.thinkingParam, "none");
  assert.equal(thinkingDisabledBody(r1), null);
});

test("maxTokens 归一化：非法值回退 2048，超上限被裁剪，不超过能力上限", () => {
  const glm = capabilitiesFor({ provider: "zhipu", modelId: "glm-4.6" });
  assert.equal(normalizeMaxTokens(undefined, glm), 2048);
  assert.equal(normalizeMaxTokens(0, glm), 2048);
  assert.equal(normalizeMaxTokens(-5, glm), 2048);
  assert.equal(normalizeMaxTokens(800, glm), 800);
  assert.equal(normalizeMaxTokens(99999, glm), 8192);
});

test("OpenAI 兼容层：闲聊关闭思考并统一 max_tokens", async () => {
  const cap = captureFetch();
  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: "k",
      apiBase: "https://api.example.com/v1",
      model: "glm-4.6",
      name: "volcengine",
    });
    await provider.chat([{ role: "user", content: "在吗" }], { maxTokens: 99999, thinking: false });
    const body = cap.getBody();
    assert.equal(body.max_tokens, 8192);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, false);
  } finally {
    cap.restore();
  }
});

test("OpenAI 兼容层：复杂场景保留思考时不注入关闭参数", async () => {
  const cap = captureFetch();
  try {
    const provider = new OpenAICompatibleProvider({
      apiKey: "k",
      apiBase: "https://api.example.com/v1",
      model: "glm-4.6",
      name: "volcengine",
    });
    await provider.chat([{ role: "user", content: "写一段剧情" }], { maxTokens: 4096, thinking: true });
    const body = cap.getBody();
    assert.equal(body.thinking, undefined);
    assert.equal(body.max_tokens, 4096);
  } finally {
    cap.restore();
  }
});

test("Anthropic 通道同样受输出上限约束，不再无视 maxTokens", async () => {
  const cap = captureFetch();
  try {
    const provider = new AnthropicProvider({ apiKey: "k", apiBase: "https://api.anthropic.com", model: "claude-x" });
    await provider.chat([{ role: "user", content: "hi" }], { maxTokens: 99999 });
    const body = cap.getBody();
    assert.equal(body.max_tokens, 8192);
  } finally {
    cap.restore();
  }
});
