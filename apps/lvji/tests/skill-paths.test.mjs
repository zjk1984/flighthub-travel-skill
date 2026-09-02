import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { skillPaths, skillRepoRoot } from "../lib/skill/paths.ts";

test("skill paths resolve to repo-root FlyAI assets", () => {
  const root = skillRepoRoot();
  const paths = skillPaths();
  assert.equal(paths.root, root);
  assert.ok(existsSync(paths.skillMd), `missing ${paths.skillMd}`);
  assert.ok(existsSync(paths.dedupScript), `missing ${paths.dedupScript}`);
  assert.ok(existsSync(paths.adaptiveSearchScript), `missing ${paths.adaptiveSearchScript}`);
  assert.ok(existsSync(paths.referencesDir), `missing ${paths.referencesDir}`);
});
