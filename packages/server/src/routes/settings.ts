import type { FastifyInstance } from "fastify";
import { settingsService } from "../settings/service";
import { rescheduleSkillUpdate } from "../cron/scheduler";
import { config } from "../config";
import type { AppSettings } from "../types";

/** 对外呈现设置：剔除敏感字段明文，只保留 *Set 标记。 */
function present(settings: AppSettings) {
  const { paintingApiKey, githubToken, ...rest } = settings;
  return { ...rest, paintingApiKeySet: !!paintingApiKey, githubTokenSet: !!githubToken };
}

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", { preHandler: [app.authenticate] }, async () => {
    return present(settingsService.get());
  });

  app.put("/api/settings", { preHandler: [app.authenticate] }, async (request) => {
    const body = request.body as Record<string, unknown>;
    const patch = { ...body } as any;
    // 空字符串表示不修改敏感字段
    if (!patch.paintingApiKey) delete patch.paintingApiKey;
    if (!patch.githubToken) delete patch.githubToken;
    if (patch.skillUpdateCron) rescheduleSkillUpdate();
    const updated = settingsService.update(patch);
    return present(updated);
  });

  app.get("/api/system/info", { preHandler: [app.authenticate] }, async () => {
    const mem = process.memoryUsage();
    return {
      nodeVersion: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(process.uptime()),
      memoryRssMb: Number((mem.rss / 1024 / 1024).toFixed(1)),
      memoryHeapMb: Number((mem.heapUsed / 1024 / 1024).toFixed(1)),
      dataDir: config.dataDir,
      logDir: config.logDir,
      cachePolicy: "System Prompt 前缀稳定 + 只追加会话 + 摘要追加末尾",
    };
  });
}
