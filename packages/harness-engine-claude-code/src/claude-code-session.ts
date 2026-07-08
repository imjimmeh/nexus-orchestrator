import type { HarnessSession, V3SessionWriter } from "@nexus/harness-runtime";
import type { CanonicalSessionEvent } from "@nexus/core";
import type { ClaudeEventMapper } from "./map-claude-event.js";
import type { ClaudeV3Mapper } from "./map-claude-message-to-v3.js";
import type { ClaudeCodeSessionOptions } from "./claude-code-session.types.js";

/**
 * A Claude Code SDK message may carry the session UUID under `session_id`
 * (present on `system`/`init` and every `result` message). We read it
 * defensively so the produced id can be surfaced for later resume.
 */
interface SessionIdCarrier {
  session_id?: unknown;
}

export class ClaudeCodeSession implements HarnessSession {
  private readonly handlers = new Set<(e: CanonicalSessionEvent) => void>();
  private aborted = false;
  private suspended = false;
  private readonly resumable: boolean;
  private readonly v3Sink?: Pick<V3SessionWriter, "appendNode">;
  private readonly v3Mapper?: ClaudeV3Mapper;
  private readonly onDispose?: () => Promise<void>;
  private producedSessionId: string | undefined;

  constructor(
    private readonly queryGenerator: AsyncIterable<unknown>,
    private readonly mapper: ClaudeEventMapper,
    private readonly stepId: string,
    options: ClaudeCodeSessionOptions = {},
  ) {
    this.resumable = options.resumable ?? false;
    this.v3Sink = options.v3Sink;
    this.v3Mapper = options.v3Mapper;
    this.onDispose = options.onDispose;
    void this.consume();
  }

  private async consume(): Promise<void> {
    try {
      for await (const msg of this.queryGenerator) {
        if (this.aborted) break;
        this.captureSessionId(msg);
        this.persistV3(msg);
        for (const e of this.mapper.map(msg)) {
          for (const h of this.handlers) h(e);
        }
      }
      if (this.suspended) {
        this.emitSuspendedEnd();
      }
    } catch (err) {
      if (this.suspended) {
        // Deliberate durable-await suspend: the query was aborted on purpose
        // after a tool returned executionStatus:suspended. Report a clean
        // suspended end so the server parks the run instead of failing it.
        this.emitSuspendedEnd();
        return;
      }
      const errorEvent = {
        type: "agent_end" as const,
        stepId: this.stepId,
        output: {
          ok: false,
          response: err instanceof Error ? err.message : "Session error",
          stopReason: "error" as const,
        },
      };
      for (const h of this.handlers) h(errorEvent);
    }
  }

  private emitSuspendedEnd(): void {
    const event = {
      type: "agent_end" as const,
      stepId: this.stepId,
      output: {
        ok: true,
        response: "Turn suspended pending awaited workflow completion.",
        stopReason: "suspended" as const,
        suspended: true,
      },
    };
    for (const h of this.handlers) h(event);
  }

  /** Best-effort: persist the SDK message as v3 node(s). Never throws. */
  private persistV3(msg: unknown): void {
    if (!this.v3Sink || !this.v3Mapper) return;
    try {
      for (const node of this.v3Mapper.map(msg)) {
        this.v3Sink.appendNode(node);
      }
    } catch {
      // Persistence is best-effort; a write failure must not abort the turn.
    }
  }

  /** Records the SDK-assigned session UUID so it can be persisted for resume. */
  private captureSessionId(msg: unknown): void {
    if (typeof msg !== "object" || msg === null) return;
    const id = (msg as SessionIdCarrier).session_id;
    if (typeof id === "string" && id.length > 0) {
      this.producedSessionId = id;
    }
  }

  /**
   * The session UUID assigned by the Claude Code SDK, once observed on the
   * stream. Persist this as a `{ kind: 'claude_code', sessionId }` reference to
   * resume the session on a later turn. Returns undefined until the first
   * `system`/`init` or `result` message has been processed.
   */
  getProducedSessionId(): string | undefined {
    return this.producedSessionId;
  }

  subscribe(onEvent: (e: CanonicalSessionEvent) => void): () => void {
    this.handlers.add(onEvent);
    return () => this.handlers.delete(onEvent);
  }

  /**
   * No-op: the turn is already being driven by the SDK `query()` started in the
   * engine's `createSession` (the full prompt is delivered there, and `consume()`
   * streams the result). The runtime server calls `prompt(kickoffPrompt)` once
   * per step for every engine — for claude-code that kickoff prompt is the same
   * one already given at session start, so re-issuing it would be redundant.
   * Rejecting here (as an earlier design did) aborts the in-flight turn via the
   * server's catch→dispose path before any event is forwarded. Resolving lets
   * the server proceed to await session completion. See kanban-miiu.
   */
  prompt(_message: string): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Marks this turn as deliberately suspended (durable agent-await). The engine
   * calls this from the SDK tool handler's `onTerminate`, then aborts the
   * in-flight query; `consume()` then emits a clean suspended `agent_end`
   * instead of an error end. See kanban-atuq.
   */
  suspend(): void {
    this.suspended = true;
  }

  abort(): Promise<void> {
    this.aborted = true;
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    this.aborted = true;
    this.handlers.clear();
    if (this.onDispose) {
      try {
        await this.onDispose();
      } catch {
        // Best-effort: dispose failures must never propagate to the caller.
      }
    }
  }
}
