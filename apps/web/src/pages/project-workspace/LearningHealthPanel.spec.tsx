import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LearningHealthPanel } from "./LearningHealthPanel";
import type {
  MemoryMetricsLearningLiftSnapshot,
  MemoryMetricsLearningMetrics,
} from "@/lib/api/memory.types";

const LIFT_SNAPSHOT: MemoryMetricsLearningLiftSnapshot = {
  lift: 0.2,
  injected: { ratio: 0.8, runs: 10, successes: 8 },
  holdout: { ratio: 0.6, runs: 5, successes: 3 },
  window_days: 30,
  computed_at: "2026-06-26T10:00:00.000Z",
};

const FULL_LEARNING: MemoryMetricsLearningMetrics = {
  promoted_total: 12,
  last_promoted: null,
  lesson_injected_total: 8,
  last_lesson_injected: null,
  run_outcome_after_lesson_total: 6,
  last_run_outcome_after_lesson: null,
  convergence: {
    "project-alpha": {
      ratio: 0.6,
      window_days: 30,
      runs_after_lesson: 5,
      successes_after_lesson: 3,
      computed_at: "2026-06-26T10:00:00.000Z",
    },
  },
  behaviour_change: {
    changed_total: 3,
    unchanged_total: 1,
    last: null,
  },
  lift: {
    "project-alpha": LIFT_SNAPSHOT,
  },
  cost_per_promoted_memory: 12.5,
  suppressed_noise_count: 7,
  probation: {
    confirmed_total: 5,
    reverted_total: 2,
    held_total: 4,
    last_pass: null,
  },
};

const MINIMAL_LEARNING: MemoryMetricsLearningMetrics = {
  promoted_total: 0,
  last_promoted: null,
  lesson_injected_total: 0,
  last_lesson_injected: null,
  run_outcome_after_lesson_total: 0,
  last_run_outcome_after_lesson: null,
  convergence: {},
};

describe("LearningHealthPanel", () => {
  it("renders every learning-health tile from a full metrics payload", () => {
    render(<LearningHealthPanel learning={FULL_LEARNING} />);

    // Convergence ratio per scope (scope label also appears in the lift section).
    expect(screen.getAllByText("project-alpha").length).toBeGreaterThan(0);
    expect(screen.getByText("0.60")).toBeTruthy();

    // Behaviour-change rate: changed / (changed + unchanged) = 3/4.
    expect(screen.getByText("Behaviour change")).toBeTruthy();
    expect(screen.getByText("75.0%")).toBeTruthy();

    // Holdout lift per scope.
    expect(screen.getByText("Holdout lift")).toBeTruthy();
    expect(screen.getByText("0.20")).toBeTruthy();

    // Cost-per-promoted-memory.
    expect(screen.getByText("Cost per promoted memory")).toBeTruthy();
    expect(screen.getByText(/12\.50/)).toBeTruthy();

    // Suppressed-noise count.
    expect(screen.getByText("Suppressed noise")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();

    // Probation tiles.
    expect(screen.getByText("Probation")).toBeTruthy();
    expect(screen.getByText("Confirmed").nextSibling?.textContent).toContain(
      "5",
    );
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("renders the holdout-disabled empty state when lift is empty", () => {
    render(<LearningHealthPanel learning={{ ...FULL_LEARNING, lift: {} }} />);

    expect(screen.getByText(/enable holdout to measure/i)).toBeTruthy();
  });

  it("renders the holdout-disabled empty state when a scope lift is null", () => {
    render(
      <LearningHealthPanel
        learning={{
          ...FULL_LEARNING,
          lift: {
            "project-alpha": { ...LIFT_SNAPSHOT, lift: null },
          },
        }}
      />,
    );

    expect(screen.getByText(/enable holdout to measure/i)).toBeTruthy();
  });

  it("renders the no-spend-data empty state when cost is null", () => {
    render(
      <LearningHealthPanel
        learning={{ ...FULL_LEARNING, cost_per_promoted_memory: null }}
      />,
    );

    expect(screen.getByText(/no spend data/i)).toBeTruthy();
  });

  it("renders without crashing for a minimal payload missing the new fields", () => {
    render(<LearningHealthPanel learning={MINIMAL_LEARNING} />);

    expect(screen.getByText(/learning health/i)).toBeTruthy();
    // Behaviour-change empty state at zero observations.
    expect(screen.getByText(/no observations yet/i)).toBeTruthy();
  });

  it("renders without crashing when no learning block is supplied", () => {
    render(<LearningHealthPanel learning={undefined} />);

    expect(screen.getByText(/learning health/i)).toBeTruthy();
  });
});
