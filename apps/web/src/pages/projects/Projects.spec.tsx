import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Projects } from "./Projects";

vi.mock("@/hooks/useProjects", () => ({
  useProjectList: () => ({
    data: [
      {
        id: "project-1",
        name: "Projects Timestamp Regression",
        updated_at: "not-a-date",
        created_at: "2026-03-24T12:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useProjectOrchestrationSummaries", () => ({
  useProjectOrchestrationSummaries: () => ({
    orchestrationByProjectId: new Map(),
    isLoading: false,
  }),
}));

describe("Projects", () => {
  it("renders fallback copy when project timestamps are invalid", () => {
    expect(() =>
      render(
        <MemoryRouter>
          <Projects />
        </MemoryRouter>,
      ),
    ).not.toThrow();

    expect(screen.getByText("Projects Timestamp Regression")).toBeTruthy();
    expect(screen.getByText("Updated recently")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Board/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Sessions/i })).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /Orchestration/i }).length,
    ).toBeGreaterThan(0);
  });
});
