import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrchestrationPolicyPanel } from "./OrchestrationPolicyPanel";
import * as hooks from "@/hooks/useOrchestrationPolicy";

const updateMutate = vi.fn();

const policyEntry = {
  key: "backlog.ideation_enabled",
  value: true,
  layer: "default",
  defaultValue: true,
  descriptor: {
    key: "backlog.ideation_enabled",
    valueType: "boolean" as const,
    group: "backlog",
    label: "Ideation enabled",
    description: "Whether the ideation gate may fire.",
  },
};

describe("OrchestrationPolicyPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(hooks, "useOrchestrationPolicy").mockReturnValue({
      data: [policyEntry],
      isLoading: false,
    } as never);
    vi.spyOn(hooks, "useUpdateOrchestrationPolicy").mockReturnValue({
      mutate: updateMutate,
      isPending: false,
    } as never);
    vi.spyOn(hooks, "useApplyOrchestrationPreset").mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as never);
  });

  it("renders a control per registry entry with its label", () => {
    render(<OrchestrationPolicyPanel projectId="p-1" />);
    expect(screen.getByText("Ideation enabled")).toBeTruthy();
  });

  it("saves only changed entries", () => {
    render(<OrchestrationPolicyPanel projectId="p-1" />);
    fireEvent.click(screen.getByRole("switch", { name: /ideation enabled/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateMutate).toHaveBeenCalledWith([
      { key: "backlog.ideation_enabled", value: false },
    ]);
  });
});
