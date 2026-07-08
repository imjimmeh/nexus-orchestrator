import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "apps/api/src";
const excludes = ["__tests__", "test", ".spec.ts", ".test.ts", ".e2e-spec.ts"];
const matches = [];

function isExcluded(path) {
  return excludes.some((e) => path.includes(e));
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!excludes.includes(entry)) walk(path);
      continue;
    }
    if (!path.endsWith(".module.ts")) continue;
    if (isExcluded(path)) continue;
    const content = readFileSync(path, "utf8");
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    if (stripped.includes("@Global()")) matches.push(path);
  }
}

walk(root);

if (matches.length > 0) {
  console.error(
    `@Global() decorator found in ${matches.length} production module(s):\n${matches.join("\n")}`,
  );
  process.exit(1);
}

console.log("OK: No production modules use @Global().");
