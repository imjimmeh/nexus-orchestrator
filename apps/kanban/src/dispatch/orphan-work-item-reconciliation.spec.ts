import { describe, it, expect } from "vitest";
import { isOrphanedInProgressItem } from "./orphan-work-item-reconciliation";

describe("isOrphanedInProgressItem", () => {
  it("returns true for in-progress item with null linked_run_id and null current_execution_id", () => {
    expect(
      isOrphanedInProgressItem({
        status: "in-progress",
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(true);
  });

  it("returns false for todo item with null linked_run_id", () => {
    expect(
      isOrphanedInProgressItem({
        status: "todo",
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(false);
  });

  it("returns false for in-progress item with a linked_run_id", () => {
    expect(
      isOrphanedInProgressItem({
        status: "in-progress",
        linked_run_id: "some-run-id",
        current_execution_id: null,
      }),
    ).toBe(false);
  });

  it("returns false for in-progress item with a current_execution_id", () => {
    expect(
      isOrphanedInProgressItem({
        status: "in-progress",
        linked_run_id: null,
        current_execution_id: "some-exec-id",
      }),
    ).toBe(false);
  });

  it("returns false for backlog item", () => {
    expect(
      isOrphanedInProgressItem({
        status: "backlog",
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(false);
  });

  it("returns false for done item", () => {
    expect(
      isOrphanedInProgressItem({
        status: "done",
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(false);
  });

  it("returns false for blocked item", () => {
    expect(
      isOrphanedInProgressItem({
        status: "blocked",
        linked_run_id: null,
        current_execution_id: null,
      }),
    ).toBe(false);
  });

  it("returns false for in-progress item with both linked_run_id and current_execution_id", () => {
    expect(
      isOrphanedInProgressItem({
        status: "in-progress",
        linked_run_id: "some-run-id",
        current_execution_id: "some-exec-id",
      }),
    ).toBe(false);
  });
});
