import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTab } from "./MemoryTab";

const projectMemoryHookMock = vi.hoisted(() => ({
  useProjectMemorySegments: vi.fn(),
}));

vi.mock("@/hooks/useProjectMemory", () => projectMemoryHookMock);

describe("MemoryTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders paginated memory rows", () => {
    projectMemoryHookMock.useProjectMemorySegments.mockReturnValue({
      data: {
        items: [
          {
            id: "segment-1",
            memory_type: "fact",
            version: 2,
            content: "Keep deterministic tests in regression paths.",
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

    render(<MemoryTab projectId="project-1" />);

    expect(screen.getByText("Project Memory")).toBeTruthy();
    expect(
      screen.getByText("Keep deterministic tests in regression paths."),
    ).toBeTruthy();
    expect(screen.getByText("Showing 1-1 of 1")).toBeTruthy();
  });

  it("shows empty state when no memory segments are returned", () => {
    projectMemoryHookMock.useProjectMemorySegments.mockReturnValue({
      data: {
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      isError: false,
    });

    render(<MemoryTab projectId="project-1" />);

    expect(
      screen.getByText("No project memory segments are available yet."),
    ).toBeTruthy();
  });

  it("updates query input and triggers search", () => {
    projectMemoryHookMock.useProjectMemorySegments.mockReturnValue({
      data: {
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      isError: false,
    });

    render(<MemoryTab projectId="project-1" />);

    const searchInput = screen.getByLabelText("Search memory");
    fireEvent.change(searchInput, {
      target: { value: "deterministic" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      projectMemoryHookMock.useProjectMemorySegments,
    ).toHaveBeenLastCalledWith(
      "project-1",
      expect.objectContaining({
        query: "deterministic",
      }),
    );
  });
});
