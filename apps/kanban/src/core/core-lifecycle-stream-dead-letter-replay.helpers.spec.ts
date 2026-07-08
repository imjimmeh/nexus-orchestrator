import { describe, expect, it, vi } from "vitest";
import { replayDeadLetters } from "./core-lifecycle-stream-dead-letter-replay.helpers";
import type { DeadLetterReplayDeps } from "./core-lifecycle-stream-dead-letter-replay.types";

interface FakeRow {
  id: string;
  payload: Record<string, unknown> | null;
}

/**
 * Builds a stateful fake of the dead-letter repository backed by an in-memory
 * array so the batch drain loop is exercised faithfully: `deleteDeadLetter`
 * actually removes rows, `listDeadLetters` returns the current oldest
 * `batchSize` rows, and `countRecent` reflects what is left. `xadd`/
 * `deleteDeadLetter` can be overridden to inject failures.
 */
function makeStatefulDeps(
  initialRows: FakeRow[],
  overrides: {
    xadd?: ReturnType<typeof vi.fn>;
    deleteDeadLetter?: ReturnType<typeof vi.fn>;
    batchSize?: number;
  } = {},
): {
  deps: DeadLetterReplayDeps;
  listDeadLetters: ReturnType<typeof vi.fn>;
  deleteDeadLetter: ReturnType<typeof vi.fn>;
  countRecent: ReturnType<typeof vi.fn>;
  xadd: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  remainingRows: () => FakeRow[];
} {
  let rows = [...initialRows];
  const batchSize = overrides.batchSize ?? 100;

  const deleteDeadLetter =
    overrides.deleteDeadLetter ??
    vi.fn((id: string) => {
      rows = rows.filter((row) => row.id !== id);
      return Promise.resolve();
    });
  // When a caller injects a custom deleteDeadLetter that still means to
  // remove the row, keep the in-memory store in sync via a wrapper.
  const customDelete = overrides.deleteDeadLetter;
  const wrappedDelete = customDelete
    ? vi.fn(async (id: string) => {
        await customDelete(id);
        rows = rows.filter((row) => row.id !== id);
      })
    : deleteDeadLetter;

  const listDeadLetters = vi.fn(() =>
    Promise.resolve(rows.slice(0, batchSize)),
  );
  const countRecent = vi.fn(() => Promise.resolve(rows.length));
  const xadd = overrides.xadd ?? vi.fn().mockResolvedValue("1-0");
  const warn = vi.fn();
  const log = vi.fn();

  return {
    deps: {
      logger: { warn, log } as never,
      redis: { xadd } as never,
      deadLetters: {
        listDeadLetters,
        deleteDeadLetter: wrappedDelete,
        countRecent,
      } as never,
      streamKey: "stream:core:lifecycle",
    },
    listDeadLetters,
    deleteDeadLetter: wrappedDelete,
    countRecent,
    xadd,
    warn,
    remainingRows: () => rows,
  };
}

describe("replayDeadLetters", () => {
  it("re-XADDs the stored payload verbatim, deletes the row, and reports zero remaining", async () => {
    const row = {
      id: "dl-1",
      payload: {
        event_id: "evt-1",
        envelope: JSON.stringify({ payload: { proposalId: "prop-1" } }),
      },
    };
    const { deps, xadd, deleteDeadLetter } = makeStatefulDeps([row]);

    const result = await replayDeadLetters(deps);

    expect(xadd).toHaveBeenCalledWith(
      "stream:core:lifecycle",
      "*",
      "event_id",
      "evt-1",
      "envelope",
      row.payload.envelope,
    );
    expect(deleteDeadLetter).toHaveBeenCalledWith("dl-1");
    expect(result).toEqual({ replayed: 1, skipped: 0, remaining: 0 });
  });

  it("filters by proposalIds, skipping non-matching rows and counting them as remaining", async () => {
    const rowMatch = {
      id: "dl-1",
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: "prop-match" } }),
      },
    };
    const rowOther = {
      id: "dl-2",
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: "prop-other" } }),
      },
    };
    const { deps, xadd, deleteDeadLetter } = makeStatefulDeps([
      rowMatch,
      rowOther,
    ]);

    const result = await replayDeadLetters(deps, {
      proposalIds: ["prop-match"],
    });

    expect(xadd).toHaveBeenCalledTimes(1);
    expect(deleteDeadLetter).toHaveBeenCalledWith("dl-1");
    expect(deleteDeadLetter).not.toHaveBeenCalledWith("dl-2");
    expect(result).toEqual({ replayed: 1, skipped: 1, remaining: 1 });
  });

  it("skips a row with no payload, logs a warning, does not delete it, and reports it remaining", async () => {
    const row = { id: "dl-empty", payload: null };
    const { deps, deleteDeadLetter, warn } = makeStatefulDeps([row]);

    const result = await replayDeadLetters(deps);

    expect(deleteDeadLetter).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to replay dead letter dl-empty"),
    );
    expect(result).toEqual({ replayed: 0, skipped: 1, remaining: 1 });
  });

  it("fully drains a backlog larger than one batch across multiple internal batches (remaining 0)", async () => {
    const rows: FakeRow[] = Array.from({ length: 5 }, (_, index) => ({
      id: `dl-${index}`,
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: `prop-${index}` } }),
      },
    }));
    const { deps, xadd, deleteDeadLetter, listDeadLetters, remainingRows } =
      makeStatefulDeps(rows, { batchSize: 2 });

    const result = await replayDeadLetters(deps);

    expect(xadd).toHaveBeenCalledTimes(5);
    expect(deleteDeadLetter).toHaveBeenCalledTimes(5);
    // More than one fetch happened (batch size 2, 5 rows) — proving the loop.
    expect(listDeadLetters.mock.calls.length).toBeGreaterThan(1);
    expect(remainingRows()).toHaveLength(0);
    expect(result).toEqual({ replayed: 5, skipped: 0, remaining: 0 });
  });

  it("counts a publish-ok/delete-fail row as replayed, logs a distinct warning, and never re-publishes it in the same call", async () => {
    const stuck = {
      id: "dl-stuck",
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: "prop-stuck" } }),
      },
    };
    const deletable = {
      id: "dl-ok",
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: "prop-ok" } }),
      },
    };
    const deleteDeadLetter = vi.fn((id: string) => {
      if (id === "dl-stuck") {
        return Promise.reject(new Error("row locked"));
      }
      return Promise.resolve();
    });
    const { deps, xadd, warn, countRecent } = makeStatefulDeps(
      [stuck, deletable],
      { deleteDeadLetter },
    );

    const result = await replayDeadLetters(deps);

    // The stuck row's event was published exactly once and never re-emitted,
    // even though it stays in the table across the internal batch loop.
    const stuckPublishCalls = xadd.mock.calls.filter((call) =>
      call.includes(stuck.payload.envelope),
    );
    expect(stuckPublishCalls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Replayed dead letter dl-stuck but failed to clear",
      ),
    );
    expect(countRecent).toHaveBeenCalled();
    expect(result).toEqual({ replayed: 2, skipped: 0, remaining: 1 });
  });

  it("counts a publish-fail row as skipped, leaves it in the table, and terminates", async () => {
    const rowBad = { id: "dl-bad", payload: { envelope: "{}" } };
    const xadd = vi.fn().mockRejectedValue(new Error("redis down"));
    const { deps, deleteDeadLetter, remainingRows } = makeStatefulDeps(
      [rowBad],
      { xadd },
    );

    const result = await replayDeadLetters(deps);

    expect(deleteDeadLetter).not.toHaveBeenCalled();
    // Publish was attempted, but the batch made no progress, so the loop
    // stopped instead of re-publishing the same row forever.
    expect(xadd).toHaveBeenCalledTimes(1);
    expect(remainingRows()).toHaveLength(1);
    expect(result).toEqual({ replayed: 0, skipped: 1, remaining: 1 });
  });

  it("continues past a publish-fail row to replay a healthy row in the same batch", async () => {
    const rowBad = { id: "dl-bad", payload: { envelope: "{bad" } };
    const rowGood = {
      id: "dl-good",
      payload: {
        envelope: JSON.stringify({ payload: { proposalId: "prop-good" } }),
      },
    };
    const xadd = vi
      .fn()
      .mockRejectedValueOnce(new Error("redis down"))
      .mockResolvedValue("2-0");
    const { deps, deleteDeadLetter } = makeStatefulDeps([rowBad, rowGood], {
      xadd,
    });

    const result = await replayDeadLetters(deps);

    expect(deleteDeadLetter).toHaveBeenCalledTimes(1);
    expect(deleteDeadLetter).toHaveBeenCalledWith("dl-good");
    expect(result).toEqual({ replayed: 1, skipped: 1, remaining: 1 });
  });
});
