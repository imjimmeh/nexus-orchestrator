import { describe, expect, it } from "vitest";
import { defaultExecuteCommand } from "./server";

interface Emitted {
  event: string;
  data: Record<string, unknown>;
}

function collect(): {
  emit: (e: string, d: unknown) => void;
  events: Emitted[];
} {
  const events: Emitted[] = [];
  return {
    emit: (event, data) =>
      events.push({ event, data: data as Record<string, unknown> }),
    events,
  };
}

describe("defaultExecuteCommand streaming", () => {
  it("emits started, output, and finished events for a successful command", async () => {
    const { emit, events } = collect();
    const result = await defaultExecuteCommand(
      { command: 'printf "hello\\n"', stepId: "run_gate" },
      process.cwd(),
      emit,
    );

    expect(result.ok).toBe(true);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("hello");

    const types = events.map((e) => e.event);
    expect(types[0]).toBe("command_started");
    expect(types).toContain("command_output");
    expect(types[types.length - 1]).toBe("command_finished");

    const started = events.find((e) => e.event === "command_started");
    expect(started?.data).toMatchObject({
      stepId: "run_gate",
      command: 'printf "hello\\n"',
    });

    const finished = events.find((e) => e.event === "command_finished");
    expect(finished?.data).toMatchObject({
      stepId: "run_gate",
      exitCode: 0,
      timedOut: false,
      ok: true,
    });
    expect(String(finished?.data.outputTail)).toContain("hello");

    const outputs = events.filter((e) => e.event === "command_output");
    const seqs = outputs.map((e) => e.data.seq as number);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(outputs.map((e) => e.data.chunk).join("")).toContain("hello");
  });

  it("reports a non-zero exit code and still returns buffered output", async () => {
    const { emit, events } = collect();
    const result = await defaultExecuteCommand(
      { command: 'printf "boom\\n" 1>&2; exit 3', stepId: "run_gate" },
      process.cwd(),
      emit,
    );

    expect(result.ok).toBe(false);
    expect(result.exit_code).toBe(3);
    expect(result.stderr).toContain("boom");
    const finished = events.find((e) => e.event === "command_finished");
    expect(finished?.data).toMatchObject({ exitCode: 3, ok: false });
  });

  it("emits nothing when no emit callback is provided (back-compat)", async () => {
    const result = await defaultExecuteCommand(
      { command: 'printf "hi"' },
      process.cwd(),
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("hi");
  });

  it("emits exactly one command_finished event when the spawn itself fails (e.g. bad working directory)", async () => {
    const { emit, events } = collect();

    // Passing a nonexistent workingDir causes spawn("sh", ...) to emit both
    // "error" and "close" events in sequence. Without idempotency, finish()
    // runs twice: the Promise resolves on the first call (error), then "close"
    // fires asynchronously and emits a second command_finished event.
    // Wait one extra tick after resolution to capture any late-fired events.
    await defaultExecuteCommand(
      {
        command: "echo hello",
        workingDir: "/nonexistent/dir-xyz-abc",
        stepId: "spawn_fail_step",
      },
      process.cwd(),
      emit,
    );
    await new Promise<void>((r) => setTimeout(r, 50));

    const finishedEvents = events.filter((e) => e.event === "command_finished");
    expect(finishedEvents).toHaveLength(1);
    expect(finishedEvents[0].data).toMatchObject({
      stepId: "spawn_fail_step",
      ok: false,
    });
  });

  it(
    "returns timed_out:true and emits command_finished with timedOut:true when command exceeds timeoutMs",
    { timeout: 10_000 },
    async () => {
      const { emit, events } = collect();

      // Use a busy loop rather than sleep — on Windows, sleep ignores SIGKILL and
      // takes the full sleep duration before the process exits, which would blow
      // through the test timeout. A CPU-spin loop is killed immediately.
      const result = await defaultExecuteCommand(
        {
          command: "while true; do :; done",
          timeoutMs: 100,
          stepId: "timeout_step",
        },
        process.cwd(),
        emit,
      );

      expect(result.timed_out).toBe(true);
      expect(result.ok).toBe(false);

      const finishedEvents = events.filter(
        (e) => e.event === "command_finished",
      );
      expect(finishedEvents).toHaveLength(1);
      expect(finishedEvents[0].data).toMatchObject({
        stepId: "timeout_step",
        timedOut: true,
        ok: false,
      });
    },
  );

  it("trims trailing whitespace from outputTail in command_finished event", async () => {
    const { emit, events } = collect();

    await defaultExecuteCommand(
      { command: 'printf "hello\\n\\n"', stepId: "trim_step" },
      process.cwd(),
      emit,
    );

    const finished = events.find((e) => e.event === "command_finished");
    const outputTail = finished?.data.outputTail as string;
    expect(outputTail).toBeDefined();
    expect(outputTail).not.toMatch(/\s+$/);
  });
});
