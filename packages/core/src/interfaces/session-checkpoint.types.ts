import type { HarnessSessionRef } from "./agent-await.types.js";
import type { HarnessId } from "./harness.types.js";
import { isHarnessId } from "./harness.types.js";

export const SESSION_CHECKPOINT_PHASES = ["intent", "result"] as const;
export type SessionCheckpointPhase = (typeof SESSION_CHECKPOINT_PHASES)[number];

/**
 * A single durable snapshot of an agent session's position within a step turn.
 * Emitted by the harness `SessionCheckpointWriter` after each message/tool call
 * and persisted into `step_session_checkpoint`. Transport-agnostic: the same
 * marker shape is written via a file sidecar (transport A) or streamed over
 * telemetry (transport B).
 */
export interface SessionCheckpointMarker {
  engine: HarnessId;
  /** Engine-agnostic resume reference; null until the engine emits a session id. */
  sessionRef?: HarnessSessionRef | null;
  /** PI: latest session-tree node to branch from on resume. */
  resumeNodeId?: string | null;
  phase: SessionCheckpointPhase;
  /** Monotonic per (run, step); ties an `intent` to its later `result`. */
  callSeq: number;
  /** Tool in flight for intent/result phases. */
  toolName?: string | null;
  /** sha256(run:step:callSeq:tool:args) — server-side replay de-dupe. */
  idempotencyKey?: string | null;
}

export function isSessionCheckpointMarker(
  value: unknown,
): value is SessionCheckpointMarker {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["engine"] === "string" &&
    isHarnessId(v["engine"]) &&
    SESSION_CHECKPOINT_PHASES.includes(v["phase"] as SessionCheckpointPhase) &&
    typeof v["callSeq"] === "number"
  );
}
