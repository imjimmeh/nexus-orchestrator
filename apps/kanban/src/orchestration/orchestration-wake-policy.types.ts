import type { TerminalWorkItemRunKind } from "../core/core-lifecycle-stream.types";

export type WakePolicy = "slot_freed" | "every_terminal";

export type ShouldWakeForTerminalRunResult = {
  wake: boolean;
  suppressReason?: string;
};

export type ShouldWakeForTerminalRunInput = {
  policy: WakePolicy;
  workItemRunKind: TerminalWorkItemRunKind;
  itemStillActive: boolean;
};
