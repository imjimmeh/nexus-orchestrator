import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PromotedLessonsCard } from "./PromotedLessonsCard";
import type {
  PromotedLesson,
  PromotedLessonsResponse,
  SkillBindingUsage,
} from "@/lib/api/self-improvement.types";

function buildSnapshot(
  promoted: PromotedLesson[] = [],
): PromotedLessonsResponse {
  const bindings: SkillBindingUsage[] = [];
  return { promoted, bindings };
}

function renderCard(
  snapshot: PromotedLessonsResponse | undefined,
  isLoading?: boolean,
) {
  return render(
    <MemoryRouter>
      <PromotedLessonsCard snapshot={snapshot} isLoading={isLoading} />
    </MemoryRouter>,
  );
}

describe("PromotedLessonsCard", () => {
  it("renders the card-level loading placeholder when no snapshot is provided", () => {
    renderCard(undefined);

    expect(screen.getByText("Promoted Lessons")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders the empty state when the promoted array is empty", () => {
    renderCard(buildSnapshot());

    expect(screen.getByText("Promoted Lessons")).toBeTruthy();
    expect(screen.getByText("No promoted lessons in last 7 days")).toBeTruthy();
  });

  it("renders one row per promoted lesson with confidence badge and ISO timestamp", () => {
    const lesson: PromotedLesson = {
      id: "lesson-1",
      sourceSignalId: "signal-group-1",
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.88,
      workflowSkillBindingIds: ["binding-a", "binding-b"],
    };
    renderCard(buildSnapshot([lesson]));

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(1);

    const [row] = items as [HTMLElement];
    expect(within(row).getByText("lesson-1")).toBeTruthy();
    expect(within(row).getByText("confidence 0.88")).toBeTruthy();
    expect(within(row).getByText("2026-07-01T12:00:00.000Z")).toBeTruthy();
    expect(within(row).getByText("binding-a, binding-b")).toBeTruthy();
  });

  it("renders a Link to /runtime-feedback/diagnostics when sourceSignalId is non-null", () => {
    const lesson: PromotedLesson = {
      id: "lesson-1",
      sourceSignalId: "signal-group-1",
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.91,
      workflowSkillBindingIds: [],
    };
    renderCard(buildSnapshot([lesson]));

    const link = screen.getByRole("link", { name: "signal-group-1" });
    expect(link.getAttribute("href")).toBe(
      "/runtime-feedback/diagnostics?signalGroupId=signal-group-1",
    );
  });

  it("does not render a Link to /runtime-feedback/diagnostics when sourceSignalId is null", () => {
    const lesson: PromotedLesson = {
      id: "lesson-1",
      sourceSignalId: null,
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.91,
      workflowSkillBindingIds: [],
    };
    renderCard(buildSnapshot([lesson]));

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("uncorrelated")).toBeTruthy();
  });

  it("applies the destructive variant when confidence is below 0.5", () => {
    const lesson: PromotedLesson = {
      id: "lesson-1",
      sourceSignalId: null,
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.3,
      workflowSkillBindingIds: [],
    };
    renderCard(buildSnapshot([lesson]));

    const badge = screen.getByText("confidence 0.30");
    expect(badge.className).toContain("bg-destructive");
  });

  it("applies the success variant when confidence is at or above 0.8", () => {
    const lesson: PromotedLesson = {
      id: "lesson-1",
      sourceSignalId: null,
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.95,
      workflowSkillBindingIds: [],
    };
    renderCard(buildSnapshot([lesson]));

    const badge = screen.getByText("confidence 0.95");
    expect(badge.className).toContain("bg-success/15");
  });

  it("renders multiple rows when the snapshot carries several lessons", () => {
    const lessons: PromotedLesson[] = [
      {
        id: "lesson-1",
        sourceSignalId: "signal-1",
        promotedAt: "2026-07-02T00:00:00.000Z",
        confidence: 0.9,
        workflowSkillBindingIds: [],
      },
      {
        id: "lesson-2",
        sourceSignalId: null,
        promotedAt: "2026-07-01T00:00:00.000Z",
        confidence: 0.6,
        workflowSkillBindingIds: [],
      },
    ];
    renderCard(buildSnapshot(lessons));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });
});
