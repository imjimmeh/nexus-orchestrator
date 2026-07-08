import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssignSkillDialog } from "./AssignSkillDialog";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useAgentSkills } from "@/hooks/useAgentSkills";
import { useWorkflows } from "@/hooks/useWorkflows";

vi.mock("@/hooks/useAgentProfiles", () => ({
  useAgentProfiles: vi.fn(),
}));
vi.mock("@/hooks/useAgentSkills", () => ({
  useAgentSkills: vi.fn(),
}));
vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflows: vi.fn(),
  WORKFLOW_NAME_CATALOG_QUERY: { limit: 100, includeInactive: true },
}));

function mockPickerData() {
  vi.mocked(useAgentSkills).mockReturnValue({
    data: [{ id: "skill-1", name: "merge-hygiene" }],
  } as unknown as ReturnType<typeof useAgentSkills>);
  vi.mocked(useAgentProfiles).mockReturnValue({
    data: [{ id: "profile-1", name: "merge-agent" }],
  } as unknown as ReturnType<typeof useAgentProfiles>);
  vi.mocked(useWorkflows).mockReturnValue({
    data: [{ id: "wf-1", name: "ceo-cycle" }],
  } as unknown as ReturnType<typeof useWorkflows>);
}

function selectOption(triggerName: RegExp, optionText: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(screen.getByText(optionText));
}

describe("AssignSkillDialog", () => {
  it("disables submit until a skill and a valid target are chosen", () => {
    mockPickerData();
    const onSubmit = vi.fn();

    render(
      <AssignSkillDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    expect(
      screen.getByRole("button", { name: /assign skill/i }),
    ).toBeDisabled();

    selectOption(/^skill$/i, "merge-hygiene");
    expect(
      screen.getByRole("button", { name: /assign skill/i }),
    ).toBeDisabled();

    selectOption(/^agent profile$/i, "merge-agent");
    expect(
      screen.getByRole("button", { name: /assign skill/i }),
    ).not.toBeDisabled();
  });

  it("submits an agent_profile target with the selected skill and rationale", () => {
    mockPickerData();
    const onSubmit = vi.fn();

    render(
      <AssignSkillDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    selectOption(/^skill$/i, "merge-hygiene");
    selectOption(/^agent profile$/i, "merge-agent");
    fireEvent.change(screen.getByLabelText(/rationale/i), {
      target: { value: "operator requested" },
    });

    fireEvent.click(screen.getByRole("button", { name: /assign skill/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      skillName: "merge-hygiene",
      targets: [{ type: "agent_profile", profileName: "merge-agent" }],
      rationale: "operator requested",
    });
  });

  it("submits a workflow_step target with an optional step id", () => {
    mockPickerData();
    const onSubmit = vi.fn();

    render(
      <AssignSkillDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    selectOption(/^skill$/i, "merge-hygiene");
    selectOption(/^target type$/i, "Workflow step");
    selectOption(/^workflow$/i, "ceo-cycle");
    fireEvent.change(screen.getByLabelText(/step id/i), {
      target: { value: "gather-context" },
    });

    fireEvent.click(screen.getByRole("button", { name: /assign skill/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      skillName: "merge-hygiene",
      targets: [
        {
          type: "workflow_step",
          workflowName: "ceo-cycle",
          stepId: "gather-context",
        },
      ],
    });
  });

  it("omits stepId from the workflow_step target when left blank", () => {
    mockPickerData();
    const onSubmit = vi.fn();

    render(
      <AssignSkillDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />,
    );

    selectOption(/^skill$/i, "merge-hygiene");
    selectOption(/^target type$/i, "Workflow step");
    selectOption(/^workflow$/i, "ceo-cycle");

    fireEvent.click(screen.getByRole("button", { name: /assign skill/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      skillName: "merge-hygiene",
      targets: [{ type: "workflow_step", workflowName: "ceo-cycle" }],
    });
  });
});
