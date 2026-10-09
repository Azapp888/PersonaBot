import { config } from "../config";
import { logger } from "../logger";
import { getAccessToken, invalidateToken } from "./token";
import type { Bot } from "../types";

export interface GatewayInfo {
  url: string;
}

export interface SendResult {
  id?: string;
  timestamp?: number;
}

/**
 * QQ 官方机器人 API v2 (HTTPS OpenAPI) 客户端。
 * 负责发送消息、获取 WebSocket 网关地址。
 */
export class QQApiClient {
  constructor(private readonly bot: Bot) {}

  private async request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    const token = await getAccessToken(this.bot);
    const res = await fetch(`${config.qq.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && retry) {
      invalidateToken(this.bot.id);
      return this.request<T>(method, path, body, false);
    }

    const text = await res.text();
    if (!res.ok) {
      logger.warn({ botId: this.bot.id, path, status: res.status, body: text }, "QQ OpenAPI error");
      throw new Error(`QQ OpenAPI ${path} 失败: ${res.status} ${text}`);
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return {} as T;
    }
  }

  getGateway(): Promise<GatewayInfo> {
    return this.request<GatewayInfo>("GET", "/gateway");
  }

  sendC2C(userOpenid: string, content: string, msgId?: string, msgSeq = 1): Promise<SendResult> {
    return this.request<SendResult>("POST", `/v2/users/${userOpenid}/messages`, {
      content,
      msg_type: 0,
      msg_id: msgId,
      msg_seq: msgSeq,
    });
  }

  sendGroup(groupOpenid: string, content: string, msgId?: string, msgSeq = 1): Promise<SendResult> {
    return this.request<SendResult>("POST", `/v2/groups/${groupOpenid}/messages`, {
      content,
      msg_type: 0,
      msg_id: msgId,
      msg_seq: msgSeq,
    });
  }

  sendGuildChannel(channelId: string, content: string, msgId?: string): Promise<SendResult> {
    return this.request<SendResult>("POST", `/channels/${channelId}/messages`, {
      content,
      msg_id: msgId,
    });
  }

  sendDirect(guildId: string, content: string, msgId?: string): Promise<SendResult> {
    return this.request<SendResult>("POST", `/dms/${guildId}/messages`, {
      content,
      msg_id: msgId,
    });
  }

  /** 发送图片（富媒体）：v2 支持 file_info，此处作为扩展点保留 */
  sendImageC2C(userOpenid: string, fileInfo: string, msgId?: string, msgSeq = 1): Promise<SendResult> {
    return this.request<SendResult>("POST", `/v2/users/${userOpenid}/messages`, {
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_id: msgId,
      msg_seq: msgSeq,
    });
  }

  /** 上传富媒体文件（图片）并返回 file_info，用于 v2 富媒体消息 */
  async uploadFile(
    scope: { type: "c2c"; openid: string } | { type: "group"; groupOpenid: string },
    file: { url?: string; base64?: string },
    fileType = 1,
  ): Promise<string | null> {
    const token = await getAccessToken(this.bot);
    const path =
      scope.type === "c2c" ? `/v2/users/${scope.openid}/files` : `/v2/groups/${scope.groupOpenid}/files`;
    const form = new FormData();
    form.append("file_type", String(fileType));
    form.append("srv_send_msg", "false");
    if (file.url) {
      form.append("url", file.url);
    } else if (file.base64) {
      const buf = Buffer.from(file.base64, "base64");
      form.append("file_data", new Blob([buf], { type: "image/png" }), "image.png");
    } else {
      return null;
    }
    const res = await fetch(`${config.qq.apiBase}${path}`, {
      method: "POST",
      headers: { Authorization: `QQBot ${token}` },
      body: form as any,
    });
    const text = await res.text();
    if (!res.ok) {
      logger.warn({ botId: this.bot.id, path, status: res.status, body: text }, "QQ media upload error");
      return null;
    }
    try {
      return (JSON.parse(text)?.file_info as string) ?? null;
    } catch {
      return null;
    }
  }

  sendImageByFileInfo(
    scope: { type: "c2c"; openid: string } | { type: "group"; groupOpenid: string },
    fileInfo: string,
    msgId?: string,
    msgSeq = 1,
  ): Promise<SendResult> {
    if (scope.type === "c2c") return this.sendImageC2C(scope.openid, fileInfo, msgId, msgSeq);
    return this.request<SendResult>("POST", `/v2/groups/${scope.groupOpenid}/messages`, {
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_id: msgId,
      msg_seq: msgSeq,
    });
  }
}
