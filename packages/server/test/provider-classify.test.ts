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

test("classify：分组键 = 提供商名称 + 归一化地址", () => {
  const g = classify({ provider: "openai", apiBase: "https://api.openai.com/v1" });
  assert.equal(g.key, "openai@api.openai.com/v1");
  assert.equal(g.known, true);
  assert.equal(g.label, "OpenAI");
  assert.equal(
    classify({ provider: "volcengine", apiBase: "https://ark.cn-beijing.volces.com/api/v3" }).key,
    "volcengine@ark.cn-beijing.volces.com/api/v3",
  );
});

test("classify：同一提供商名称下不同路径 -> 不同分组", () => {
  const a = classify({ provider: "dashscope", apiBase: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
  const b = classify({ provider: "dashscope", apiBase: "https://dashscope.aliyuncs.com/api/v1" });
  assert.notEqual(a.key, b.key);
  assert.equal(a.known, true);
});

test("classify：自定义名称原样保留，地址相同但名称不同 -> 不同分组", () => {
  const a = classify({ provider: "公司内网网关", apiBase: "https://gw.example.com/v1" });
  const b = classify({ provider: "另一个网关", apiBase: "https://gw.example.com/v1" });
  assert.equal(a.label, "公司内网网关");
  assert.equal(a.vendor, "公司内网网关");
  assert.notEqual(a.key, b.key);
  assert.equal(a.known, false);
});

test("classify：未知地址以 名称+host+path 为分组键，同地址同名同组", () => {
  const a = classify({ provider: "custom", apiBase: "https://gw.example.com/v1" });
  const b = classify({ provider: "custom", apiBase: "https://gw.example.com/v1/" });
  const c = classify({ provider: "custom", apiBase: "https://gw.example.com/v2" });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.equal(a.known, false);
});

test("classify：地址不同 -> 不同分组；sameEndpoint 以完整分组键判定", () => {
  const a = classify({ provider: "custom", apiBase: "https://a.example.com/v1" });
  const b = classify({ provider: "custom", apiBase: "https://b.example.com/v1" });
  assert.notEqual(a.key, b.key);
  assert.equal(
    sameEndpoint({ provider: "custom", apiBase: "https://a.example.com/v1" }, { provider: "custom", apiBase: "https://a.example.com/v1" }),
    true,
  );
});

test("classify：无地址时回退到默认地址或仅按名称分组", () => {
  assert.equal(classify({ provider: "deepseek", apiBase: null }).key, "deepseek@api.deepseek.com/v1");
  assert.equal(classify({ provider: "mock", apiBase: null }).key, "mock");
  assert.equal(classify({ provider: "我的网关", apiBase: null }).key, "provider:我的网关");
});
