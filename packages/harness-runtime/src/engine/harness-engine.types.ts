// packages/harness-runtime/src/engine/harness-engine.types.ts

import type {
  HarnessId,
  HarnessCapabilities,
  HarnessRuntimeConfig,
  CanonicalSessionEvent,
} from "@nexus/core";
import type {
  HarnessSessionContext,
  CommandExecRequest,
  CommandExecResult,
} from "./session-context.types.js";

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

export interface HarnessSession {
  prompt(message: string): Promise<void>;
  abort(): Promise<void>;
  subscribe(onEvent: (event: CanonicalSessionEvent) => void): () => void;
  dispose(): Promise<void>;
  /**
   * Returns the engine-assigned session identifier produced during this turn,
   * if the engine supports session resume and one was emitted. Engines that do
   * not support resume may omit this method. The caller persists the value as a
   * `HarnessSessionRef` on the await record so the session can be re-entered.
   */
  getProducedSessionId?(): string | undefined;
}

export interface HarnessEngine {
  readonly id: HarnessId;
  readonly capabilities: HarnessCapabilities;
  validate(config: HarnessRuntimeConfig): ValidationResult;
  createSession(
    config: HarnessRuntimeConfig,
    ctx: HarnessSessionContext,
  ): Promise<HarnessSession>;
  executeCommand?(req: CommandExecRequest): Promise<CommandExecResult>;
}
