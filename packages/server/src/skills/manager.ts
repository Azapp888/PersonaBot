import { skillRepo } from "../db/repos/skills";
import { logger } from "../logger";
import type { Skill } from "../types";
import { builtinSkills } from "./builtin";
import { settingsService } from "../settings/service";
import { fetchWithTimeout } from "../utils/http";

/**
 * 将内置 Skill 写入数据库（不覆盖用户对 enabled 的修改）。
 */
export async function seedBuiltinSkills(): Promise<void> {
  for (const skill of builtinSkills) {
    const existing = skillRepo.find(skill.id);
    skillRepo.upsert({
      ...skill,
      enabled: existing ? existing.enabled : skill.enabled,
    });
  }
  logger.info({ count: builtinSkills.length }, "builtin skills seeded");
}

export function getSkillContent(ids: string[]): string {
  if (!ids.length) return "";
  const parts: string[] = [];
  for (const id of ids) {
    const skill = skillRepo.find(id);
    if (skill && skill.enabled && skill.content) {
      parts.push(`## Skill: ${skill.name}\n${skill.content}`);
    }
  }
  return parts.join("\n\n");
}

export function listSkills(): Skill[] {
  return skillRepo.list();
}

interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree";
  url: string;
}

function parseRepo(url: string): { owner: string; repo: string; branch: string } | null {
  const match = url
    .replace(/\.git$/, "")
    .match(/github\.com[:/]([^/]+)\/([^/]+)(?:\/tree\/([^/]+))?/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], branch: match[3] || "main" };
}

/**
 * 从 GitHub 仓库同步 Skill。
 * 约定：仓库中每个 *.md 文件即一个 Skill，文件名（去扩展名）作为 Skill 名称。
 */
export async function syncSkillsFromGithub(repoUrl?: string, token?: string): Promise<{ updated: number; errors: string[] }> {
  const settings = settingsService.get();
  const url = repoUrl || settings.skillRepoUrl;
  const errors: string[] = [];
  if (!url) {
    return { updated: 0, errors: ["未配置 Skill 仓库地址"] };
  }
  const parsed = parseRepo(url);
  if (!parsed) {
    return { updated: 0, errors: [`无法解析 GitHub 仓库地址: ${url}`] };
  }
  const headers: Record<string, string> = { "User-Agent": "PersonaBot", Accept: "application/vnd.github+json" };
  const authToken = token || (settings as any).githubToken;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let tree: GithubTreeEntry[] = [];
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${parsed.branch}?recursive=1`,
      { headers, timeoutMs: 20000 },
    );
    if (!res.ok) {
      const text = await res.text();
      return { updated: 0, errors: [`GitHub API 错误: ${res.status} ${text}`] };
    }
    const data: any = await res.json();
    tree = data.tree ?? [];
  } catch (err) {
    return { updated: 0, errors: [`拉取仓库失败: ${(err as Error).message}`] };
  }

  const mdFiles = tree.filter((e) => e.type === "blob" && e.path.toLowerCase().endsWith(".md"));
  let updated = 0;
  for (const file of mdFiles) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${parsed.branch}/${file.path}`;
      const res = await fetchWithTimeout(rawUrl, { headers: { "User-Agent": "PersonaBot" }, timeoutMs: 20000 });
      if (!res.ok) {
        errors.push(`${file.path}: ${res.status}`);
        continue;
      }
      const content = await res.text();
      const name = file.path.split("/").pop()!.replace(/\.md$/i, "");
      const id = `github-${parsed.owner}-${parsed.repo}-${file.path.replace(/[^a-zA-Z0-9]+/g, "-")}`.toLowerCase();
      const existing = skillRepo.find(id);
      skillRepo.upsert({
        id,
        name,
        description: `来自 ${parsed.owner}/${parsed.repo} 的 Skill`,
        type: "github",
        version: String(Date.now()),
        source: url,
        content,
        enabled: existing ? existing.enabled : true,
      });
      updated += 1;
    } catch (err) {
      errors.push(`${file.path}: ${(err as Error).message}`);
    }
  }
  logger.info({ repo: url, updated, errors: errors.length }, "skills synced from github");
  return { updated, errors };
}
