import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { ScopeProvider } from "@/context/ScopeContext";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { WorkflowDetail } from "./WorkflowDetail";

function renderWithProviders(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
        <ScopeProvider>{ui}</ScopeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

interface WorkflowRunContextStripMockProps {
  selectedRunId?: string;
}

interface WorkflowLaunchDialogMockProps {
  onLaunched?: (params: { runId: string | null }) => void;
}

const hooksMock = vi.hoisted(() => ({
  useWorkflow: vi.fn(),
  useWorkflowRuns: vi.fn(),
  useWorkflowRunGraph: vi.fn(),
}));

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const workflowRunContextStripMock = vi.hoisted(() => ({
  component: vi.fn((_props: WorkflowRunContextStripMockProps) => null),
}));

const workflowLaunchDialogMock = vi.hoisted(() => ({
  component: vi.fn((_props: WorkflowLaunchDialogMockProps) => null),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useParams: () => ({ id: "workflow-1" }),
    useNavigate: () => routerMock.navigate,
    useLocation: () => ({ pathname: "/workflows/workflow-1", state: {} }),
  };
});

vi.mock("@/hooks/useWorkflows", () => ({
  useWorkflow: hooksMock.useWorkflow,
  useWorkflowRuns: hooksMock.useWorkflowRuns,
}));

vi.mock("@/hooks/useWorkflowRunGraph", () => ({
  useWorkflowRunGraph: hooksMock.useWorkflowRunGraph,
}));

vi.mock("@/components/workflow/WorkflowRunContextStrip", () => ({
  WorkflowRunContextStrip: workflowRunContextStripMock.component,
}));

vi.mock("@/components/workflow/WorkflowLaunchDialog", () => ({
  WorkflowLaunchDialog: workflowLaunchDialogMock.component,
}));

vi.mock("@/components/workflow/YamlEditor", () => ({
  YamlEditor: () => null,
}));

vi.mock("@/components/workflow/WorkflowVisualizer", () => ({
  WorkflowVisualizer: () => null,
}));

vi.mock("@/components/workflow/ExecutionLogs", () => ({
  ExecutionLogs: () => null,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AlertTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => null,
  Play: () => null,
  Pencil: () => null,
  Loader2: () => null,
  AlertCircle: () => null,
  CheckCircle2: () => null,
  Globe: () => null,
}));

vi.mock("@/lib/utils", () => ({
  formatDateSafe: () => "Jun 5, 2026",
}));

function buildRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflow_id: "workflow-1",
    status: "COMPLETED",
    state_variables: {},
    created_at: "2026-06-05T10:00:00.000Z",
    updated_at: "2026-06-05T10:00:00.000Z",
    ...overrides,
  } as WorkflowRun;
}

describe("WorkflowDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    hooksMock.useWorkflow.mockReturnValue({
      data: {
        id: "workflow-1",
        name: "Workflow 1",
        is_active: true,
        created_at: "2026-06-05T10:00:00.000Z",
        yaml_definition: "steps: []",
      },
      isLoading: false,
    });

    hooksMock.useWorkflowRuns.mockReturnValue({
      data: [buildRun({ id: "run-1" }), buildRun({ id: "run-2" })],
      isLoading: false,
    });

    hooksMock.useWorkflowRunGraph.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
    });
  });

  it("uses the resolved selected run id for the graph hook and context strip", () => {
    renderWithProviders(<WorkflowDetail />);

    expect(hooksMock.useWorkflowRunGraph).toHaveBeenCalled();
    expect(hooksMock.useWorkflowRunGraph.mock.calls[0]?.[0]).toEqual({
      workflowId: "workflow-1",
      runId: "run-1",
    });
    expect(workflowRunContextStripMock.component).toHaveBeenCalled();
    expect(
      workflowRunContextStripMock.component.mock.calls[0]?.[0],
    ).toMatchObject({
      selectedRunId: "run-1",
    });
  });

  it("selects the newly launched run for the graph hook and context strip", () => {
    renderWithProviders(<WorkflowDetail />);

    const launchProps = workflowLaunchDialogMock.component.mock.calls[0]?.[0];
    expect(launchProps?.onLaunched).toBeTypeOf("function");

    act(() => {
      launchProps?.onLaunched?.({ runId: "run-2" });
    });

    expect(hooksMock.useWorkflowRunGraph.mock.lastCall?.[0]).toEqual({
      workflowId: "workflow-1",
      runId: "run-2",
    });
    expect(
      workflowRunContextStripMock.component.mock.lastCall?.[0],
    ).toMatchObject({
      selectedRunId: "run-2",
    });
  });
});
