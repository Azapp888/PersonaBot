import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * 管理员密码哈希工具。
 * 存储格式：`scrypt$<saltHex>$<hashHex>`。
 * 支持「明文密码」与「scrypt 哈希」两种形式校验，便于平滑迁移。
 */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string, saltHex?: string): string {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function isHashed(stored: string): boolean {
  return stored.startsWith("scrypt$");
}

/** 常量时间比较，避免时序侧信道。 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 校验输入密码是否匹配存储值。
 * 若存储值为 scrypt 哈希则按哈希校验，否则按明文做常量时间比较。
 */
export function verifyPassword(input: string, stored: string, plainFallback?: string): boolean {
  if (isHashed(stored)) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const derived = scryptSync(input, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN).toString("hex");
    return safeEqual(derived, hashHex);
  }
  return safeEqual(input, plainFallback ?? stored);
}
