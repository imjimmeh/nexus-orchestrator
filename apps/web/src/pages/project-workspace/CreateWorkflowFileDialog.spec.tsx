import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { CreateWorkflowFileDialog } from "./CreateWorkflowFileDialog";

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: vi.fn(() => mockNavigate),
  };
});

function renderDialog() {
  const onClose = vi.fn();

  render(
    <MemoryRouter>
      <CreateWorkflowFileDialog open onClose={onClose} projectId="project-1" />
    </MemoryRouter>,
  );

  return { onClose };
}

async function createWorkflowFile() {
  const user = userEvent.setup();

  renderDialog();

  await user.type(screen.getByLabelText("Filename"), "pre-merge-ci");
  await user.click(screen.getByRole("button", { name: /create & edit/i }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

  return mockNavigate.mock.calls[0][1] as { state: { template: string } };
}

describe("CreateWorkflowFileDialog", () => {
  it("starts repository workflows with a ready-to-merge lifecycle trigger", async () => {
    const navigateOptions = await createWorkflowFile();

    expect(navigateOptions.state.template).toContain("phase: ready-to-merge");
  });

  it("starts repository workflows with an array jobs section", async () => {
    const navigateOptions = await createWorkflowFile();

    expect(navigateOptions.state.template).toContain("jobs: []");
    expect(navigateOptions.state.template).not.toContain("jobs: {}");
  });
});
