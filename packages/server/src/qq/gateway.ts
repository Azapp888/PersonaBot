import WebSocket from "ws";
import { logger } from "../logger";
import type { Bot, QQMessageEvent } from "../types";
import { QQApiClient } from "./client";
import { getAccessToken } from "./token";
import { QQ_OP, type QQGatewayPayload } from "./types";
import { config } from "../config";

export type QQEventHandler = (bot: Bot, event: QQMessageEvent) => void;

export interface GatewayStatus {
  botId: string;
  state: "connecting" | "connected" | "reconnecting" | "stopped" | "error";
  lastError?: string;
  connectedAt?: number;
}

/**
 * 单个 QQ Bot 的 WebSocket 网关连接。
 * 负责鉴权、心跳、断线重连与事件解析。
 */
export class QQGateway {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval = 41250;
  private lastSeq: number | null = null;
  private sessionId: string | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private readonly client: QQApiClient;
  private readonly onEvent: QQEventHandler;
  private readonly onStatus?: (status: GatewayStatus) => void;
  private state: GatewayStatus["state"] = "stopped";

  constructor(private readonly bot: Bot, onEvent: QQEventHandler, onStatus?: (s: GatewayStatus) => void) {
    this.client = new QQApiClient(bot);
    this.onEvent = onEvent;
    this.onStatus = onStatus;
  }

  get status(): GatewayStatus {
    return { botId: this.bot.id, state: this.state };
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setState("stopped");
  }

  private setState(state: GatewayStatus["state"], lastError?: string): void {
    this.state = state;
    this.onStatus?.({ botId: this.bot.id, state, lastError, connectedAt: state === "connected" ? Date.now() : undefined });
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    try {
      this.setState("connecting");
      const gateway = await this.client.getGateway();
      const url = gateway.url;
      const token = await getAccessToken(this.bot);
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.on("open", () => {
        logger.info({ botId: this.bot.id }, "QQ gateway websocket opened");
      });

      ws.on("message", (raw) => this.handleMessage(raw.toString(), token));

      ws.on("close", (code, reason) => {
        logger.warn({ botId: this.bot.id, code, reason: reason.toString() }, "QQ gateway closed");
        this.clearTimers();
        if (!this.stopped) this.scheduleReconnect();
      });

      ws.on("error", (err) => {
        logger.error({ botId: this.bot.id, err: err.message }, "QQ gateway error");
        this.setState("error", err.message);
      });
    } catch (err) {
      const message = (err as Error).message;
      logger.error({ botId: this.bot.id, err: message }, "QQ gateway connect failed");
      this.setState("error", message);
      if (!this.stopped) this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.setState("reconnecting");
    this.reconnectAttempts += 1;
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private handleMessage(raw: string, token: string): void {
    let payload: QQGatewayPayload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (payload.s !== undefined) this.lastSeq = payload.s;

    switch (payload.op) {
      case QQ_OP.HELLO: {
        this.heartbeatInterval = payload.d?.heartbeat_interval ?? 41250;
        this.identify(token);
        this.startHeartbeat();
        break;
      }
      case QQ_OP.HEARTBEAT_ACK:
        break;
      case QQ_OP.HEARTBEAT:
        this.sendHeartbeat();
        break;
      case QQ_OP.RECONNECT:
        logger.info({ botId: this.bot.id }, "server requested reconnect");
        this.reconnect();
        break;
      case QQ_OP.INVALID_SESSION:
        logger.warn({ botId: this.bot.id }, "invalid session, re-identifying");
        this.sessionId = null;
        this.lastSeq = null;
        this.reconnect();
        break;
      case QQ_OP.DISPATCH:
        this.reconnectAttempts = 0;
        this.setState("connected");
        if (payload.t === "READY") {
          this.sessionId = payload.d?.session_id ?? null;
          logger.info({ botId: this.bot.id, sessionId: this.sessionId }, "QQ gateway READY");
        }
        this.dispatch(payload.t, payload.d);
        break;
      default:
        break;
    }
  }

  private identify(token: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const intents = config.qq.intents;
    if (this.sessionId && this.lastSeq !== null) {
      this.ws.send(
        JSON.stringify({
          op: QQ_OP.RESUME,
          d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq },
        }),
      );
      return;
    }
    this.ws.send(
      JSON.stringify({
        op: QQ_OP.IDENTIFY,
        d: {
          token: `QQBot ${token}`,
          intents,
          shard: [0, 1],
          properties: { $os: process.platform, $browser: "personabot", $device: "personabot" },
        },
      }),
    );
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), this.heartbeatInterval);
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ op: QQ_OP.HEARTBEAT, d: this.lastSeq }));
  }

  private reconnect(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.clearTimers();
    if (!this.stopped) this.scheduleReconnect();
  }

  private dispatch(type: string | undefined, d: any): void {
    if (!type || !d) return;
    let event: QQMessageEvent | null = null;
    switch (type) {
      case "C2C_MESSAGE_CREATE":
        event = {
          id: d.id,
          type: "c2c",
          content: stripMentions(d.content ?? ""),
          authorId: d.author?.user_openid ?? d.author?.id,
          msgId: d.id,
          timestamp: parseTime(d.timestamp),
          raw: d,
        };
        break;
      case "GROUP_AT_MESSAGE_CREATE":
        event = {
          id: d.id,
          type: "group",
          content: stripMentions(d.content ?? ""),
          authorId: d.author?.member_openid ?? d.author?.id,
          msgId: d.id,
          groupOpenid: d.group_openid,
          timestamp: parseTime(d.timestamp),
          raw: d,
        };
        break;
      case "AT_MESSAGE_CREATE":
        event = {
          id: d.id,
          type: "guild",
          content: stripMentions(d.content ?? ""),
          authorId: d.author?.id,
          msgId: d.id,
          guildId: d.guild_id,
          channelId: d.channel_id,
          timestamp: parseTime(d.timestamp),
          raw: d,
        };
        break;
      case "DIRECT_MESSAGE_CREATE":
        event = {
          id: d.id,
          type: "direct",
          content: stripMentions(d.content ?? ""),
          authorId: d.author?.id,
          msgId: d.id,
          guildId: d.guild_id,
          channelId: d.channel_id,
          timestamp: parseTime(d.timestamp),
          raw: d,
        };
        break;
      default:
        return;
    }
    if (event && event.authorId) {
      this.onEvent(this.bot, event);
    }
  }
}

function stripMentions(content: string): string {
  return content.replace(/<@!?\d+>/g, "").replace(/<@![^>]+>/g, "").trim();
}

function parseTime(ts?: string | number): number {
  if (!ts) return Date.now();
  const n = typeof ts === "string" ? Date.parse(ts) : ts;
  return Number.isFinite(n) ? n : Date.now();
}
