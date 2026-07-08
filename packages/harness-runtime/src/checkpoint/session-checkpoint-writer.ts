import { createHash } from "node:crypto";
import type { CanonicalSessionEvent } from "@nexus/core";
import type { HarnessSession } from "../engine/harness-engine.types.js";
import type {
  CheckpointSink,
  SessionCheckpointWriterOptions,
} from "./session-checkpoint-writer.types.js";

/**
 * Subscribes to a HarnessSession and emits two-phase SessionCheckpointMarkers:
 * - `intent` before a tool executes (tool_execution_start)
 * - `result` after a tool completes (tool_execution_end)
 *
 * The `callSeq` monotonically increments per tool call and is shared between
 * the intent and result phases via `toolCallId` mapping.
 */
export class SessionCheckpointWriter {
  private seq = 0;
  private readonly seqByCall = new Map<string, number>();
  private unsubscribe?: () => void;

  constructor(
    private readonly session: Pick<HarnessSession, "subscribe">,
    private readonly sink: CheckpointSink,
    private readonly opts: SessionCheckpointWriterOptions,
  ) {}

  start(): void {
    this.unsubscribe = this.session.subscribe(
      (e) =>
        void this.onEvent(e).catch((err: unknown) => {
          console.warn("[checkpoint] sink write failed:", err);
        }),
    );
  }

  stop(): void {
    this.unsubscribe?.();
  }

  private async onEvent(event: CanonicalSessionEvent): Promise<void> {
    if (event.type === "tool_execution_start") {
      const callSeq = ++this.seq;
      this.seqByCall.set(event.toolCallId, callSeq);
      await this.sink.write({
        engine: this.opts.engine,
        sessionRef: this.opts.getSessionRef(),
        resumeNodeId: this.resolveNodeId(),
        phase: "intent",
        callSeq,
        toolName: event.toolName,
        idempotencyKey: this.idempotencyKey(
          callSeq,
          event.toolName,
          event.args,
        ),
      });
      return;
    }
    if (event.type === "tool_execution_end") {
      const callSeq = this.seqByCall.get(event.toolCallId);
      if (callSeq === undefined) return; // orphan end: no intent recorded — skip
      this.seqByCall.delete(event.toolCallId);
      await this.sink.write({
        engine: this.opts.engine,
        sessionRef: this.opts.getSessionRef(),
        resumeNodeId: this.resolveNodeId(),
        phase: "result",
        callSeq,
        toolName: event.toolName,
      });
    }
  }

  private resolveNodeId(): string | null {
    const ref = this.opts.getSessionRef();
    return ref?.kind === "pi" ? (ref.resumeNodeId ?? null) : null;
  }

  private idempotencyKey(
    seq: number,
    tool: string,
    args: Record<string, unknown>,
  ): string {
    return createHash("sha256")
      .update(`${seq}:${tool}:${JSON.stringify(args)}`)
      .digest("hex");
  }
}
