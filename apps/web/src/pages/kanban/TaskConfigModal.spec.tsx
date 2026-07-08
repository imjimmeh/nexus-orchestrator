import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskConfigModal } from "./TaskConfigModal";

describe("TaskConfigModal", () => {
  it("shows validation error when target branch has invalid characters", async () => {
    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        workItemTitle="Task A"
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        onSave={() => undefined}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("feature/epic-21-task"), {
      target: { value: "feature/task a" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(
      await screen.findByText("Target branch contains invalid characters."),
    ).toBeTruthy();
  });

  it("submits normalized payload", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        workItemTitle="Task A"
        agentProfiles={[]}
        branches={["main"]}
        files={["src/app.ts"]}
        initialConfig={{
          baseBranch: "main",
          targetBranch: "feature/task-a",
          contextFiles: ["src/app.ts"],
          documentationUrls: [],
        }}
        onSave={onSave}
      />,
    );

    const targetBranchInput = screen.getByPlaceholderText(
      "feature/epic-21-task",
    );
    fireEvent.change(targetBranchInput, {
      target: { value: "feature/task-b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "main",
        targetBranch: "feature/task-b",
        contextFiles: ["src/app.ts"],
      }),
    );
  });

  it("shows validation error when target branch matches base branch", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        workItemTitle="Task A"
        agentProfiles={[]}
        branches={["master"]}
        files={[]}
        initialConfig={{
          baseBranch: "master",
          targetBranch: "master",
          contextFiles: [],
          documentationUrls: [],
        }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(
      await screen.findByText(
        "Target branch must be different from base branch. A work item runs in its own branch.",
      ),
    ).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("prefills a suggested target branch from work item title", () => {
    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        workItemTitle="Create PRD"
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        onSave={() => undefined}
      />,
    );

    const targetBranchInput = screen.getByDisplayValue("feature/create-prd");
    expect(targetBranchInput).toBeTruthy();
  });

  it("includes model in saved config when set", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        initialConfig={{
          baseBranch: "main",
          targetBranch: "feature/x",
          contextFiles: [],
          documentationUrls: [],
        }}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("claude-sonnet-4-6"), {
      target: { value: "claude-opus-4-8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-8" }),
    );
  });

  it("omits model from saved config when field is blank", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        initialConfig={{
          baseBranch: "main",
          targetBranch: "feature/x",
          contextFiles: [],
          documentationUrls: [],
        }}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.not.objectContaining({ model: expect.anything() }),
    );
  });

  it("shows forceModelForSubagents checkbox only when model is set and includes it in saved config", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        initialConfig={{
          baseBranch: "main",
          targetBranch: "feature/x",
          contextFiles: [],
          documentationUrls: [],
        }}
        onSave={onSave}
      />,
    );

    expect(screen.queryByRole("checkbox", { name: /force model/i })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("claude-sonnet-4-6"), {
      target: { value: "claude-opus-4-8" },
    });

    const checkbox = screen.getByRole("checkbox", { name: /force model/i });
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: "Save Configuration" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-8",
        forceModelForSubagents: true,
      }),
    );
  });

  it("prefills model and forceModelForSubagents from initialConfig", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <TaskConfigModal
        open
        onOpenChange={() => undefined}
        agentProfiles={[]}
        branches={["main"]}
        files={[]}
        initialConfig={{
          baseBranch: "main",
          targetBranch: "feature/x",
          contextFiles: [],
          documentationUrls: [],
          model: "claude-opus-4-8",
          forceModelForSubagents: true,
        }}
        onSave={onSave}
      />,
    );

    expect(screen.getByDisplayValue("claude-opus-4-8")).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: /force model/i }),
    ).toBeChecked();
  });
});
