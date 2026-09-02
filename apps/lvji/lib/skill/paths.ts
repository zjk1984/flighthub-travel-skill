import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Repo root that hosts SKILL.md, references/, and scripts/ */
export function skillRepoRoot(): string {
  const candidates = [
    process.env.SKILL_REPO_ROOT,
    path.resolve(moduleDir, "../../../.."), // apps/lvji/lib/skill → repo root
    "/app", // Docker runner layout
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "../.."),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "SKILL.md")) && existsSync(path.join(dir, "scripts", "flyai-dedup.js"))) {
      return dir;
    }
  }
  return path.resolve(moduleDir, "../../../..");
}

export function skillPaths() {
  const root = skillRepoRoot();
  return {
    root,
    skillMd: path.join(root, "SKILL.md"),
    referencesDir: path.join(root, "references"),
    dedupScript: path.join(root, "scripts", "flyai-dedup.js"),
    adaptiveSearchScript: path.join(root, "scripts", "flyai-adaptive-search.sh"),
  };
}
