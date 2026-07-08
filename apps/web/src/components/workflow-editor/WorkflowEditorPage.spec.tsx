import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ReactFlowProvider } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkflowEditorPage } from "./WorkflowEditorPage";
import { useWorkflowEditorStore } from "./hooks/useWorkflowEditorStore";
import type { EditorAction } from "./hooks/useWorkflowEditorStore.types";

const mockUseWorkflow = vi.fn();
const mockCreateWorkflowMutateAsync = vi.fn();
const mockUpdateWorkflowMutateAsync = vi.fn();
const mockNavigate = vi.fn();
const mockParseYamlToGraph = vi.fn();
const mockSerializeGraphToYaml = vi.fn();

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflow: (...args: unknown[]) => mockUseWorkflow(...args),
  useCreateWorkflow: () => ({
    mutateAsync: mockCreateWorkflowMutateAsync,
    isPending: false,
  }),
  useUpdateWorkflow: () => ({
    mutateAsync: mockUpdateWorkflowMutateAsync,
    isPending: false,
  }),
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children: ReactNode }) => (
    <div data-group>{children}</div>
  ),
  Panel: ({
    children,
    defaultSize,
    minSize,
    maxSize,
  }: {
    children: ReactNode;
    defaultSize?: number;
    minSize?: number;
    maxSize?: number;
  }) => (
    <div
      data-panel
      data-default-size={defaultSize}
      data-min-size={minSize}
      data-max-size={maxSize ?? ""}
    >
      {children}
    </div>
  ),
  Separator: ({ className }: { className?: string }) => (
    <div className={className} data-separator />
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useParams: vi.fn(() => ({})),
    useNavigate: vi.fn(() => mockNavigate),
  };
});

vi.mock("./serialization/yaml-to-graph", () => ({
  parseYamlToGraph: (yaml: string) => mockParseYamlToGraph(yaml),
}));

vi.mock("./serialization/graph-to-yaml", () => ({
  serializeGraphToYaml: (...args: unknown[]) =>
    mockSerializeGraphToYaml(...args),
}));

function parsedFixture() {
  return {
    metadata: {
      workflowId: "wf-1",
      name: "Test Workflow",
      description: "",
      trigger: null,
      concurrency: null,
      permissions: null,
      globalEnv: {},
      strictDependencies: false,
      active: true,
    },
    nodes: [],
    edges: [],
  };
}

function renderPage(isEditMode = false, repoMode = false) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ReactFlowProvider>
          <WorkflowEditorPage isEditMode={isEditMode} repoMode={repoMode} />
        </ReactFlowProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type WorkflowEditorStateUpdate = Partial<
  ReturnType<typeof useWorkflowEditorStore.getState>
>;

function setWorkflowEditorState(update: WorkflowEditorStateUpdate) {
  act(() => {
    useWorkflowEditorStore.setState(update);
  });
}

function resetWorkflowEditorState() {
  act(() => {
    useWorkflowEditorStore.getState().resetState({});
  });
}

describe("WorkflowEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkflowEditorState();
    mockUseWorkflow.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
    });
    mockParseYamlToGraph.mockReturnValue(parsedFixture());
    mockSerializeGraphToYaml.mockReturnValue("name: Test\njobs: []\n");
    mockCreateWorkflowMutateAsync.mockResolvedValue({ id: "new-id" });
    mockUpdateWorkflowMutateAsync.mockResolvedValue(undefined);
  });

  afterEach(() => {
    resetWorkflowEditorState();
  });

  describe("rendering", () => {
    it("renders the header with save and cancel buttons", () => {
      renderPage();
      expect(screen.getByRole("button", { name: /save/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^cancel$/i })).toBeTruthy();
    });

    it("renders the node palette", () => {
      renderPage();
      expect(screen.getByText(/node palette/i)).toBeTruthy();
    });

    it("renders the ReactFlow canvas", () => {
      renderPage();
      expect(document.querySelector(".react-flow")).toBeTruthy();
    });

    it("renders the toolbar", () => {
      renderPage();
      expect(screen.getByRole("button", { name: /undo/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /auto layout/i })).toBeTruthy();
    });

    it("renders the properties panel", () => {
      renderPage();
      expect(screen.getByText(/properties/i)).toBeTruthy();
    });

    it("offers lifecycle triggers in repository mode", async () => {
      const user = userEvent.setup();

      renderPage(false, true);

      await user.click(screen.getByRole("button", { name: "Trigger" }));
      await user.click(screen.getByRole("combobox", { name: "Type" }));

      expect(screen.getByText("Lifecycle")).toBeTruthy();
    });

    it("renders a three-panel resizable layout", () => {
      const { container } = renderPage();
      expect(container.querySelector("[data-group]")).toBeTruthy();
    });

    it("does not cap sidebar panel growth", () => {
      const { container } = renderPage();

      const panels = container.querySelectorAll("[data-panel]");

      expect(panels).toHaveLength(3);
      expect(panels[0]?.getAttribute("data-max-size")).toBe("");
      expect(panels[2]?.getAttribute("data-max-size")).toBe("");
    });
  });

  describe("save handler", () => {
    it("calls createWorkflow API when save button is clicked in create mode", async () => {
      const user = userEvent.setup();
      renderPage(false);
      setWorkflowEditorState({ isDirty: true, name: "New Workflow" });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(mockSerializeGraphToYaml).toHaveBeenCalledOnce();
        expect(mockCreateWorkflowMutateAsync).toHaveBeenCalledOnce();
      });
    });

    it("calls updateWorkflow API when save button is clicked in edit mode", async () => {
      const user = userEvent.setup();
      renderPage(true);
      setWorkflowEditorState({
        isDirty: true,
        name: "Updated",
        workflowId: "wf-1",
      });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(mockSerializeGraphToYaml).toHaveBeenCalledOnce();
        expect(mockUpdateWorkflowMutateAsync).toHaveBeenCalledOnce();
      });
    });

    it("disables save button while saving", async () => {
      let resolveSave: ((value: unknown) => void) | undefined;
      const savePromise = new Promise((resolve) => {
        resolveSave = resolve;
      });
      mockCreateWorkflowMutateAsync.mockReturnValue(savePromise);

      const user = userEvent.setup();
      renderPage(false);
      setWorkflowEditorState({ isDirty: true, name: "Workflow" });

      await user.click(screen.getByRole("button", { name: /save/i }));

      expect(screen.getByRole("button", { name: /saving/i })).toBeTruthy();

      await act(async () => {
        resolveSave?.({ id: "new-id" });
        await savePromise;
      });
    });

    it("clears validationErrors on successful create save", async () => {
      useWorkflowEditorStore
        .getState()
        .setValidationErrors({ name: "old error" });
      const user = userEvent.setup();
      renderPage(false);
      setWorkflowEditorState({ isDirty: true, name: "New Workflow" });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useWorkflowEditorStore.getState().validationErrors).toEqual({});
      });
    });

    it("stores validation errors from create API when 400 response with field errors", async () => {
      const validationErrors = [
        { path: "name", message: "Name is required", code: "invalid_type" },
        {
          path: "jobs.0.id",
          message: "Job id is required",
          code: "invalid_type",
        },
      ];
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: {
              details: { errors: validationErrors },
            },
          },
        },
      };
      mockCreateWorkflowMutateAsync.mockRejectedValue(axiosError);

      const user = userEvent.setup();
      renderPage(false);
      setWorkflowEditorState({ isDirty: true, name: "Bad Workflow" });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useWorkflowEditorStore.getState().validationErrors).toEqual({
          name: "Name is required",
          "jobs.0.id": "Job id is required",
        });
      });
    });

    it("stores validation errors from update API when 400 response with field errors", async () => {
      const validationErrors = [
        {
          path: "yaml_definition",
          message: "Invalid YAML structure",
          code: "custom",
        },
      ];
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: {
              details: { errors: validationErrors },
            },
          },
        },
      };
      mockUpdateWorkflowMutateAsync.mockRejectedValue(axiosError);

      const user = userEvent.setup();
      renderPage(true);
      setWorkflowEditorState({
        isDirty: true,
        name: "Bad Edit",
        workflowId: "wf-1",
      });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useWorkflowEditorStore.getState().validationErrors).toEqual({
          yaml_definition: "Invalid YAML structure",
        });
      });
    });

    it("stores validation errors from update API when 422 response with field errors", async () => {
      const validationErrors = [
        {
          path: "jobs.0.name",
          message: "Must be a string",
          code: "invalid_type",
        },
      ];
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 422,
          data: {
            error: {
              details: { errors: validationErrors },
            },
          },
        },
      };
      mockUpdateWorkflowMutateAsync.mockRejectedValue(axiosError);

      const user = userEvent.setup();
      renderPage(true);
      setWorkflowEditorState({
        isDirty: true,
        name: "Bad Edit",
        workflowId: "wf-2",
      });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useWorkflowEditorStore.getState().validationErrors).toEqual({
          "jobs.0.name": "Must be a string",
        });
      });
    });

    it("leaves validationErrors empty for non-validation errors (500)", async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { error: { message: "Internal Server Error" } },
        },
      };
      mockCreateWorkflowMutateAsync.mockRejectedValue(axiosError);

      const user = userEvent.setup();
      renderPage(false);
      setWorkflowEditorState({ isDirty: true, name: "Server Error" });
      act(() => {
        useWorkflowEditorStore.getState().setValidationErrors({ name: "old" });
      });

      await user.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => {
        expect(useWorkflowEditorStore.getState().validationErrors).toEqual({
          name: "old",
        });
      });
    });
  });

  describe("cancel handler", () => {
    it("navigates to /workflows when cancel button is clicked", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(mockNavigate).toHaveBeenCalledWith("/workflows");
    });
  });

  describe("store lifecycle", () => {
    it("initializes store on mount in create mode", () => {
      setWorkflowEditorState({ name: "old-garbage" });
      renderPage(false);
      expect(useWorkflowEditorStore.getState().name).toBe("");
      expect(useWorkflowEditorStore.getState().nodes).toEqual([]);
    });

    it("loads workflow data into store in edit mode", async () => {
      const { useParams } = await import("react-router-dom");
      vi.mocked(useParams).mockReturnValue({ id: "wf-123" });
      mockUseWorkflow.mockReturnValue({
        data: {
          id: "wf-123",
          yaml_definition: "name: Test\njobs: []\n",
          is_active: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
      });

      renderPage(true);

      expect(mockParseYamlToGraph).toHaveBeenCalledWith(
        "name: Test\njobs: []\n",
      );
      expect(useWorkflowEditorStore.getState().name).toBe("Test Workflow");
    });

    it("does not parse workflow YAML in create mode", () => {
      renderPage(false);
      expect(mockParseYamlToGraph).not.toHaveBeenCalled();
    });

    it("resets store to empty on unmount", () => {
      const { unmount } = renderPage(false);
      setWorkflowEditorState({
        name: "changed",
        nodes: [{ id: "n1", position: { x: 0, y: 0 }, data: {} }],
      });
      act(() => {
        unmount();
      });
      expect(useWorkflowEditorStore.getState().name).toBe("");
      expect(useWorkflowEditorStore.getState().nodes).toEqual([]);
    });
  });

  describe("keyboard shortcuts", () => {
    it("calls store undo on Ctrl+Z", async () => {
      const user = userEvent.setup();
      const undoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "undo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ undoStack: [{} as EditorAction] });
      renderPage();

      await user.keyboard("{Control>}z{/Control}");

      expect(undoSpy).toHaveBeenCalledOnce();
    });

    it("calls store redo on Ctrl+Shift+Z", async () => {
      const user = userEvent.setup();
      const redoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "redo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ redoStack: [{} as EditorAction] });
      renderPage();

      await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

      expect(redoSpy).toHaveBeenCalledOnce();
    });

    it("calls store redo on Ctrl+Y", async () => {
      const user = userEvent.setup();
      const redoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "redo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ redoStack: [{} as EditorAction] });
      renderPage();

      await user.keyboard("{Control>}y{/Control}");

      expect(redoSpy).toHaveBeenCalledOnce();
    });

    it("does not call undo when focus is in an INPUT", async () => {
      const user = userEvent.setup();
      const undoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "undo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ undoStack: [{} as EditorAction] });
      renderPage();

      const input = document.createElement("input");
      document.body.appendChild(input);
      input.focus();

      await user.keyboard("{Control>}z{/Control}");

      expect(undoSpy).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it("does not call undo when focus is in a TEXTAREA", async () => {
      const user = userEvent.setup();
      const undoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "undo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ undoStack: [{} as EditorAction] });
      renderPage();

      const textarea = document.createElement("textarea");
      document.body.appendChild(textarea);
      textarea.focus();

      await user.keyboard("{Control>}z{/Control}");

      expect(undoSpy).not.toHaveBeenCalled();

      document.body.removeChild(textarea);
    });

    it("does not call undo when focus is in a SELECT", async () => {
      const user = userEvent.setup();
      const undoSpy = vi
        .spyOn(useWorkflowEditorStore.getState(), "undo")
        .mockImplementation(() => {});
      setWorkflowEditorState({ undoStack: [{} as EditorAction] });
      renderPage();

      const select = document.createElement("select");
      document.body.appendChild(select);
      select.focus();

      await user.keyboard("{Control>}z{/Control}");

      expect(undoSpy).not.toHaveBeenCalled();

      document.body.removeChild(select);
    });
  });

  describe("auto-layout", () => {
    it("repositions job nodes based on topological levels", async () => {
      const user = userEvent.setup();
      renderPage();

      const jobA: Node = {
        id: "job-a",
        type: "job",
        position: { x: 999, y: 888 },
        data: { label: "Job A", jobType: "execution", jobId: "job-a" },
      };
      const jobB: Node = {
        id: "job-b",
        type: "job",
        position: { x: 777, y: 666 },
        data: { label: "Job B", jobType: "execution", jobId: "job-b" },
      };
      const dependencyEdge: Edge = {
        id: "dep-1",
        source: "job-a",
        target: "job-b",
        type: "dependency",
        data: { kind: "dependency" },
      };

      setWorkflowEditorState({
        nodes: [jobA, jobB],
        edges: [dependencyEdge],
      });

      await user.click(screen.getByRole("button", { name: /auto layout/i }));

      const { nodes: updatedNodes } = useWorkflowEditorStore.getState();
      const a = updatedNodes.find((n) => n.id === "job-a");
      const b = updatedNodes.find((n) => n.id === "job-b");

      expect(a?.position).toEqual({ x: 0, y: 0 });
      expect(b?.position).toEqual({ x: 360, y: 0 });
    });

    it("preserves step node positions", async () => {
      const user = userEvent.setup();
      renderPage();

      const jobNode: Node = {
        id: "job-main",
        type: "job",
        position: { x: 100, y: 100 },
        data: { label: "Main", jobType: "execution", jobId: "job-main" },
      };
      const stepNode: Node = {
        id: "step-1",
        type: "step",
        position: { x: 50, y: 50 },
        data: {
          label: "Step",
          stepType: "agent",
          stepId: "s1",
          parentJobId: "job-main",
        },
      };

      setWorkflowEditorState({
        nodes: [jobNode, stepNode],
        edges: [],
      });

      await user.click(screen.getByRole("button", { name: /auto layout/i }));

      const { nodes: updatedNodes } = useWorkflowEditorStore.getState();
      const step = updatedNodes.find((n) => n.id === "step-1");
      expect(step?.position).toEqual({ x: 50, y: 50 });
    });

    it("pushes an undo action for repositioned nodes", async () => {
      const user = userEvent.setup();
      renderPage();

      const jobNode: Node = {
        id: "job-u",
        type: "job",
        position: { x: 500, y: 300 },
        data: { label: "Undo Job", jobType: "execution", jobId: "job-u" },
      };

      setWorkflowEditorState({
        nodes: [jobNode],
        edges: [],
      });

      await user.click(screen.getByRole("button", { name: /auto layout/i }));

      const { undoStack } = useWorkflowEditorStore.getState();
      expect(undoStack.length).toBeGreaterThanOrEqual(1);
      const lastAction = undoStack[undoStack.length - 1];
      expect(lastAction.type).toBe("move_node");
    });

    it("marks the store as dirty after auto-layout", async () => {
      const user = userEvent.setup();
      renderPage();

      act(() => {
        useWorkflowEditorStore.getState().markClean();
      });

      const jobNode: Node = {
        id: "job-d",
        type: "job",
        position: { x: 10, y: 10 },
        data: { label: "Dirty Job", jobType: "execution", jobId: "job-d" },
      };

      setWorkflowEditorState({
        nodes: [jobNode],
        edges: [],
      });

      await user.click(screen.getByRole("button", { name: /auto layout/i }));

      expect(useWorkflowEditorStore.getState().isDirty).toBe(true);
    });
  });
});
