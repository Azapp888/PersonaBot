import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstSentenceEnd, extractSseEvents, sseData } from "../src/llm/stream";

const dir = mkdtempSync(join(tmpdir(), "personabot-stream-"));
process.env.DATA_DIR = dir;
process.env.LOG_DIR = join(dir, "logs");

before(async () => {
  const { getDb } = await import("../src/db");
  const { runMigrations } = await import("../src/db/migrate");
  runMigrations(getDb());
});

test("句子边界：换行与中英文句末标点都能切分", () => {
  assert.equal(firstSentenceEnd("你好，在吗？我在。"), 6);
  assert.equal(firstSentenceEnd("第一行\n第二行"), 4);
  assert.equal(firstSentenceEnd("没有标点"), -1);
  assert.equal(firstSentenceEnd("Hi!"), 3);
});

test("SSE 解析：按空行切块，支持多行 data 与 \\r\\n", () => {
  const { events, rest } = extractSseEvents("data: a\r\n\r\ndata: b\n\ndata: partial");
  assert.equal(events.length, 2);
  assert.equal(sseData(events[0]), "a");
  assert.equal(sseData(events[1]), "b");
  assert.equal(rest, "data: partial");
});

test("Mock 流式：逐块产出并携带 usage/model 收尾块", async () => {
  const { MockProvider } = await import("../src/llm/mock");
  const provider = new MockProvider();
  let text = "";
  let sawUsage = false;
  for await (const chunk of provider.chatStream([{ role: "user", content: "你好" }])) {
    text += chunk.delta;
    if (chunk.usage) sawUsage = true;
  }
  assert.ok(text.length > 0);
  assert.equal(sawUsage, true);
});

test("端到端：simulateStream 产出 delta 与 done，TTFT 有记录", async () => {
  const { personaRepo } = await import("../src/db/repos/personas");
  const { modelRepo } = await import("../src/db/repos/models");
  const { messagePipeline } = await import("../src/pipeline/message-pipeline");

  modelRepo.create({ name: "mock", provider: "mock", modelId: "mock-model", enabled: true });
  const persona = personaRepo.create({
    name: "阿瑜",
    systemPrompt: "你是一名高二学生。",
  });

  const events: { type: string; text?: string; reply?: string; ttftMs?: number }[] = [];
  const result = await messagePipeline.simulateStream(persona.id, "u-stream", "在吗", (event) => {
    events.push(event as any);
  });

  const deltas = events.filter((e) => e.type === "delta");
  assert.ok(deltas.length > 0, "应至少有 1 个 delta");
  assert.equal(typeof deltas[0].ttftMs, "number");
  assert.ok((deltas[0].ttftMs ?? -1) >= 0);
  const done = events.find((e) => e.type === "done");
  assert.ok(done, "应有 done 事件");
  assert.equal(done?.reply, result.reply);
  assert.equal(deltas.map((e) => e.text).at(-1), result.reply);
});

test("端到端：signal 中断时产出 stop 事件", async () => {
  const { personaRepo } = await import("../src/db/repos/personas");
  const { messagePipeline } = await import("../src/pipeline/message-pipeline");
  const persona = personaRepo.list()[0];

  const abort = new AbortController();
  const types: string[] = [];
  const pending = messagePipeline
    .simulateStream(
      persona.id,
      "u-abort",
      "在吗",
      (event) => {
        types.push(event.type);
        if (event.type === "delta") abort.abort();
      },
      abort.signal,
    )
    .catch(() => undefined);
  // 给流式一点时间触发 delta 后再中断
  setTimeout(() => abort.abort(), 20);
  await pending;
  assert.ok(types.includes("stop"), `应收到 stop，实际：${types.join(",")}`);
});
