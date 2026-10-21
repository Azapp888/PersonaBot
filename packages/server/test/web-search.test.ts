import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 独立临时数据目录，必须在导入 config 之前设置。
const dir = mkdtempSync(join(tmpdir(), "personabot-search-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("search presets：覆盖 6 家厂商且带默认地址", async () => {
  const { SEARCH_PRESETS, findSearchPreset } = await import("../src/search/presets");
  assert.equal(SEARCH_PRESETS.length, 6);
  for (const p of SEARCH_PRESETS) {
    assert.ok(p.apiBase.startsWith("http"), `${p.vendor} 缺少默认地址`);
    assert.ok(p.label.length > 0);
    assert.equal(findSearchPreset(p.vendor)?.vendor, p.vendor);
  }
  assert.equal(findSearchPreset("not-exist"), null);
});

test("searchProviderRepo：密钥加密存储且更新时不回显", async () => {
  const { searchProviderRepo } = await import("../src/db/repos/search-providers");
  const created = searchProviderRepo.create({
    vendor: "tavily",
    apiBase: "https://api.tavily.com",
    apiKey: "tvly-secret",
  });
  assert.equal(created.enabled, true);
  assert.notEqual(created.apiKey, "tvly-secret", "密钥不应明文落库");
  assert.ok(created.apiKey);

  // 未传 apiKey 时保留原密钥
  const updated = searchProviderRepo.update(created.id, { enabled: false })!;
  assert.equal(updated.enabled, false);
  assert.equal(updated.apiKey, created.apiKey);

  assert.equal(searchProviderRepo.findByVendor("tavily")?.id, created.id);
  assert.equal(searchProviderRepo.listEnabled().length, 0);
});

test("search repo：每轮搜索前解析出启用的提供商", async () => {
  const { searchProviderRepo } = await import("../src/db/repos/search-providers");
  searchProviderRepo.create({ vendor: "serper", apiBase: "https://google.serper.dev", apiKey: "k" });
  assert.equal(searchProviderRepo.listEnabled().length, 1);
});

test("extractVolcengineResults：从 annotations 提取标题与链接，并去重截断", async () => {
  const { extractVolcengineResults } = await import("../src/search/service");
  const data = {
    output: [
      {
        content: [
          {
            type: "output_text",
            text: "今天发布了新模型。",
            annotations: [
              { type: "url_citation", url: "https://example.com/a", title: "新闻 A" },
              { type: "url_citation", url: "https://example.com/a", title: "新闻 A（重复）" },
            ],
          },
        ],
      },
    ],
  };
  const results = extractVolcengineResults(data, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "https://example.com/a");
  assert.equal(results[0].title, "新闻 A");
});

test("extractVolcengineResults：无引用时回退到正文", async () => {
  const { extractVolcengineResults } = await import("../src/search/service");
  const results = extractVolcengineResults({ output_text: "纯文本答案" }, 3);
  assert.equal(results.length, 1);
  assert.equal(results[0].url, "");
  assert.match(results[0].snippet, /纯文本答案/);
});

test("formatSearchResults：无结果与有结果两种文本", async () => {
  const { formatSearchResults } = await import("../src/search/service");
  assert.match(formatSearchResults("空查询", []), /没有找到结果/);
  const text = formatSearchResults("测试", [{ title: "标题", url: "https://a.com", snippet: "摘要" }]);
  assert.match(text, /1\. 标题/);
  assert.match(text, /https:\/\/a\.com/);
  assert.match(text, /摘要/);
});
