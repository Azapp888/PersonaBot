import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  normalizeBase,
  sameEndpoint,
} from "../src/llm/provider-classify";

test("normalizeBase：去掉协议、末尾斜杠与查询串，host 小写", () => {
  assert.equal(normalizeBase("https://api.openai.com/v1/"), "api.openai.com/v1");
  assert.equal(normalizeBase("http://API.DeepSeek.com/v1"), "api.deepseek.com/v1");
  assert.equal(normalizeBase("https://x.com/v1?foo=bar"), "x.com/v1");
  assert.equal(normalizeBase(""), "");
  assert.equal(normalizeBase(null), "");
});

test("classify：已知官方地址按提供商归组", () => {
  const g = classify({ provider: "openai", apiBase: "https://api.openai.com/v1" });
  assert.equal(g.key, "openai");
  assert.equal(g.known, true);
  assert.equal(classify({ provider: "volcengine", apiBase: "https://ark.cn-beijing.volces.com/api/v3" }).key, "volcengine");
  assert.equal(classify({ provider: "custom", apiBase: "https://api.deepseek.com/v1" }).key, "deepseek");
});

test("classify：同一官方域名不同路径归为同一提供商", () => {
  const a = classify({ provider: "custom", apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
  const b = classify({ provider: "custom", apiBase: "https://dashscope.aliyuncs.com/api/v1" });
  assert.equal(a.key, "dashscope");
  assert.equal(b.key, "dashscope");
});

test("classify：未知地址以 host+path 为分组键，同地址同组", () => {
  const a = classify({ provider: "custom", apiBase: "https://gw.example.com/v1" });
  const b = classify({ provider: "custom", apiBase: "https://gw.example.com/v1/" });
  const c = classify({ provider: "custom", apiBase: "https://gw.example.com/v2" });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.equal(a.known, false);
});

test("classify：provider 名相同但地址不同 -> 不同分组（不再被错误合并）", () => {
  const a = classify({ provider: "custom", apiBase: "https://a.example.com/v1" });
  const b = classify({ provider: "custom", apiBase: "https://b.example.com/v1" });
  assert.notEqual(a.key, b.key);
  assert.equal(sameEndpoint({ provider: "custom", apiBase: "https://a.example.com/v1" }, { provider: "custom", apiBase: "https://a.example.com/v1" }), true);
});

test("classify：无地址时回退到官方默认地址或 provider 名", () => {
  assert.equal(classify({ provider: "deepseek", apiBase: null }).key, "deepseek");
  assert.equal(classify({ provider: "mock", apiBase: null }).key, "mock");
  assert.equal(classify({ provider: "custom", apiBase: null }).key, "provider:custom");
});
