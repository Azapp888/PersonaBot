import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import Database from "better-sqlite3";
import { config } from "../config";
import { logger } from "../logger";

/**
 * SQLite 在线备份脚本：使用 `VACUUM INTO` 生成一致性快照（无需停机），
 * 并按保留数量清理旧备份。
 *
 * 用法：
 *   node packages/server/dist/scripts/backup.js [保留份数]
 */

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

export function backupDatabase(keep = 10): string {
  const source = resolve(config.dataDir, "personabot.db");
  if (!existsSync(source)) {
    throw new Error(`数据库不存在：${source}`);
  }
  const backupDir = resolve(config.dataDir, "backups");
  if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

  const target = join(backupDir, `personabot-${timestamp()}.db`);
  const db = new Database(source, { readonly: true });
  try {
    db.prepare("VACUUM INTO ?").run(target);
  } finally {
    db.close();
  }
  logger.info({ target }, "database backup created");

  pruneBackups(backupDir, keep);
  return target;
}

function pruneBackups(dir: string, keep: number): void {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith("personabot-") && f.endsWith(".db"))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const { f } of files.slice(keep)) {
    try {
      unlinkSync(join(dir, f));
    } catch (err) {
      logger.warn({ file: f, err: (err as Error).message }, "failed to prune backup");
    }
  }
}

// 作为脚本直接执行时运行
if (require.main === module) {
  try {
    const keep = Number(process.argv[2]) || 10;
    const path = backupDatabase(keep);
    console.log(`备份完成：${path}（保留最近 ${keep} 份）`);
  } catch (err) {
    console.error(`备份失败：${(err as Error).message}`);
    process.exit(1);
  }
}
