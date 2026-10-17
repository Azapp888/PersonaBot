import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageLimitFor,
  parseImageDataUrl,
  sniffImageMime,
  toAnthropicImageBlock,
  toGeminiPart,
  toImageDataUrl,
  toOpenAIPart,
} from "../src/llm/multimodal";
import { toApiMessages } from "../src/llm/openai";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const GIF = Buffer.from("GIF89a......", "ascii");
const WEBP = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP....", "ascii")]);
const BMP = Buffer.from("BM......", "ascii");

test("按文件头识别真实图片格式，拒绝伪装/不支持格式", () => {
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(GIF), "image/gif");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(BMP), null);
  assert.equal(sniffImageMime(Buffer.from("<svg></svg>")), null);
});

test("图片转 data:URL 使用真实格式而非声明类型", () => {
  const { dataUrl, mediaType } = toImageDataUrl(JPEG);
  assert.equal(mediaType, "image/jpeg");
  assert.ok(dataUrl.startsWith("data:image/jpeg;base64,"));
  assert.throws(() => toImageDataUrl(BMP), /不支持的图片格式/);
});

test("data URL 解析：只接受 base64 图片", () => {
  assert.deepEqual(parseImageDataUrl("data:image/png;base64,AAAA"), { mediaType: "image/png", data: "AAAA" });
  assert.equal(parseImageDataUrl("data:image/svg+xml;base64,AAAA"), null);
  assert.equal(parseImageDataUrl("https://example.com/a.png"), null);
});

test("厂商图片上限：Claude 5MB、Gemini 不收 GIF、通义不收 GIF", () => {
  assert.equal(imageLimitFor("anthropic").maxBytes, 5 * 1024 * 1024);
  assert.ok(!imageLimitFor("google").mimes.includes("image/gif"));
  assert.ok(!imageLimitFor("dashscope").mimes.includes("image/gif"));
  assert.ok(imageLimitFor("openai").mimes.includes("image/gif"));
});

test("OpenAI 兼容：content 数组保留 image_url 并补默认 detail", () => {
  const part = toOpenAIPart({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
  assert.deepEqual(part, {
    type: "image_url",
    image_url: { url: "data:image/png;base64,AAAA", detail: "auto" },
  });

  const messages = toApiMessages([
    { role: "user", content: [{ type: "text", text: "看图" }, { type: "image_url", image_url: { url: "https://x/a.png", detail: "high" } }] },
  ]) as any[];
  assert.equal(messages[0].content[1].image_url.detail, "high");
});

test("Anthropic：data URL 转 base64 source，https 转 url source", () => {
  assert.deepEqual(toAnthropicImageBlock({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }), {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "AAAA" },
  });
  assert.deepEqual(toAnthropicImageBlock({ type: "image_url", image_url: { url: "https://x/a.png" } }), {
    type: "image",
    source: { type: "url", url: "https://x/a.png" },
  });
  assert.throws(
    () => toAnthropicImageBlock({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, ["image/jpeg"]),
    /不支持 image\/png/,
  );
});

test("Gemini 原生：inline_data 使用纯 base64 与 mime_type", () => {
  assert.deepEqual(toGeminiPart({ type: "image_url", image_url: { url: "data:image/webp;base64,AAAA" } }), {
    inline_data: { mime_type: "image/webp", data: "AAAA" },
  });
  assert.throws(
    () => toGeminiPart({ type: "image_url", image_url: { url: "https://x/a.webp" } }),
    /需要 data:image/,
  );
});
