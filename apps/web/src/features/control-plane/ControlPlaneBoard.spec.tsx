import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ControlPlaneBoard } from "./ControlPlaneBoard";
import type { ControlPlaneBoardResponse } from "./controlPlane.types";
import type { MemoryMetricsResponse } from "@/lib/api/memory.types";
import type {
  PromotedLesson,
  PromotedLessonsResponse,
  SkillBindingUsage,
} from "@/lib/api/self-improvement.types";

const memoryMetricsMock = vi.hoisted(() => ({
  useMemoryMetrics: vi.fn(),
}));

const promotedLessonsMock = vi.hoisted(() => ({
  usePromotedLessons: vi.fn(),
}));

vi.mock("@/hooks/useMemoryMetrics", () => memoryMetricsMock);
vi.mock("@/hooks/usePromotedLessons", () => promotedLessonsMock);

function renderBoard(board: ControlPlaneBoardResponse) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ControlPlaneBoard board={board} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function buildMetricsSnapshot(): MemoryMetricsResponse {
  return {
    backend: {
      read: {
        total: { postgres: 12, honcho: 4 },
        latency_ms: {
          postgres: { count: 12, sum: 240, p50: 18, p95: 42, p99: 55 },
          honcho: { count: 4, sum: 96 },
        },
      },
      write: {
        total: {
          postgres: { success: 9, failure: 1 },
          honcho: { success: 2, failure: 0 },
        },
      },
      active_segments: {
        total: {
          postgres: { user: 3, system: 1 },
          honcho: { profile: 2 },
        },
      },
      fallback: { "postgres->honcho:read": 1 },
    },
    distillation: {
      completed_total: { success: 5, failure: 1 },
      last: {
        input_segment_count: 14,
        output_segment_count: 5,
        compression_ratio: 0.36,
        tokens_before: 4200,
        tokens_after: 1500,
        model: "claude-3-5-sonnet",
        duration_ms: 812,
        completed_at: "2026-06-15T12:00:00.000Z",
      },
    },
    learning: {
      promoted_total: 7,
      last_promoted: {
        candidate_id: "candidate-42",
        confidence: 0.91,
        scope: "memory:profile-1",
        source_decision_id: "decision-7",
        promoted_at: "2026-06-15T12:05:00.000Z",
      },
      lesson_injected_total: 0,
      last_lesson_injected: null,
      run_outcome_after_lesson_total: 0,
      last_run_outcome_after_lesson: null,
      convergence: {},
    },
    generated_at: "2026-06-15T12:10:00.000Z",
  };
}

function buildPromotedSnapshot(): PromotedLessonsResponse {
  const promoted: PromotedLesson[] = [
    {
      id: "lesson-1",
      sourceSignalId: "signal-1",
      promotedAt: "2026-07-01T12:00:00.000Z",
      confidence: 0.9,
      workflowSkillBindingIds: ["binding-a"],
    },
  ];
  const bindings: SkillBindingUsage[] = [
    {
      id: "binding-a",
      mostSpecificSource: "step",
      reuseCount7d: 2,
      workflowStepIds: ["step-1"],
    },
  ];
  return { promoted, bindings };
}

describe("ControlPlaneBoard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMetricsMock.useMemoryMetrics.mockReturnValue({
      data: buildMetricsSnapshot(),
      isLoading: false,
      isError: false,
    });
    promotedLessonsMock.usePromotedLessons.mockReturnValue({
      data: buildPromotedSnapshot(),
      isLoading: false,
      isError: false,
    });
  });

  it("renders active, pending, and blocked lane counts", () => {
    renderBoard(buildBoard());

    expect(screen.getByText("Control Plane")).toBeTruthy();
    expect(screen.getByText("dispatch")).toBeTruthy();
    expect(screen.getByText("0 active · 0 pending · 1 blocked")).toBeTruthy();
    expect(screen.getByText("repair")).toBeTruthy();
    expect(screen.getByText("1 active · 1 pending · 0 blocked")).toBeTruthy();
  });

  it("renders intent details and latest no-launch decision reason", () => {
    renderBoard(buildBoard());

    expect(screen.getByText("dispatch_candidates")).toBeTruthy();
    expect(screen.getByText("Status: blocked · Priority: 10")).toBeTruthy();
    expect(screen.getByText("dispatch is blocked")).toBeTruthy();
    expect(
      screen.getByText("Latest decision: conflict_key_active"),
    ).toBeTruthy();
    expect(screen.getByText("repair_failed_run")).toBeTruthy();
  });

  it("renders fact, no-launch, and stale-link summaries", () => {
    renderBoard(buildBoard());

    expect(screen.getByText("Facts: 2")).toBeTruthy();
    expect(screen.getByText("No-launch reasons: 1")).toBeTruthy();
    expect(screen.getByText("Stale links: 1")).toBeTruthy();
    expect(screen.getByText("event_delivery_failed")).toBeTruthy();
    expect(screen.getByText("stale_link_detected")).toBeTruthy();
  });

  it("renders the Memory Health card when the metrics hook returns a snapshot", () => {
    renderBoard(buildBoard());

    expect(screen.getByText("Memory Health")).toBeTruthy();
    expect(
      screen.getByText(
        "Per-backend memory observability counters and distillation outcome metrics.",
      ),
    ).toBeTruthy();
  });

  it("renders the Memory Health card loading placeholder when the hook has no data yet", () => {
    memoryMetricsMock.useMemoryMetrics.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderBoard(buildBoard());

    expect(screen.getByText("Memory Health")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders the Promoted Lessons + Skill Binding Usage cards when the hook returns a snapshot", () => {
    renderBoard(buildBoard());

    expect(screen.getByText("Promoted Lessons")).toBeTruthy();
    expect(screen.getByText("Skill Binding Usage")).toBeTruthy();
    // Promoted lesson row surfaces the lesson id and the signal-group link.
    expect(screen.getByText("lesson-1")).toBeTruthy();
    const link = screen.getByRole("link", { name: "signal-1" });
    expect(link.getAttribute("href")).toBe(
      "/runtime-feedback/diagnostics?signalGroupId=signal-1",
    );
    // Skill binding row surfaces the source badge for the binding.
    const stepBadges = screen.getAllByText("step");
    expect(stepBadges.length).toBeGreaterThan(0);
  });

  it("renders the Promoted Lessons + Skill Binding Usage loading placeholders when the hook has no data yet", () => {
    promotedLessonsMock.usePromotedLessons.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderBoard(buildBoard());

    // Card-level titles are still visible.
    expect(screen.getByText("Promoted Lessons")).toBeTruthy();
    expect(screen.getByText("Skill Binding Usage")).toBeTruthy();
    // Both cards render a Loading… placeholder on initial fetch.
    const loadingPlaceholders = screen.getAllByText("Loading…");
    expect(loadingPlaceholders.length).toBeGreaterThanOrEqual(2);
  });
});

function buildBoard(): ControlPlaneBoardResponse {
  return {
    projectId: "project-1",
    generatedAt: "2026-05-18T20:00:00.000Z",
    lanes: [
      {
        lane: "dispatch",
        activeCount: 0,
        pendingCount: 0,
        blockedCount: 1,
        intents: [
          {
            id: "intent-dispatch",
            lane: "dispatch",
            type: "dispatch_candidates",
            status: "blocked",
            priority: 10,
            reason: "dispatch is blocked",
            workflowId: "dispatch_candidates",
            workflowScope: "project-1",
            conflictKeys: [
              { kind: "workflow_scope", value: "dispatch:project" },
            ],
            latestOutcome: {
              id: "outcome-1",
              status: "blocked",
              reason: "conflict_key_active",
              activeConflicts: [
                { kind: "workflow_scope", value: "dispatch:project" },
              ],
              evaluatedAt: "2026-05-18T20:01:00.000Z",
            },
            launchAttempts: [],
            createdAt: "2026-05-18T20:00:00.000Z",
            updatedAt: "2026-05-18T20:00:00.000Z",
          },
        ],
      },
      {
        lane: "repair",
        activeCount: 1,
        pendingCount: 1,
        blockedCount: 0,
        intents: [
          {
            id: "intent-repair",
            lane: "repair",
            type: "repair_failed_run",
            status: "pending",
            priority: 3,
            reason: "repair failed event",
            workflowId: "repair_failed_run",
            workflowScope: "event-1",
            conflictKeys: [],
            latestOutcome: null,
            launchAttempts: [],
            createdAt: "2026-05-18T20:00:00.000Z",
            updatedAt: "2026-05-18T20:00:00.000Z",
          },
        ],
      },
    ],
    facts: [
      {
        id: "fact-event",
        type: "event_delivery_failed",
        subjectKind: "domain_event",
        subjectId: "event-1",
        confidence: 1,
        freshnessStatus: "fresh",
        observedAt: "2026-05-18T20:00:00.000Z",
        expiresAt: null,
      },
      {
        id: "fact-stale",
        type: "stale_link_detected",
        subjectKind: "workflow_run",
        subjectId: "run-1",
        confidence: 1,
        freshnessStatus: "fresh",
        observedAt: "2026-05-18T20:00:00.000Z",
        expiresAt: null,
      },
    ],
    noLaunchReasons: [
      {
        id: "outcome-1",
        status: "blocked",
        reason: "conflict_key_active",
        activeConflicts: [],
        evaluatedAt: "2026-05-18T20:01:00.000Z",
      },
    ],
    staleLinks: [
      {
        id: "fact-stale",
        type: "stale_link_detected",
        subjectKind: "workflow_run",
        subjectId: "run-1",
        confidence: 1,
        freshnessStatus: "fresh",
        observedAt: "2026-05-18T20:00:00.000Z",
        expiresAt: null,
      },
    ],
  };
}
