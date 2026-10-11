import { exec } from "node:child_process";
import { settingsService } from "../settings/service";

export interface ShellResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * 明确的灾难性命令黑名单：即便 Bot 已开启服务器 Agent，也拒绝执行，
 * 防止误删系统、破坏磁盘、关机或 fork 炸弹等不可逆操作。
 */
const BLOCKED_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /:\s*\(\s*\)\s*\{[\s\S]*\}\s*;\s*:/, reason: "疑似 fork 炸弹" },
  { re: /\bmkfs(\.\w+)?\b/i, reason: "格式化文件系统" },
  { re: /\bmke2fs\b/i, reason: "格式化文件系统" },
  { re: /\bdd\b[^\n]*\bof=\/dev\//i, reason: "直接写入块设备" },
  { re: /[>|]\s*\/dev\/[sh]d[a-z]?/i, reason: "直接写入块设备" },
  { re: /\b(shutdown|reboot|poweroff|halt)\b/i, reason: "关机/重启系统" },
  { re: /\binit\s+[06]\b/i, reason: "切换运行级别/关机" },
  { re: /\brm\b[^\n]*\s(\/\*?|~\/?|\$HOME\/?|\$\{HOME\}\/?)(?:\s|$)/i, reason: "递归删除根目录或家目录" },
  { re: /\bchmod\b[^\n]*-[a-z]*R[a-z]*[^\n]*\s\/\s*$/i, reason: "递归修改根目录权限" },
  { re: /\biptables\b[^\n]*\s-F\b/i, reason: "清空防火墙规则" },
  { re: /\b(userdel|groupdel)\b/i, reason: "删除系统用户/用户组" },
];

/** 返回拦截原因；命令安全则返回 null。 */
export function blockedCommandReason(command: string): string | null {
  const normalized = command.replace(/\s+/g, " ").trim();
  for (const { re, reason } of BLOCKED_PATTERNS) {
    if (re.test(normalized) || re.test(command)) return reason;
  }
  return null;
}

/** 解析服务器 Agent 命令的用户白名单（逗号/换行/分号分隔）；空表示不限制。 */
export function parseAllowedUsers(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\n,，;；\s]+/)
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

/** 判断指定用户是否被允许执行服务器 Agent 命令；白名单为空表示允许所有人。 */
export function isUserAllowedForShell(raw: string | undefined, userId: string): boolean {
  const allowed = parseAllowedUsers(raw);
  if (!allowed.length) return true;
  return allowed.includes(userId);
}

/**
 * 在本机执行一条 shell 命令。
 * 具备超时、输出截断与灾难性命令拦截保护，命令由 Bot 所属的服务器 Agent 开关控制。
 */
export function runShellCommand(command: string): Promise<ShellResult> {
  const blocked = blockedCommandReason(command);
  if (blocked) {
    return Promise.resolve({
      ok: false,
      output: `该命令被安全策略拦截：${blocked}。如需执行请通过服务器终端手动操作。`,
      exitCode: null,
      timedOut: false,
    });
  }

  const settings = settingsService.get();
  const timeout = Math.max(1000, settings.agentShellTimeoutMs || 15000);
  const maxChars = Math.max(200, settings.agentShellMaxOutputChars || 3500);
  const cwd = process.env.AGENT_WORKDIR || process.cwd();

  return new Promise((resolve) => {
    exec(
      command,
      { timeout, maxBuffer: 2 * 1024 * 1024, cwd, windowsHide: true },
      (err, stdout, stderr) => {
        const timedOut = !!(err && (err as any).killed && (err as any).signal === "SIGTERM");
        let output = `${stdout ?? ""}${stderr ?? ""}`.trim();
        if (!output && err && !timedOut) output = (err as Error).message;
        let truncated = false;
        if (output.length > maxChars) {
          output = output.slice(0, maxChars);
          truncated = true;
        }
        const code =
          err && typeof (err as any).code === "number" ? ((err as any).code as number) : err ? 1 : 0;
        resolve({
          ok: !err,
          output: output + (truncated ? "\n…（输出已截断）" : ""),
          exitCode: code,
          timedOut,
        });
      },
    );
  });
}
