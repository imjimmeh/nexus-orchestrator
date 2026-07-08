/** Telemetry events that stream a run_command step's terminal output live. */
export const COMMAND_STARTED_EVENT = "command_started" as const;
export const COMMAND_OUTPUT_EVENT = "command_output" as const;
export const COMMAND_FINISHED_EVENT = "command_finished" as const;

export interface CommandStartedPayload {
  stepId: string;
  command: string;
}

export interface CommandOutputPayload {
  stepId: string;
  stream: "stdout" | "stderr";
  chunk: string;
  /** Per-step monotonically increasing index for ordering and de-duplication. */
  seq: number;
}

export interface CommandFinishedPayload {
  stepId: string;
  exitCode: number;
  timedOut: boolean;
  ok: boolean;
  /** Last bytes of combined output, persisted so late replay viewers see a tail. */
  outputTail: string;
}
