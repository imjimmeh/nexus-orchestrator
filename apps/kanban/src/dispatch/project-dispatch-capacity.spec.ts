import { describe, expect, it } from "vitest";
import {
  countActiveProjectDispatchContractItems,
  isProjectDispatchActive,
  isProjectDispatchActiveContractItem,
  resolveProjectDispatchCapacityForContractItems,
} from "./project-dispatch-capacity";

describe("project dispatch capacity contract helpers", () => {
  it("counts active statuses even without linked run identifiers", () => {
    expect(
      isProjectDispatchActiveContractItem({
        status: "in-progress",
        linkedRunId: null,
        currentExecutionId: null,
      }),
    ).toBe(true);
  });

  it("counts linked or current execution identifiers when status projection is stale", () => {
    expect(
      countActiveProjectDispatchContractItems([
        { status: "todo", linkedRunId: "run-1", currentExecutionId: null },
        { status: "backlog", linkedRunId: null, currentExecutionId: "run-2" },
      ]),
    ).toBe(2);
  });

  it("does not count non-active idle statuses", () => {
    expect(
      countActiveProjectDispatchContractItems([
        { status: "backlog", linkedRunId: null, currentExecutionId: null },
        { status: "todo", linkedRunId: null, currentExecutionId: null },
        { status: "done", linkedRunId: null, currentExecutionId: null },
      ]),
    ).toBe(0);
  });

  it("reports no available slots when cap is one and one item is active", () => {
    expect(
      resolveProjectDispatchCapacityForContractItems(
        [
          {
            status: "in-review",
            linkedRunId: null,
            currentExecutionId: null,
          },
        ],
        1,
      ),
    ).toEqual({
      maxActive: 1,
      activeCount: 1,
      availableSlots: 0,
      projectAvailableSlots: 0,
      canLaunchNewWork: false,
    });
  });

  it("does not count a done item that still carries stale run links", () => {
    // A cancelled/terminal run can strand `linked_run_id`/`current_execution_id`
    // on a work item that has already moved to `done`. A terminal item must
    // never consume a dispatch slot regardless of those stale projections.
    expect(
      isProjectDispatchActiveContractItem({
        status: "done",
        linkedRunId: "run-cancelled",
        currentExecutionId: "run-cancelled",
      }),
    ).toBe(false);
  });

  it("does not count a done item with stale run links (snake_case variant)", () => {
    expect(
      isProjectDispatchActive({
        id: "wi-1",
        project_id: "p1",
        status: "done",
        linked_run_id: "run-cancelled",
        current_execution_id: "run-cancelled",
      } as never),
    ).toBe(false);
  });

  it("does not require a new slot for active-to-active movement", () => {
    const currentItem = {
      status: "in-progress",
      linkedRunId: null,
      currentExecutionId: null,
    } as const;

    expect(isProjectDispatchActiveContractItem(currentItem)).toBe(true);
  });
});
