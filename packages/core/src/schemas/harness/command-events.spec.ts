import { describe, expect, it } from "vitest";
import {
  COMMAND_STARTED_EVENT,
  COMMAND_OUTPUT_EVENT,
  COMMAND_FINISHED_EVENT,
  type CommandOutputPayload,
} from "./command-events";

describe("command events contract", () => {
  it("exposes stable event-type string constants", () => {
    expect(COMMAND_STARTED_EVENT).toBe("command_started");
    expect(COMMAND_OUTPUT_EVENT).toBe("command_output");
    expect(COMMAND_FINISHED_EVENT).toBe("command_finished");
  });

  it("types a command_output payload with an ordering seq", () => {
    const payload: CommandOutputPayload = {
      stepId: "run_gate",
      stream: "stdout",
      chunk: "PASS\n",
      seq: 3,
    };
    expect(payload.seq).toBe(3);
  });
});
