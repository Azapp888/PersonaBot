import { getDb } from "../db";
import { logger } from "../logger";
import { seedBuiltinSkills } from "../skills/manager";

export async function seed(): Promise<void> {
  getDb();
  await seedBuiltinSkills();
  logger.info("seed finished");
}
