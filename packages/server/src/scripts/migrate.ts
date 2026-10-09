import { ensureRuntimeDirs } from "../config";
import { getDb, closeDb } from "../db";
import { runMigrations } from "../db/migrate";
import { logger } from "../logger";
import { seedBuiltinSkills } from "../skills/manager";

async function main(): Promise<void> {
  ensureRuntimeDirs();
  getDb();
  runMigrations();
  await seedBuiltinSkills();
  logger.info("migrate done");
  closeDb();
}

main().catch((err) => {
  logger.error({ err }, "migrate failed");
  process.exit(1);
});
