// packages/e2e-tests/src/scenarios/setup/stack-context-file.ts
export type { SerializedStackContext } from "./stack-context-file.types.js";
import type { SerializedStackContext } from "./stack-context-file.types.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FILE = join(tmpdir(), "nexus-e2e-stack-context.json");

export function writeStackContext(ctx: SerializedStackContext): void {
  writeFileSync(FILE, JSON.stringify(ctx), "utf-8");
}

export function readStackContext(): SerializedStackContext {
  return JSON.parse(readFileSync(FILE, "utf-8")) as SerializedStackContext;
}
