import { describe, it, expect } from "vitest";
import { defaultExecuteCommand, MAX_COMMAND_TIMEOUT_MS } from "./server.js";

describe("defaultExecuteCommand", () => {
  it("MAX_COMMAND_TIMEOUT_MS is at least 20 minutes so the auto-merge quality gate is not killed mid-run", () => {
    // Structural guarantee: the gate's YAML configures timeout_ms: 1_200_000 (20m).
    // If this cap is lower, the gate times out on every run and the merge workflow
    // is structurally unwinnable regardless of agent remediation.
    expect(MAX_COMMAND_TIMEOUT_MS).toBeGreaterThanOrEqual(1_200_000);
  });

  it("returns ok:true for a fast-succeeding command", async () => {
    const result = await defaultExecuteCommand(
      { command: "echo hello" },
      process.cwd(),
    );

    expect(result.ok).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.timed_out).toBe(false);
    expect(result.stdout.trim()).toBe("hello");
  });

  it("returns ok:false and timed_out:false for a command that exits non-zero", async () => {
    const result = await defaultExecuteCommand(
      { command: "exit 2" },
      process.cwd(),
    );

    expect(result.ok).toBe(false);
    expect(result.timed_out).toBe(false);
  });

  it("does not clamp a timeout within the allowed range", async () => {
    // Passing an explicit timeout well within the max should be honoured — the
    // command will finish long before it, so this is a smoke-test of the pass-through.
    const result = await defaultExecuteCommand(
      { command: "echo ok", timeoutMs: 1_200_000 },
      process.cwd(),
    );

    expect(result.ok).toBe(true);
  });
});
