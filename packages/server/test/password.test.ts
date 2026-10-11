import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, isHashed, verifyPassword } from "../src/utils/password";

test("hashPassword 生成 scrypt 格式且可校验", () => {
  const stored = hashPassword("s3cret!");
  assert.ok(isHashed(stored));
  assert.equal(stored.split("$").length, 3);
  assert.equal(verifyPassword("s3cret!", stored), true);
  assert.equal(verifyPassword("wrong", stored), false);
});

test("相同密码每次生成不同盐", () => {
  assert.notEqual(hashPassword("abc"), hashPassword("abc"));
});

test("明文存储时按常量时间比较", () => {
  assert.equal(verifyPassword("changeme", "changeme"), true);
  assert.equal(verifyPassword("nope", "changeme"), false);
});

test("哈希缺失时可回退到明文", () => {
  assert.equal(verifyPassword("changeme", "scrypt$bad", "changeme"), false);
});
