import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QQ_IMAGE_MAX_BYTES,
  QQ_MAX_ATTACHMENTS,
  isQQImageAttachment,
  mediaPlaceholder,
  normalizeMediaUrl,
  pickQQImages,
} from "../src/qq/capabilities";

test("QQ 平台约束常量与官方一致", () => {
  assert.equal(QQ_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(QQ_MAX_ATTACHMENTS, 5);
});

test("按 content_type 或扩展名判定图片附件", () => {
  assert.equal(isQQImageAttachment({ url: "x", contentType: "image/png" }), true);
  assert.equal(isQQImageAttachment({ url: "x", contentType: "image" }), true);
  assert.equal(isQQImageAttachment({ url: "https://a/b.jpg" }), true);
  assert.equal(isQQImageAttachment({ url: "https://a/b.pdf", filename: "b.pdf" }), false);
});

test("无扩展名的 QQ 媒体地址仍能按 content_type 识别为图片", () => {
  const att = {
    url: "https://multimedia.nt.qq.com.cn/download?appid=123&fileid=abc&spec=0&rkey=xyz",
    contentType: "image/jpeg",
  };
  assert.equal(isQQImageAttachment(att), true);
  const { images } = pickQQImages([att]);
  assert.equal(images.length, 1);
  assert.equal(images[0].url, att.url);
});

test("normalizeMediaUrl 补全缺失的协议头", () => {
  assert.equal(normalizeMediaUrl("gchat.qpic.cn/a?b=1"), "https://gchat.qpic.cn/a?b=1");
  assert.equal(normalizeMediaUrl("//gchat.qpic.cn/a?b=1"), "https://gchat.qpic.cn/a?b=1");
  assert.equal(normalizeMediaUrl("https://gchat.qpic.cn/a?b=1"), "https://gchat.qpic.cn/a?b=1");
  assert.equal(normalizeMediaUrl("  "), undefined);
  assert.equal(normalizeMediaUrl(undefined), undefined);
});

test("pickQQImages：仅取图片，且按平台上限截断到 5 张", () => {
  const atts = [
    { url: "1.png" }, { url: "2.jpg" }, { url: "3.png" }, { url: "4.png" },
    { url: "5.png" }, { url: "6.png" }, { url: "doc.pdf", filename: "doc.pdf" },
  ];
  const { images, overflow } = pickQQImages(atts);
  assert.equal(images.length, 5);
  assert.equal(overflow, 1);
  assert.ok(images.every((a) => !a.url.endsWith(".pdf")));
});

test("mediaPlaceholder：图片消息用 (image)", () => {
  assert.equal(mediaPlaceholder([{ url: "x", contentType: "image/png" }]), "(image)");
  assert.equal(mediaPlaceholder([{ url: "x", filename: "a.txt" }]), "(file)");
  assert.equal(mediaPlaceholder([]), null);
  assert.equal(mediaPlaceholder(undefined), null);
});
