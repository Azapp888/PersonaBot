import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "../logger";
import { settingsService } from "../settings/service";

/** 从起点向上查找含 .git 的仓库根目录。 */
export function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/** 在指定工作目录执行命令（git / pnpm），带超时与输出上限。 */
function run(cmd: string, cwd: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    exec(
      cmd,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === "number" ? ((err as any).code as number) : err ? 1 : 0;
        resolve({ ok: !err, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim(), code });
      },
    );
  });
}

function repoRoot(): string | null {
  const fromEnv = process.env.PERSONABOT_REPO_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return findRepoRoot(__dirname) ?? findRepoRoot(process.cwd());
}

interface UpdateInfo {
  available: boolean;
  ok: boolean;
  repoRoot: string | null;
  repoUrl: string | null;
  branch: string;
  currentCommit: string | null;
  currentCommitDate: string | null;
  remoteCommit: string | null;
  remoteCommitDate: string | null;
  behind: number;
  ahead: number;
  remoteMessage: string | null;
  message: string;
}

/** 检测当前分支是否落后于远端。执行 git fetch，不修改工作区。 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const root = repoRoot();
  const empty: UpdateInfo = {
    available: false,
    ok: false,
    repoRoot: root,
    repoUrl: null,
    branch: "main",
    currentCommit: null,
    currentCommitDate: null,
    remoteCommit: null,
    remoteCommitDate: null,
    behind: 0,
    ahead: 0,
    remoteMessage: null,
    message: "",
  };
  if (!root) {
    return { ...empty, message: "未找到 Git 仓库（不是通过 git clone 部署）。请手动更新。" };
  }

  const settings = settingsService.get();
  const branch = (settings as any).updateBranch || "main";

  const inGit = await run("git rev-parse --is-inside-work-tree", root, 10000);
  if (!inGit.ok || inGit.stdout !== "true") {
    return { ...empty, message: "当前目录不是 Git 工作区，无法检查更新。" };
  }

  const remoteUrlRes = await run("git config --get remote.origin.url", root, 10000);
  const repoUrl = remoteUrlRes.ok ? remoteUrlRes.stdout : null;

  const currentRes = await run("git rev-parse HEAD", root, 10000);
  const currentCommit = currentRes.ok ? currentRes.stdout : null;
  const currentDateRes = await run("git show -s --format=%cI HEAD", root, 10000);
  const currentCommitDate = currentDateRes.ok ? currentDateRes.stdout : null;

  const fetchRes = await run(`git fetch --prune origin ${branch}`, root, 60000);
  if (!fetchRes.ok) {
    return {
      ...empty,
      repoUrl,
      branch,
      currentCommit,
      currentCommitDate,
      message: `拉取远端信息失败：${fetchRes.stderr || fetchRes.stdout || "未知错误"}`,
    };
  }

  const remoteCommitRes = await run(`git rev-parse origin/${branch}`, root, 10000);
  const remoteCommit = remoteCommitRes.ok ? remoteCommitRes.stdout : null;

  const remoteDateRes = await run(`git show -s --format=%cI origin/${branch}`, root, 10000);
  const remoteCommitDate = remoteDateRes.ok ? remoteDateRes.stdout : null;

  const remoteMsgRes = await run(`git show -s --format=%s origin/${branch}`, root, 10000);
  const remoteMessage = remoteMsgRes.ok ? remoteMsgRes.stdout : null;

  let behind = 0;
  let ahead = 0;
  const countRes = await run(`git rev-list --left-right --count HEAD...origin/${branch}`, root, 15000);
  if (countRes.ok) {
    const [a, b] = countRes.stdout.split(/\s+/).map((n) => Number(n));
    ahead = Number.isFinite(a) ? a : 0;
    behind = Number.isFinite(b) ? b : 0;
  }

  return {
    available: behind > 0,
    ok: true,
    repoRoot: root,
    repoUrl,
    branch,
    currentCommit,
    currentCommitDate,
    remoteCommit,
    remoteCommitDate,
    behind,
    ahead,
    remoteMessage,
    message:
      behind > 0
        ? `发现新版本，落后远端 ${behind} 个提交`
        : ahead > 0
          ? `本地领先远端 ${ahead} 个提交（无需更新）`
          : "已是最新版本",
  };
}

export interface UpdateStep {
  name: string;
  ok: boolean;
  output: string;
}

export interface UpdateResult {
  ok: boolean;
  steps: UpdateStep[];
  message: string;
  previousCommit: string | null;
  newCommit: string | null;
  restartRequired: boolean;
}

/** 执行一键更新：git pull --ff-only + 安装依赖 + 构建。 */
export async function applyUpdate(): Promise<UpdateResult> {
  const root = repoRoot();
  const steps: UpdateStep[] = [];
  if (!root) {
    return { ok: false, steps, message: "未找到 Git 仓库，无法自动更新。", previousCommit: null, newCommit: null, restartRequired: false };
  }

  const settings = settingsService.get();
  const branch = (settings as any).updateBranch || "main";

  const previousRes = await run("git rev-parse HEAD", root, 10000);
  const previousCommit = previousRes.ok ? previousRes.stdout : null;

  const statusRes = await run("git status --porcelain", root, 10000);
  const dirty = statusRes.ok && statusRes.stdout.length > 0;
  if (dirty) {
    steps.push({ name: "检查工作区", ok: false, output: "工作区存在未提交改动，已中止更新，避免覆盖你的修改。请先提交或备份后再试。" });
    return { ok: false, steps, message: "工作区不干净，已中止更新。", previousCommit, newCommit: previousCommit, restartRequired: false };
  }
  steps.push({ name: "检查工作区", ok: true, output: "工作区干净" });

  const pullRes = await run(`git pull --ff-only origin ${branch}`, root, 120000);
  steps.push({ name: "拉取代码", ok: pullRes.ok, output: pullRes.stdout + (pullRes.stderr ? `\n${pullRes.stderr}` : "") });
  if (!pullRes.ok) {
    return { ok: false, steps, message: `拉取代码失败：${pullRes.stderr || pullRes.stdout}`, previousCommit, newCommit: previousCommit, restartRequired: false };
  }

  const installRes = await run("pnpm install --frozen-lockfile || pnpm install", root, 300000);
  steps.push({ name: "安装依赖", ok: installRes.ok, output: installRes.stdout + (installRes.stderr ? `\n${installRes.stderr}` : "") });
  if (!installRes.ok) {
    return { ok: false, steps, message: "依赖安装失败，代码已更新但需手动处理。", previousCommit, newCommit: previousCommit, restartRequired: true };
  }

  const buildRes = await run("pnpm build", root, 300000);
  steps.push({ name: "构建", ok: buildRes.ok, output: buildRes.stdout + (buildRes.stderr ? `\n${buildRes.stderr}` : "") });
  if (!buildRes.ok) {
    return { ok: false, steps, message: "构建失败，代码已更新但需手动处理。", previousCommit, newCommit: previousCommit, restartRequired: true };
  }

  const newRes = await run("git rev-parse HEAD", root, 10000);
  const newCommit = newRes.ok ? newRes.stdout : previousCommit;

  const changed = previousCommit !== newCommit;
  logger.info({ previousCommit, newCommit, changed }, "self update applied");
  return {
    ok: true,
    steps,
    message: changed ? "更新完成，请重启服务以生效。" : "已是最新版本，依赖与构建已刷新。",
    previousCommit,
    newCommit,
    restartRequired: true,
  };
}

export function updateRepoRoot(): string {
  return resolve(repoRoot() ?? process.cwd());
}
