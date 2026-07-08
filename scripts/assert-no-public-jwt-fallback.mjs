import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["apps/api/src", "apps/kanban/src", "packages/e2e-tests/src"];
const forbidden = "nexus-secret-key";
const matches = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(ts|js|mjs|cjs)$/.test(path)) continue;
    const content = readFileSync(path, "utf8");
    if (content.includes(forbidden)) matches.push(path);
  }
}

for (const root of roots) walk(root);
if (matches.length > 0) {
  console.error(
    `Forbidden public JWT secret fallback found:\n${matches.join("\n")}`,
  );
  process.exit(1);
}
