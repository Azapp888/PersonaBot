import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "../config";

const KEY = createHash("sha256").update(config.encryptionKey).digest();

/**
 * 使用 AES-256-GCM 加密敏感字段（如 QQ ClientSecret、API Key）。
 * 输出格式: base64(iv).base64(tag).base64(cipher)
 */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const parts = payload.split(".");
  if (parts.length !== 3) return payload; // 兼容明文
  try {
    const iv = Buffer.from(parts[0], "base64");
    const tag = Buffer.from(parts[1], "base64");
    const data = Buffer.from(parts[2], "base64");
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString("utf8");
  } catch {
    return payload;
  }
}

export function generateToken(prefix = ""): string {
  return prefix + randomBytes(16).toString("hex");
}

export function hmac(value: string): string {
  return createHmac("sha256", config.admin.jwtSecret).update(value).digest("hex");
}
