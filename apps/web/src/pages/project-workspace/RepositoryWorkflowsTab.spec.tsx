import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api/client";
import { workflowFilesClient } from "@/lib/api/client.workflow-files";
import { useWorkflowRuns } from "@/hooks/useWorkflows";
import {
  buildColumnGroups,
  RepositoryWorkflowsTab,
} from "./RepositoryWorkflowsTab";
import type { WorkflowFileItem } from "@/lib/api/client.workflow-files.types";

vi.mock("@/lib/api/client.workflow-files", () => ({
  workflowFilesClient: {
    list: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflowRuns: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({
  api: {
    refreshRepositoryWorkflows: vi.fn(),
    getProjectRepositoryWorkflowSettings: vi.fn(),
    updateProjectRepositoryWorkflowSettings: vi.fn(),
  },
}));

function renderTab(repositoryRootPath: string | null = "G:/code/project") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RepositoryWorkflowsTab
          projectId="project-1"
          repositoryRootPath={repositoryRootPath}
        />
      </BrowserRouter>
    </QueryClientProvider>,
  );
}

describe("RepositoryWorkflowsTab", () => {
  beforeEach(() => {
    vi.mocked(workflowFilesClient.list).mockResolvedValue({ files: [] });
    vi.mocked(useWorkflowRuns).mockReturnValue({
      data: [
        {
          id: "run-1",
          workflow_id: "workflow-1",
          workflow_name: "Repository CI",
          status: "COMPLETED",
          source_type: "repository",
          state_variables: { trigger: { source: "push" } },
          created_at: "2026-06-05T10:00:00.000Z",
          updated_at: "2026-06-05T10:01:00.000Z",
          completed_at: "2026-06-05T10:01:00.000Z",
        },
      ],
      isLoading: false,
    } as ReturnType<typeof useWorkflowRuns>);
    vi.mocked(api.refreshRepositoryWorkflows).mockResolvedValue({
      discovered: 1,
      upserted: 1,
      removed: 0,
    });
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });
  });

  it("loads repository workflow runs scoped to the current project", async () => {
    renderTab();

    expect(useWorkflowRuns).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceType: "repository",
      refetchIntervalMs: 10000,
    });
    expect(await screen.findByText("Recent Runs")).toBeTruthy();
    expect(screen.getByText("Repository CI")).toBeTruthy();
    expect(screen.getByText("push")).toBeTruthy();
  });

  it("refreshes discovery with the required repository root path", async () => {
    renderTab();

    await userEvent.click(
      await screen.findByRole("button", { name: /refresh discovery/i }),
    );

    await waitFor(() => {
      expect(api.refreshRepositoryWorkflows).toHaveBeenCalledWith({
        scopeId: "project-1",
        rootPath: "G:/code/project",
      });
    });
  });

  it("does not call refresh discovery when the repository root path is missing", async () => {
    renderTab(null);

    expect(screen.getByText(/repository root path is required/i)).toBeTruthy();
    await screen.findByText(/lifecycle gates/i);
    expect(
      (
        screen.getByRole("button", {
          name: /refresh discovery/i,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("RepositoryWorkflowsTab — grouped view", () => {
  beforeEach(() => {
    vi.mocked(workflowFilesClient.list).mockResolvedValue({
      files: [
        {
          path: ".nexus/workflows/ready-to-merge.before.workflow.yaml",
          size: 100,
          trigger: { phase: "ready-to-merge", hook: "before", blocking: true },
        },
        {
          path: ".nexus/workflows/in-review.after.workflow.yaml",
          size: 80,
          trigger: { phase: "in-review", hook: "after", blocking: false },
        },
        {
          path: ".nexus/workflows/custom-tool.workflow.yaml",
          size: 60,
          trigger: null,
        },
      ],
    });
    vi.mocked(useWorkflowRuns).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useWorkflowRuns>);
    vi.mocked(api.refreshRepositoryWorkflows).mockResolvedValue({
      discovered: 3,
      upserted: 3,
      removed: 0,
    });
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });
  });

  it("renders a section heading for 'Ready to Merge' with the before-gate file listed under it", async () => {
    renderTab();

    expect(
      await screen.findByRole("heading", { name: /ready to merge/i }),
    ).toBeTruthy();
    expect(
      screen.getByText("ready-to-merge.before.workflow.yaml"),
    ).toBeTruthy();
  });

  it("renders a section heading for 'In Review' with the after-hook file listed under it", async () => {
    renderTab();

    expect(
      await screen.findByRole("heading", { name: /in review/i }),
    ).toBeTruthy();
    expect(screen.getByText("in-review.after.workflow.yaml")).toBeTruthy();
  });

  it("shows a 'blocking' badge on before-gate entries and 'react' badge on after-hook entries", async () => {
    renderTab();

    await screen.findByText("ready-to-merge.before.workflow.yaml");
    expect(screen.getByText(/blocking/i)).toBeTruthy();
    expect(screen.getByText(/react/i)).toBeTruthy();
  });

  it("renders ungrouped lifecycle files in an 'Other' section", async () => {
    renderTab();

    await screen.findByText("custom-tool.workflow.yaml");
    expect(screen.getByRole("heading", { name: /other/i })).toBeTruthy();
  });

  it("shows a muted 'No gates configured' message for columns that have no bindings", async () => {
    renderTab();

    await screen.findByRole("heading", { name: /ready to merge/i });
    // Multiple columns have no bindings (e.g. Backlog, Refinement, etc.)
    const emptyMessages = screen.getAllByText(/no gates configured/i);
    expect(emptyMessages.length).toBeGreaterThan(0);
  });
});

describe("buildColumnGroups", () => {
  it("groups a file by its trigger.phase, not its filename", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/pre-merge-ci.workflow.yaml",
        size: 100,
        trigger: { phase: "ready-to-merge", hook: "before", blocking: true },
      },
    ];

    const { columnGroups, otherFiles } = buildColumnGroups(files);

    const rtmGroup = columnGroups.find((g) => g.status === "ready-to-merge");
    expect(rtmGroup?.files).toHaveLength(1);
    expect(rtmGroup?.files[0].path).toContain("pre-merge-ci");
    expect(otherFiles).toHaveLength(0);
  });

  it("puts a file with trigger: null in otherFiles", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/manual.workflow.yaml",
        size: 50,
        trigger: null,
      },
    ];

    const { columnGroups, otherFiles } = buildColumnGroups(files);

    expect(otherFiles).toHaveLength(1);
    expect(columnGroups.every((g) => g.files.length === 0)).toBe(true);
  });

  it("puts a file whose trigger.phase is not a known column status in otherFiles", () => {
    const files: WorkflowFileItem[] = [
      {
        path: ".nexus/workflows/custom.workflow.yaml",
        size: 60,
        trigger: {
          phase: "some-unknown-phase",
          hook: "before",
          blocking: true,
        },
      },
    ];

    const { otherFiles } = buildColumnGroups(files);

    expect(otherFiles).toHaveLength(1);
  });
});

describe("RepositoryWorkflowsTab — gate settings", () => {
  beforeEach(() => {
    vi.mocked(workflowFilesClient.list).mockResolvedValue({ files: [] });
    vi.mocked(useWorkflowRuns).mockReturnValue({
      data: [],
      isLoading: false,
    } as ReturnType<typeof useWorkflowRuns>);
    vi.mocked(api.updateProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: true,
      overrides: {},
    });
  });

  it("renders a gate settings card with a lifecycle gates toggle", async () => {
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });

    renderTab();

    expect(await screen.findByText(/lifecycle gates/i)).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("shows a disabled notice when lifecycle gates are turned off", async () => {
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });

    renderTab();

    expect(
      await screen.findByText(/lifecycle gates are disabled/i),
    ).toBeTruthy();
  });

  it("hides the disabled notice when lifecycle gates are turned on", async () => {
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: true,
      overrides: {},
    });

    renderTab();

    await screen.findByRole("switch");
    expect(screen.queryByText(/lifecycle gates are disabled/i)).toBeNull();
  });

  it("calls updateProjectRepositoryWorkflowSettings with enabled=true when the switch is toggled on", async () => {
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });

    renderTab();

    await userEvent.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(api.updateProjectRepositoryWorkflowSettings).toHaveBeenCalledWith(
        "project-1",
        { enabled: true },
      );
    });
  });

  it("calls updateProjectRepositoryWorkflowSettings with enabled=false when the switch is toggled off", async () => {
    vi.mocked(api.getProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: true,
      overrides: {},
    });
    vi.mocked(api.updateProjectRepositoryWorkflowSettings).mockResolvedValue({
      enabled: false,
      overrides: {},
    });

    renderTab();

    await userEvent.click(await screen.findByRole("switch"));

    await waitFor(() => {
      expect(api.updateProjectRepositoryWorkflowSettings).toHaveBeenCalledWith(
        "project-1",
        { enabled: false },
      );
    });
  });
});
