import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryHealthCard } from "./MemoryHealthCard";
import type { MemoryMetricsResponse } from "@/lib/api/memory.types";

function buildSnapshot(): MemoryMetricsResponse {
  return {
    backend: {
      read: {
        total: { postgres: 0, honcho: 0 },
        latency_ms: {
          postgres: { count: 0, sum: 0 },
          honcho: { count: 0, sum: 0 },
        },
      },
      write: {
        total: {
          postgres: { success: 0, failure: 0 },
          honcho: { success: 0, failure: 0 },
        },
      },
      active_segments: {
        total: { postgres: {}, honcho: {} },
      },
      fallback: {},
    },
    distillation: {
      completed_total: { success: 0, failure: 0 },
      last: null,
    },
    learning: {
      promoted_total: 0,
      last_promoted: null,
      lesson_injected_total: 0,
      last_lesson_injected: null,
      run_outcome_after_lesson_total: 0,
      last_run_outcome_after_lesson: null,
      convergence: {},
    },
    generated_at: "2026-06-15T12:10:00.000Z",
  };
}

describe("MemoryHealthCard", () => {
  it("renders the card-level loading placeholder when no snapshot is provided", () => {
    render(<MemoryHealthCard snapshot={undefined} />);

    expect(screen.getByText("Memory Health")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("renders the Learning convergence section title when a snapshot is provided", () => {
    render(<MemoryHealthCard snapshot={buildSnapshot()} />);

    expect(screen.getByText("Learning convergence")).toBeTruthy();
  });

  it("renders the empty state when the convergence map is empty", () => {
    render(<MemoryHealthCard snapshot={buildSnapshot()} />);

    expect(screen.getByText("No convergence data yet.")).toBeTruthy();
  });

  it("renders the loading indicator inside the section when isLoading is true", () => {
    render(<MemoryHealthCard snapshot={buildSnapshot()} isLoading={true} />);

    expect(screen.getByText("Loading convergence…")).toBeTruthy();
    expect(screen.queryByText("No convergence data yet.")).toBeNull();
  });

  it("renders the per-scope ratio, successes/total, scope name, and window when convergence is populated", () => {
    const snapshot = buildSnapshot();
    snapshot.learning.convergence = {
      "project-x": {
        ratio: 0.8,
        window_days: 7,
        runs_after_lesson: 10,
        successes_after_lesson: 8,
        computed_at: "2026-06-15T12:00:00.000Z",
      },
    };

    render(<MemoryHealthCard snapshot={snapshot} />);

    expect(screen.getByText("project-x")).toBeTruthy();
    // Ratio is formatted to 2 decimal places.
    expect(screen.getByText("0.80")).toBeTruthy();
    // Successes / runs surfaces both numerator and denominator.
    expect(screen.getByText("8 / 10")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("2026-06-15T12:00:00.000Z")).toBeTruthy();
  });

  it("renders multiple scope rows when convergence has more than one entry", () => {
    const snapshot = buildSnapshot();
    snapshot.learning.convergence = {
      "project-x": {
        ratio: 0.8,
        window_days: 7,
        runs_after_lesson: 10,
        successes_after_lesson: 8,
        computed_at: "2026-06-15T12:00:00.000Z",
      },
      "project-y": {
        ratio: 0.5,
        window_days: 7,
        runs_after_lesson: 4,
        successes_after_lesson: 2,
        computed_at: "2026-06-15T12:00:00.000Z",
      },
    };

    render(<MemoryHealthCard snapshot={snapshot} />);

    expect(screen.getByText("project-x")).toBeTruthy();
    expect(screen.getByText("project-y")).toBeTruthy();
    expect(screen.getByText("0.80")).toBeTruthy();
    expect(screen.getByText("0.50")).toBeTruthy();
    expect(screen.getByText("8 / 10")).toBeTruthy();
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });

  it("falls back to the empty state without throwing when the convergence map is empty", () => {
    // Convergence is required by the type system; the empty map
    // `{}` is the "no in-window signal" surface documented on
    // `MemoryMetricsService.computeConvergenceSnapshots`.
    const snapshot = buildSnapshot();
    snapshot.learning.convergence = {};

    render(<MemoryHealthCard snapshot={snapshot} />);

    expect(screen.getByText("No convergence data yet.")).toBeTruthy();
  });
});
