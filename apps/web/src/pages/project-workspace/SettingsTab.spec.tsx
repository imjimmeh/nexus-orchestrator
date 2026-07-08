import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsTab } from "./SettingsTab";

const navigateMock = vi.hoisted(() => vi.fn());
const useProjectMock = vi.hoisted(() => vi.fn());
const useDeleteProjectMock = vi.hoisted(() => vi.fn());
const useSecretsMock = vi.hoisted(() => vi.fn());
const apiMock = vi.hoisted(() => ({
  updateProject: vi.fn(),
  getEventLedger: vi.fn(),
  getProjectRepositoryWorkflowSettings: vi.fn(),
  updateProjectRepositoryWorkflowSettings: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );

  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useProjects", () => ({
  useProject: (...args: unknown[]) => useProjectMock(...args),
  useDeleteProject: () => useDeleteProjectMock(),
}));

vi.mock("@/hooks/useSecrets", () => ({
  useSecrets: () => useSecretsMock(),
}));

vi.mock("@/lib/api/client", () => ({
  api: apiMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe("SettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();

    useProjectMock.mockReturnValue({
      data: {
        id: "project-1",
        name: "Nexus",
        description: "Project settings",
        repositoryUrl: "https://github.com/example/repo",
        basePath: "/repo",
        githubSecretId: "secret-1",
        created_at: "2026-04-23T00:00:00.000Z",
        updated_at: "2026-04-23T00:00:00.000Z",
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useDeleteProjectMock.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
    useSecretsMock.mockReturnValue({
      data: [
        {
          id: "secret-1",
          name: "GitHub PAT",
          metadata: {},
          created_at: "2026-04-23T00:00:00.000Z",
          updated_at: "2026-04-23T00:00:00.000Z",
        },
      ],
      isError: false,
    });
    apiMock.updateProject.mockResolvedValue({ id: "project-1" });
    apiMock.getEventLedger.mockResolvedValue({
      data: [
        {
          id: "evt-1",
          domain: "git",
          event_name: "git.branch.push.succeeded",
          outcome: "success",
          severity: "info",
          source: "api",
          project_id: "project-1",
          payload: { branchName: "main" },
          occurred_at: "2026-04-23T10:00:00.000Z",
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
    });
    apiMock.getProjectRepositoryWorkflowSettings.mockResolvedValue({
      enabled: true,
      overrides: {
        "wf-1": { enabled: true },
        "wf-2": { enabled: false },
      },
    });
    apiMock.updateProjectRepositoryWorkflowSettings.mockResolvedValue({
      enabled: false,
      overrides: {
        "wf-1": { enabled: true },
        "wf-2": { enabled: false },
      },
    });
  });

  it("loads project settings, preserves linked secret, and shows git activity", async () => {
    const Wrapper = createWrapper();

    render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

    expect(screen.getByDisplayValue("Nexus")).toBeTruthy();
    expect(
      screen.getByDisplayValue("https://github.com/example/repo"),
    ).toBeTruthy();
    expect(screen.getByText("GitHub PAT")).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("git.branch.push.succeeded")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(apiMock.updateProject).toHaveBeenCalledWith("project-1", {
        name: "Nexus",
        description: "Project settings",
        repositoryUrl: "https://github.com/example/repo",
        basePath: "/repo",
        githubSecretId: "secret-1",
      });
    });
  });

  it("sends a blank GitHub auth secret when unlinking an existing secret", async () => {
    const Wrapper = createWrapper();

    render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByText("No secret selected"));
    fireEvent.click(screen.getByRole("button", { name: "Save Settings" }));

    await waitFor(() => {
      expect(apiMock.updateProject).toHaveBeenCalledWith("project-1", {
        name: "Nexus",
        description: "Project settings",
        repositoryUrl: "https://github.com/example/repo",
        basePath: "/repo",
        githubSecretId: "",
      });
    });
  });

  it("renders a project load error instead of blank fields", () => {
    const refetchMock = vi.fn();
    const Wrapper = createWrapper();

    useProjectMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
    });

    render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

    expect(screen.getByText(/Failed to load project settings/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  describe("Repository Workflow Settings", () => {
    it("renders the Enable Repository Workflows toggle", async () => {
      const Wrapper = createWrapper();

      render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(screen.getByText("Enable Repository Workflows")).toBeTruthy();
      });
      expect(
        screen.getByRole("switch", { name: /Repository Workflows/i }),
      ).toBeTruthy();
    });

    it("fetches settings and populates the toggle on mount", async () => {
      const Wrapper = createWrapper();

      render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          apiMock.getProjectRepositoryWorkflowSettings,
        ).toHaveBeenCalledWith("project-1");
      });

      await waitFor(() => {
        expect(screen.getByText("wf-1")).toBeTruthy();
        expect(screen.getByText("wf-2")).toBeTruthy();
      });
    });

    it("calls updateProjectRepositoryWorkflowSettings when the global toggle is clicked", async () => {
      const Wrapper = createWrapper();

      render(<SettingsTab projectId="project-1" />, { wrapper: Wrapper });

      await waitFor(() => {
        expect(
          screen.getByRole("switch", { name: /Repository Workflows/i }),
        ).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("switch", { name: /Repository Workflows/i }),
      );

      await waitFor(() => {
        expect(
          apiMock.updateProjectRepositoryWorkflowSettings,
        ).toHaveBeenCalledWith("project-1", { enabled: false });
      });
    });
  });
});
