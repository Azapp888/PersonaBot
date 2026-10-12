import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { logger } from "../logger";
import { settingsService } from "../settings/service";
import { fetchWithTimeout } from "../utils/http";

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

export type DeployMode = "git" | "docker" | "unknown";

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

/** 是否运行在容器中：/.dockerenv 存在，或 cgroup 中含 docker/kubepods。 */
export function isRunningInContainer(): boolean {
  if (process.env.PERSONABOT_DEPLOY === "docker") return true;
  if (existsSync("/.dockerenv")) return true;
  if (process.env.KUBERNETES_SERVICE_HOST) return true;
  return false;
}

/** 识别部署方式：git 仓库优先，其次容器，最后未知。可用 PERSONABOT_FORCE_DEPLOY_MODE 强制覆盖。 */
export function detectDeployMode(): DeployMode {
  const forced = process.env.PERSONABOT_FORCE_DEPLOY_MODE;
  if (forced === "git" || forced === "docker" || forced === "unknown") return forced;
  if (repoRoot()) return "git";
  if (isRunningInContainer()) return "docker";
  return "unknown";
}

/** 当前构建的版本标识：Docker 构建时通过 GIT_COMMIT 注入，本地回退到 package 版本。 */
export function currentVersion(): string | null {
  return process.env.GIT_COMMIT || process.env.APP_VERSION || process.env.npm_package_version || null;
}

function repoRoot(): string | null {
  const fromEnv = process.env.PERSONABOT_REPO_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return findRepoRoot(__dirname) ?? findRepoRoot(process.cwd());
}

export interface UpdateInfo {
  available: boolean;
  ok: boolean;
  mode: DeployMode;
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
  /** 非 git 部署时给用户的操作指引。 */
  guidance: string | null;
  /** 能否在本进程内执行一键更新。 */
  canAutoUpdate: boolean;
}

const DOCKER_GUIDANCE = [
  "Docker 部署无法在容器内自动更新，请在宿主机项目目录执行：",
  "  docker compose build --pull",
  "  docker compose up -d",
  "（若使用镜像仓库：docker compose pull && docker compose up -d）",
].join("\n");

function parseRepo(url: string): { owner: string; repo: string } | null {
  const m = url
    .replace(/\.git$/, "")
    .match(/github\.com[:/]([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

interface GhCommit {
  sha: string;
  commit: { message: string; committer?: { date?: string }; author?: { date?: string } };
}

/** 通过 GitHub API 查询分支最新提交（不依赖本地 git，供 Docker 部署使用）。 */
async function fetchRemoteCommit(
  repoUrl: string,
  branch: string,
  token?: string,
  timeoutMs = 20000,
): Promise<{ sha: string; date: string | null; message: string } | null> {
  const parsed = parseRepo(repoUrl);
  if (!parsed) return null;
  const headers: Record<string, string> = { "User-Agent": "PersonaBot", Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${branch}`,
    { headers, timeoutMs },
  );
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = (await res.json()) as GhCommit;
  return {
    sha: data.sha,
    date: data.commit.committer?.date ?? data.commit.author?.date ?? null,
    message: data.commit.message?.split("\n")[0] ?? null,
  } as any;
}

/** 检测是否有新版本。git 部署走本地 git，容器部署走 GitHub API。 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const settings = settingsService.get() as any;
  const branch = settings.updateBranch || "main";
  const configuredRepoUrl: string | null = settings.updateRepoUrl || null;
  const token: string | undefined = settings.githubToken || undefined;
  const root = repoRoot();
  const mode = detectDeployMode();

  const base: UpdateInfo = {
    available: false,
    ok: false,
    mode,
    repoRoot: root,
    repoUrl: configuredRepoUrl,
    branch,
    currentCommit: null,
    currentCommitDate: null,
    remoteCommit: null,
    remoteCommitDate: null,
    behind: 0,
    ahead: 0,
    remoteMessage: null,
    message: "",
    guidance: null,
    canAutoUpdate: mode === "git",
  };

  if (mode === "git" && root) {
    return checkUpdateViaGit(root, branch, base);
  }

  // Docker / 未知：通过 GitHub API 对比构建时注入的提交与远端最新提交
  const repoUrl = configuredRepoUrl;
  if (!repoUrl) {
    return {
      ...base,
      message: mode === "docker" ? "容器部署，请配置仓库地址后检查更新。" : "无法确定部署方式，请配置仓库地址后重试。",
      guidance: mode === "docker" ? DOCKER_GUIDANCE : null,
    };
  }

  const local = currentVersion();
  base.currentCommit = local;
  try {
    const remote = await fetchRemoteCommit(repoUrl, branch, token);
    if (!remote) {
      return { ...base, message: "无法解析仓库地址，请检查配置。", guidance: mode === "docker" ? DOCKER_GUIDANCE : null };
    }
    base.remoteCommit = remote.sha;
    base.remoteCommitDate = remote.date;
    base.remoteMessage = remote.message;
    if (local && local.length >= 7) {
      const shortLocal = local.slice(0, 7);
      base.available = remote.sha.slice(0, 7) !== shortLocal;
      base.message = base.available
        ? `发现新版本（远端 ${remote.sha.slice(0, 8)}）`
        : "已是最新版本";
    } else {
      base.available = true;
      base.message = `远端最新提交 ${remote.sha.slice(0, 8)}（本地无版本标识，建议更新）`;
    }
    base.ok = true;
    base.guidance = mode === "docker" ? DOCKER_GUIDANCE : null;
    return base;
  } catch (err) {
    return {
      ...base,
      message: `查询远端失败：${(err as Error).message}`,
      guidance: mode === "docker" ? DOCKER_GUIDANCE : null,
    };
  }
}

/** git 部署的检查逻辑：git fetch + 对比本地 HEAD 与远端。 */
async function checkUpdateViaGit(root: string, branch: string, base: UpdateInfo): Promise<UpdateInfo> {
  const inGit = await run("git rev-parse --is-inside-work-tree", root, 10000);
  if (!inGit.ok || inGit.stdout !== "true") {
    return { ...base, message: "当前目录不是 Git 工作区，无法检查更新。" };
  }

  const remoteUrlRes = await run("git config --get remote.origin.url", root, 10000);
  const repoUrl = remoteUrlRes.ok ? remoteUrlRes.stdout : base.repoUrl;

  const currentRes = await run("git rev-parse HEAD", root, 10000);
  const currentCommit = currentRes.ok ? currentRes.stdout : null;
  const currentDateRes = await run("git show -s --format=%cI HEAD", root, 10000);
  const currentCommitDate = currentDateRes.ok ? currentDateRes.stdout : null;

  const fetchRes = await run(`git fetch --prune origin ${branch}`, root, 60000);
  if (!fetchRes.ok) {
    return {
      ...base,
      repoUrl,
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
    ...base,
    available: behind > 0,
    ok: true,
    repoUrl,
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
  mode: DeployMode;
  steps: UpdateStep[];
  message: string;
  previousCommit: string | null;
  newCommit: string | null;
  restartRequired: boolean;
  /** 无法自动更新时给用户的操作指引。 */
  guidance: string | null;
}

/** 执行一键更新。仅 git 部署可在进程内完成；Docker 部署返回宿主机操作指引。 */
export async function applyUpdate(): Promise<UpdateResult> {
  const mode = detectDeployMode();
  if (mode === "docker" || mode === "unknown") {
    return {
      ok: false,
      mode,
      steps: [],
      message:
        mode === "docker"
          ? "Docker 部署无法在容器内自动更新，请按下方指引在宿主机执行。"
          : "未识别到 Git 仓库，无法自动更新。",
      previousCommit: currentVersion(),
      newCommit: null,
      restartRequired: false,
      guidance: mode === "docker" ? DOCKER_GUIDANCE : null,
    };
  }

  const root = repoRoot();
  const steps: UpdateStep[] = [];
  if (!root) {
    return { ok: false, mode, steps, message: "未找到 Git 仓库，无法自动更新。", previousCommit: null, newCommit: null, restartRequired: false, guidance: null };
  }

  const settings = settingsService.get() as any;
  const branch = settings.updateBranch || "main";

  const previousRes = await run("git rev-parse HEAD", root, 10000);
  const previousCommit = previousRes.ok ? previousRes.stdout : null;

  const statusRes = await run("git status --porcelain", root, 10000);
  const dirty = statusRes.ok && statusRes.stdout.length > 0;
  if (dirty) {
    steps.push({ name: "检查工作区", ok: false, output: "工作区存在未提交改动，已中止更新，避免覆盖你的修改。请先提交或备份后再试。" });
    return { ok: false, mode, steps, message: "工作区不干净，已中止更新。", previousCommit, newCommit: previousCommit, restartRequired: false, guidance: null };
  }
  steps.push({ name: "检查工作区", ok: true, output: "工作区干净" });

  const pullRes = await run(`git pull --ff-only origin ${branch}`, root, 120000);
  steps.push({ name: "拉取代码", ok: pullRes.ok, output: pullRes.stdout + (pullRes.stderr ? `\n${pullRes.stderr}` : "") });
  if (!pullRes.ok) {
    return { ok: false, mode, steps, message: `拉取代码失败：${pullRes.stderr || pullRes.stdout}`, previousCommit, newCommit: previousCommit, restartRequired: false, guidance: null };
  }

  const installRes = await run("pnpm install --frozen-lockfile || pnpm install", root, 300000);
  steps.push({ name: "安装依赖", ok: installRes.ok, output: installRes.stdout + (installRes.stderr ? `\n${installRes.stderr}` : "") });
  if (!installRes.ok) {
    return { ok: false, mode, steps, message: "依赖安装失败，代码已更新但需手动处理。", previousCommit, newCommit: previousCommit, restartRequired: true, guidance: null };
  }

  const buildRes = await run("pnpm build", root, 300000);
  steps.push({ name: "构建", ok: buildRes.ok, output: buildRes.stdout + (buildRes.stderr ? `\n${buildRes.stderr}` : "") });
  if (!buildRes.ok) {
    return { ok: false, mode, steps, message: "构建失败，代码已更新但需手动处理。", previousCommit, newCommit: previousCommit, restartRequired: true, guidance: null };
  }

  const newRes = await run("git rev-parse HEAD", root, 10000);
  const newCommit = newRes.ok ? newRes.stdout : previousCommit;
  const changed = previousCommit !== newCommit;
  logger.info({ previousCommit, newCommit, changed }, "self update applied");
  return {
    ok: true,
    mode,
    steps,
    message: changed ? "更新完成，请重启服务以生效。" : "已是最新版本，依赖与构建已刷新。",
    previousCommit,
    newCommit,
    restartRequired: true,
    guidance: null,
  };
}

export function updateRepoRoot(): string {
  return resolve(repoRoot() ?? process.cwd());
}
