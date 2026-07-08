/**
 * Scripted fake for the @earendil-works/pi-coding-agent AgentSession.
 *
 * The PiHarnessSession calls `agentSession.subscribe(handler)` and then
 * forwards raw events through `mapPiEventToCanonical`.  This fake stores the
 * registered handler and, when `emitScriptedEvents` is called, synchronously
 * feeds it the raw PI-shaped events that correspond to the desired conformance
 * scenario.
 */

import type { RawPiEvent } from "./pi.types.js";

export type {
  RawPiTurnStart,
  RawPiToolExecutionStart,
  RawPiToolExecutionEnd,
  RawPiAgentEnd,
  RawPiEvent,
} from "./pi.types.js";

type SubscribeHandler = (event: unknown) => void;

/**
 * A scripted AgentSession fake.  The PI engine creates this via
 * `createAgentSession(…).session`.  After construction the test calls
 * `emitScriptedEvents()` to push raw events through the registered handler.
 */
export class FakePiAgentSession {
  private handler: SubscribeHandler | null = null;
  private readonly events: RawPiEvent[];

  constructor(events: RawPiEvent[]) {
    this.events = events;
  }

  subscribe(handler: SubscribeHandler): () => void {
    this.handler = handler;
    // Emit events asynchronously so that the PiHarnessSession constructor can
    // finish returning before events start arriving — mirrors real behaviour.
    setTimeout(() => {
      this.emitScriptedEvents();
    }, 0);
    return () => {
      this.handler = null;
    };
  }

  async prompt(_message: string): Promise<void> {
    /* no-op for fake */
  }

  dispose(): Promise<void> {
    this.handler = null;
    return Promise.resolve();
  }

  private emitScriptedEvents(): void {
    if (!this.handler) return;
    for (const event of this.events) {
      this.handler(event);
    }
  }
}

// ---------------------------------------------------------------------------
// Default scripted event sequences for reuse across conformance test cases
// ---------------------------------------------------------------------------

export const SCRIPTED_TOOL_CALL_ID = "pi-tool-call-1";
export const SCRIPTED_TOOL_NAME = "read_file";

/**
 * Produces the minimal event sequence to satisfy C3–C6:
 *  turn_start → tool_execution_start → tool_execution_end → agent_end
 */
export function makeScriptedPiEvents(): RawPiEvent[] {
  return [
    { type: "turn_start" },
    {
      type: "tool_execution_start",
      toolCallId: SCRIPTED_TOOL_CALL_ID,
      toolName: SCRIPTED_TOOL_NAME,
      args: { path: "/README.md" },
    },
    {
      type: "tool_execution_end",
      toolCallId: SCRIPTED_TOOL_CALL_ID,
      toolName: SCRIPTED_TOOL_NAME,
      result: "file content",
      isError: false,
    },
    {
      type: "agent_end",
      messages: [
        { content: [{ type: "text", text: "Task completed successfully." }] },
      ],
    },
  ];
}

/**
 * Produces a minimal sequence without tool calls — used for C7 (deny scenario).
 * Since the PI engine governance is applied at the `CanonicalToolDefinition`
 * level before the session sees it, a deny scenario at the PI layer means the
 * tool is never invoked.  The session still emits agent_end.
 */
export function makeScriptedPiEventsNoDeny(): RawPiEvent[] {
  return [
    { type: "turn_start" },
    {
      type: "agent_end",
      messages: [{ content: [{ type: "text", text: "No tools used." }] }],
    },
  ];
}
