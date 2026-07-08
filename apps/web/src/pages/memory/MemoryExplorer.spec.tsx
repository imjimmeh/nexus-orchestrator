import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MemoryExplorer } from "./MemoryExplorer";

const memoryExplorerHookMock = vi.hoisted(() => ({
  useChatMemoryObservability: vi.fn(),
  useUserMemorySegments: vi.fn(),
  useSystemMemorySegments: vi.fn(),
  useChatMemorySegments: vi.fn(),
}));

const usersApiMock = vi.hoisted(() => ({
  usersApi: {
    getUsers: vi.fn(),
  },
}));

const useAuthMock = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("@/hooks/useMemoryExplorer", () => memoryExplorerHookMock);
vi.mock("@/lib/api/users", () => usersApiMock);
vi.mock("@/hooks/useAuth", () => useAuthMock);

function renderMemoryExplorer(initialScope?: "users" | "system" | "chat") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MemoryExplorer initialScope={initialScope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MemoryExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useAuthMock.useAuth.mockReturnValue({
      isAdmin: () => true,
      user: {
        id: "admin-1",
        username: "admin",
        email: "admin@example.com",
        roles: ["admin"],
      },
    });

    usersApiMock.usersApi.getUsers.mockResolvedValue({
      data: [
        {
          id: "user-1",
          username: "alice",
          email: "alice@example.com",
        },
      ],
      meta: {
        total: 1,
        totalPages: 1,
      },
    });

    memoryExplorerHookMock.useUserMemorySegments.mockReturnValue({
      data: {
        items: [
          {
            id: "segment-1",
            entity_type: "User",
            entity_id: "user-1",
            memory_type: "fact",
            version: 1,
            content: "Alice prefers deterministic test runs.",
            created_at: "2026-04-16T00:00:00.000Z",
            updated_at: "2026-04-16T00:05:00.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      isError: false,
    });

    memoryExplorerHookMock.useSystemMemorySegments.mockReturnValue({
      data: {
        items: [
          {
            id: "segment-2",
            entity_type: "System",
            entity_id: "shared",
            memory_type: "history",
            version: 2,
            content: "Use shared runbooks for compose validation.",
            created_at: "2026-04-16T01:00:00.000Z",
            updated_at: "2026-04-16T01:05:00.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      isError: false,
    });

    memoryExplorerHookMock.useChatMemorySegments.mockReturnValue({
      data: {
        source: "profile",
        items: [
          {
            id: "chat-segment-1",
            source: "profile",
            profile_id: "profile-1",
            chat_session_id: "chat-1",
            memory_type: "fact",
            content: "User prefers focused, deterministic run summaries.",
            confidence_score: 82,
            importance_score: null,
            distilled_at: null,
            archived_at: null,
            created_at: "2026-04-16T02:00:00.000Z",
            updated_at: "2026-04-16T02:05:00.000Z",
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      isError: false,
    });

    memoryExplorerHookMock.useChatMemoryObservability.mockReturnValue({
      data: {
        counts: {
          jobs: {
            pending: 1,
            running: 0,
            completed: 8,
            failed: 0,
          },
          events: {
            promoted: 6,
            updated: 3,
          },
        },
        recent_failed_jobs: [],
        recent_events: [],
      },
      isLoading: false,
      isError: false,
    });
  });

  it("renders the system memory tab content", () => {
    renderMemoryExplorer("system");

    expect(
      screen.getByText("Use shared runbooks for compose validation."),
    ).toBeTruthy();
  });

  it("renders the chat memory tab content", () => {
    renderMemoryExplorer("chat");

    expect(screen.getByText(/deterministic run summaries/i)).toBeTruthy();
  });

  it("prompts for a user selection before showing user memory", async () => {
    renderMemoryExplorer();

    await waitFor(() => {
      expect(
        screen.getByText("Select a user to load their memory segments."),
      ).toBeTruthy();
    });
  });

  it("submits system search terms through the hook inputs", () => {
    renderMemoryExplorer("system");

    fireEvent.change(screen.getByLabelText("Search memory"), {
      target: { value: "compose" },
    });
    fireEvent.change(screen.getByLabelText("System entity id filter"), {
      target: { value: "shared" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      memoryExplorerHookMock.useSystemMemorySegments,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        entity_id: "shared",
        query: "compose",
      }),
    );
  });

  it("shows only the current user memory for non-admin users", () => {
    useAuthMock.useAuth.mockReturnValue({
      isAdmin: () => false,
      user: {
        id: "user-1",
        username: "alice",
        email: "alice@example.com",
        roles: ["user"],
      },
    });

    renderMemoryExplorer();

    expect(screen.getByText("My Memory")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "System Memory" })).toBeNull();
    expect(screen.queryByLabelText("User selector")).toBeNull();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName.toLowerCase() === "p" &&
          (element.textContent?.includes("Viewing memory for alice.") ?? false),
      ),
    ).toBeTruthy();
    expect(
      memoryExplorerHookMock.useUserMemorySegments,
    ).toHaveBeenLastCalledWith(
      "user-1",
      expect.objectContaining({
        limit: 25,
        offset: 0,
      }),
    );
    expect(usersApiMock.usersApi.getUsers).not.toHaveBeenCalled();
  });
});
