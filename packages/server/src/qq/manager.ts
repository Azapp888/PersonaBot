import { botRepo } from "../db/repos/bots";
import { logger } from "../logger";
import type { Bot, QQMessageEvent } from "../types";
import { QQGateway, type GatewayStatus, type QQEventHandler } from "./gateway";

/**
 * 多 Bot 管理器：为每个启用的 Bot 维护一个 WebSocket 网关连接，
 * 并将归一化后的事件路由给消息处理管道。
 */
export class BotManager {
  private gateways = new Map<string, QQGateway>();
  private statuses = new Map<string, GatewayStatus>();
  private handler: QQEventHandler | null = null;

  setHandler(handler: QQEventHandler): void {
    this.handler = handler;
  }

  private dispatch(bot: Bot, event: QQMessageEvent): void {
    if (!this.handler) {
      logger.warn({ botId: bot.id }, "no QQ event handler registered");
      return;
    }
    try {
      this.handler(bot, event);
    } catch (err) {
      logger.error({ botId: bot.id, err: (err as Error).message }, "QQ event handler threw");
    }
  }

  async startAll(): Promise<void> {
    const bots = botRepo.listEnabled();
    for (const bot of bots) {
      await this.startBot(bot);
    }
    logger.info({ count: bots.length }, "QQ gateways started");
  }

  async startBot(bot: Bot): Promise<void> {
    if (this.gateways.has(bot.id)) return;
    const gateway = new QQGateway(bot, (b, e) => this.dispatch(b, e), (status) => {
      this.statuses.set(status.botId, status);
    });
    this.gateways.set(bot.id, gateway);
    await gateway.start();
  }

  stopBot(botId: string): void {
    const gateway = this.gateways.get(botId);
    if (gateway) {
      gateway.stop();
      this.gateways.delete(botId);
      this.statuses.set(botId, { botId, state: "stopped" });
    }
  }

  async restartBot(bot: Bot): Promise<void> {
    this.stopBot(bot.id);
    if (bot.enabled) {
      await this.startBot(bot);
    }
  }

  stopAll(): void {
    for (const id of [...this.gateways.keys()]) {
      this.stopBot(id);
    }
  }

  /** 依据数据库状态与内存状态做差异同步 */
  async reload(): Promise<void> {
    const bots = botRepo.list();
    const enabled = bots.filter((b) => b.enabled);
    const enabledIds = new Set(enabled.map((b) => b.id));

    for (const id of [...this.gateways.keys()]) {
      if (!enabledIds.has(id)) this.stopBot(id);
    }
    for (const bot of enabled) {
      if (!this.gateways.has(bot.id)) {
        await this.startBot(bot);
      }
    }
  }

  getStatuses(): GatewayStatus[] {
    const result: GatewayStatus[] = [];
    for (const bot of botRepo.list()) {
      const gw = this.gateways.get(bot.id);
      const status = this.statuses.get(bot.id) ?? gw?.status ?? { botId: bot.id, state: "stopped" as const };
      result.push({ ...status, botId: bot.id, ...(bot.enabled ? {} : { state: "stopped" as const }) });
    }
    return result;
  }

  getStatus(botId: string): GatewayStatus {
    return this.statuses.get(botId) ?? { botId, state: "stopped" };
  }
}

export const botManager = new BotManager();
