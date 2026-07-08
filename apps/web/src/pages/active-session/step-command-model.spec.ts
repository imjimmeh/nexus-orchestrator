import { describe, expect, it } from "vitest";
import { buildStepCommandModels } from "./step-command-model";

const ev = (event_type: string, payload: Record<string, unknown>) => ({
  event_type,
  payload,
  timestamp: "2026-06-23T00:00:00.000Z",
});

describe("buildStepCommandModels", () => {
  it("assembles a running command from started + ordered output chunks", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "run_gate", command: "npm test" }),
      ev("command_output", {
        stepId: "run_gate",
        stream: "stdout",
        chunk: "B",
        seq: 1,
      }),
      ev("command_output", {
        stepId: "run_gate",
        stream: "stdout",
        chunk: "A",
        seq: 0,
      }),
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      stepId: "run_gate",
      command: "npm test",
      output: "AB",
      status: "running",
      exitCode: null,
    });
  });

  it("finalizes status and exit code from command_finished", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_output", {
        stepId: "s",
        stream: "stdout",
        chunk: "hi",
        seq: 0,
      }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 2,
        timedOut: false,
        ok: false,
        outputTail: "hi",
      }),
    ]);
    expect(models[0]).toMatchObject({
      status: "exited",
      exitCode: 2,
      output: "hi",
    });
  });

  it("falls back to outputTail when no live chunks were received (replay)", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 0,
        timedOut: false,
        ok: true,
        outputTail: "TAIL",
      }),
    ]);
    expect(models[0]).toMatchObject({
      output: "TAIL",
      status: "exited",
      exitCode: 0,
    });
  });

  it("marks a timed-out command", () => {
    const models = buildStepCommandModels([
      ev("command_started", { stepId: "s", command: "x" }),
      ev("command_finished", {
        stepId: "s",
        exitCode: 1,
        timedOut: true,
        ok: false,
        outputTail: "",
      }),
    ]);
    expect(models[0].status).toBe("timed_out");
  });
});
