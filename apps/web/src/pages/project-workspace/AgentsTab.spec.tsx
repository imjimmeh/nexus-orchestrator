import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentsTab } from "./AgentsTab";

const apiMock = vi.hoisted(() => ({
  getProjectAgentsFile: vi.fn(),
  updateProjectAgentsFile: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/api/client", () => ({ api: apiMock }));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => toastMock,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("AgentsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMock.getProjectAgentsFile.mockResolvedValue({
      projectId: "project-1",
      path: "AGENTS.md",
      exists: true,
      content: "# Existing instructions",
      etag: "etag-1",
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    apiMock.updateProjectAgentsFile.mockResolvedValue({
      projectId: "project-1",
      path: "AGENTS.md",
      exists: true,
      content: "# Updated instructions",
      etag: "etag-2",
      updatedAt: "2026-04-11T00:05:00.000Z",
    });
  });

  it("loads AGENTS.md and saves with optimistic expected etag", async () => {
    const Wrapper = createWrapper();
    render(<AgentsTab projectId="project-1" />, { wrapper: Wrapper });

    const editor = await screen.findByLabelText("AGENTS.md");
    expect((editor as HTMLTextAreaElement).value).toBe(
      "# Existing instructions",
    );

    fireEvent.change(editor, {
      target: { value: "# Updated instructions" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save AGENTS.md" }));

    await waitFor(() => {
      expect(apiMock.updateProjectAgentsFile).toHaveBeenCalledWith(
        "project-1",
        {
          content: "# Updated instructions",
          expectedEtag: "etag-1",
        },
      );
    });

    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows conflict guidance when save fails with etag conflict", async () => {
    apiMock.updateProjectAgentsFile.mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 409",
      response: {
        status: 409,
        data: {
          error: {
            message:
              "AGENTS.md has changed since it was last read. Reload and retry.",
          },
        },
      },
    });

    const Wrapper = createWrapper();
    render(<AgentsTab projectId="project-1" />, { wrapper: Wrapper });

    const editor = await screen.findByLabelText("AGENTS.md");
    fireEvent.change(editor, {
      target: { value: "# Local edits" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save AGENTS.md" }));

    expect(
      await screen.findByText(
        "AGENTS.md has changed since it was last read. Reload and retry.",
      ),
    ).toBeTruthy();
    expect(toastMock.warning).toHaveBeenCalled();
  });
});
