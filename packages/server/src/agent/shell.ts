import { exec } from "node:child_process";
import { settingsService } from "../settings/service";

export interface ShellResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * 在本机执行一条 shell 命令。
 * 具备超时与输出截断保护，命令由 Bot 所属的服务器 Agent 开关控制。
 */
export function runShellCommand(command: string): Promise<ShellResult> {
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
