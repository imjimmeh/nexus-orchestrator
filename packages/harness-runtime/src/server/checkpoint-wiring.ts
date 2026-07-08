import type { HarnessSession } from "../engine/harness-engine.types.js";
import { FileSidecarSink } from "../checkpoint/file-sidecar-sink.js";
import { SessionCheckpointWriter } from "../checkpoint/session-checkpoint-writer.js";
import type { CheckpointWiringOptions } from "./checkpoint-wiring.types.js";

export type { CheckpointWiringOptions } from "./checkpoint-wiring.types.js";

/**
 * Constructs a SessionCheckpointWriter wired to a FileSidecarSink when
 * SESSION_CHECKPOINT_PATH is set, and starts it. Returns undefined when the
 * feature is disabled or the engine is not a built-in checkpoint-aware engine.
 *
 * The returned writer must be stopped in the cleanup region (next to unsubscribe).
 *
 * Note (PI concern): getSessionRef returns null for the "pi" engine because no
 * treeId is available at this layer — the sessionPath is a file path, not a PI
 * session-tree id. Downstream persistence (Task 7) can hydrate the treeId from
 * the PI session file when replaying the sidecar. For claude-code, the sessionId
 * is read lazily via session.getProducedSessionId?.() so it is populated as soon
 * as the engine emits it.
 */
export function maybeCreateCheckpointWriter(
  session: Pick<HarnessSession, "subscribe" | "getProducedSessionId">,
  opts: CheckpointWiringOptions,
): SessionCheckpointWriter | undefined {
  if (!opts.checkpointPath) return undefined;

  if (opts.harnessId !== "pi" && opts.harnessId !== "claude-code")
    return undefined;

  const sink = new FileSidecarSink(opts.checkpointPath);

  const writer = new SessionCheckpointWriter(session, sink, {
    engine: opts.harnessId,
    getSessionRef: () => {
      if (opts.harnessId === "claude-code") {
        const sessionId = session.getProducedSessionId?.();
        if (sessionId) return { kind: "claude_code", sessionId };
        return null; // not yet emitted — writer will retry lazily on each event
      }
      // PI: treeId is not available at this layer; caller (Task 7) hydrates from sidecar
      return null;
    },
  });

  writer.start();
  return writer;
}
