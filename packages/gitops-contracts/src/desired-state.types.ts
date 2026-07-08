// packages/gitops-contracts/src/desired-state.types.ts

import type { DesiredState } from "./desired-state.schema";

/** An in-memory file: `content` is a JSON-compatible object (YAML (de)ser is the API layer's job). */
export interface DesiredStateFile {
  path: string;
  content: Record<string, unknown>;
}

export type ParseResult =
  | { ok: true; state: DesiredState }
  | { ok: false; errors: Array<{ path: string; message: string }> };
