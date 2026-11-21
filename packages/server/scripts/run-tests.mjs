// 跨平台测试入口：Windows 的 cmd 不展开 glob，因此在这里用 fs 列出测试文件
// 再传给 tsx --test，避免 package.json 里写 shell 相关的通配符。
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const testDir = join(here, "..", "test");

const files = readdirSync(testDir)
  .filter((f) => f.endsWith(".test.ts"))
  .sort()
  .map((f) => join(testDir, f));

if (files.length === 0) {
  console.error("no test files found in", testDir);
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["tsx", "--test", ...files],
  { stdio: "inherit", shell: process.platform === "win32" },
);

process.exit(result.status ?? 1);
