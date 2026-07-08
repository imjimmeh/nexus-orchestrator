import { describe, expect, it } from "vitest";
import {
  getWorkflowNodeStatusAppearance,
  getWorkflowRunStatusAppearance,
  isActiveWorkflowRunStatus,
} from "./workflow-status";

describe("workflow-status", () => {
  it("maps run statuses to normalized badge appearance", () => {
    expect(getWorkflowRunStatusAppearance("RUNNING")).toEqual({
      label: "Running",
      variant: "default",
    });

    expect(getWorkflowRunStatusAppearance("FAILED")).toEqual({
      label: "Failed",
      variant: "destructive",
    });
  });

  it("maps node statuses to normalized badge appearance", () => {
    expect(getWorkflowNodeStatusAppearance("waiting_input")).toEqual({
      label: "Waiting Input",
      variant: "secondary",
    });

    expect(getWorkflowNodeStatusAppearance("succeeded")).toEqual({
      label: "Succeeded",
      variant: "default",
    });
  });

  it("handles unknown statuses safely", () => {
    expect(getWorkflowRunStatusAppearance(null)).toEqual({
      label: "Unknown",
      variant: "outline",
    });
    expect(getWorkflowNodeStatusAppearance(undefined)).toEqual({
      label: "Unknown",
      variant: "outline",
    });
  });

  it("identifies active run statuses", () => {
    expect(isActiveWorkflowRunStatus("PENDING")).toBe(true);
    expect(isActiveWorkflowRunStatus("RUNNING")).toBe(true);
    expect(isActiveWorkflowRunStatus("COMPLETED")).toBe(false);
  });
});
