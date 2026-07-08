import type { V3SessionWriter } from "@nexus/harness-runtime";
import type { ClaudeV3Mapper } from "./map-claude-message-to-v3.js";

export interface ClaudeCodeSessionOptions {
  /**
   * When true, the session was created as a resume and `prompt()` is permitted
   * for follow-up turns. The SDK streaming-input contract is satisfied by the
   * follow-up sink supplied at construction. When false (a fresh, single-prompt
   * session), `prompt()` rejects.
   */
  resumable?: boolean;
  /** Optional v3 JSONL sink; when present, each SDK message is persisted. */
  v3Sink?: Pick<V3SessionWriter, "appendNode">;
  v3Mapper?: ClaudeV3Mapper;
  /**
   * Called during `dispose()` (best-effort, never throws). Used by the engine
   * to remove session-scoped staged directories (e.g. the plugin staging dir
   * that may contain secret-bearing `.mcp.json` files).
   */
  onDispose?: () => Promise<void>;
}
