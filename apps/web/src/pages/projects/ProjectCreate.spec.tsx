import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectCreate } from "./ProjectCreate";

const navigateMock = vi.hoisted(() => vi.fn());
const apiMock = vi.hoisted(() => ({
  createProject: vi.fn(),
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

vi.mock("@/hooks/useSecrets", () => ({
  useSecrets: () => ({ data: [] }),
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

describe("ProjectCreate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.createProject.mockResolvedValue({ id: "project-1" });
  });

  it("sends initial goals when creating a project", async () => {
    const Wrapper = createWrapper();

    render(<ProjectCreate />, { wrapper: Wrapper });

    fireEvent.change(screen.getByPlaceholderText("Project name"), {
      target: { value: "Goals Project" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));

    fireEvent.change(screen.getByPlaceholderText("Goal title"), {
      target: { value: "Ship project goal manager" },
    });

    fireEvent.change(screen.getByPlaceholderText("Describe expected outcome"), {
      target: { value: "Users can maintain goals from a dedicated tab" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    await waitFor(() => {
      expect(apiMock.createProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Goals Project",
          goals: [
            expect.objectContaining({
              title: "Ship project goal manager",
              description: "Users can maintain goals from a dedicated tab",
            }),
          ],
        }),
      );
    });

    expect(navigateMock).toHaveBeenCalledWith("/projects/project-1");
  });

  it("shows the git auth secret field for the import_remote source type", async () => {
    const Wrapper = createWrapper();

    render(<ProjectCreate />, { wrapper: Wrapper });

    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText(/Import from remote repository/i));
    await waitFor(() =>
      expect(screen.getByText("Git Auth Secret (optional)")).toBeTruthy(),
    );
    expect(screen.getByText("No secret selected")).toBeTruthy();
  });
});
