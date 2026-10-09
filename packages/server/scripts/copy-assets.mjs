import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const builtinSkills = resolve(root, "src", "skills", "builtin");
const outDir = resolve(root, "dist", "skills", "builtin");
if (existsSync(builtinSkills)) {
  mkdirSync(dirname(outDir), { recursive: true });
  cpSync(builtinSkills, outDir, { recursive: true });
  console.log("[build] copied builtin skills ->", outDir);
}
