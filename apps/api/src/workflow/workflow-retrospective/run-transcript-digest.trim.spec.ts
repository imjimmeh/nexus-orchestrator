import { describe, expect, it } from 'vitest';
import type { DigestTimelineEntry } from './run-transcript-digest.types';
import {
  selectTimelineWithinBudget,
  timelineEntrySignal,
} from './run-transcript-digest.trim';

/** Measure = one token per entry, so a numeric budget caps the entry count. */
const countMeasure = (kept: DigestTimelineEntry[]): number => kept.length;

describe('run-transcript-digest trim policy', () => {
  it('keeps everything when already within budget', () => {
    const entries = [success('a'), failure('b', 'E1')];
    const result = selectTimelineWithinBudget(
      entries,
      new Set<string>(),
      10,
      countMeasure,
    );
    expect(result.droppedCount).toBe(0);
    expect(result.kept).toBe(entries);
  });

  it('drops lowest-signal entries first and keeps anchored/protected entries', () => {
    // 2 plain successes (low), 1 un-anchored failure (mid), 1 anchored failure
    // (high). Budget = 2 entries; the anchored failure is also protected.
    const anchored = failure('anchored', 'TS2307');
    const entries = [
      success('ok-old'),
      success('ok-new'),
      failure('fail-bare', undefined),
      anchored,
    ];
    const result = selectTimelineWithinBudget(
      entries,
      new Set<string>(['anchored']),
      2,
      countMeasure,
    );

    const keptIds = result.kept.map((entry) => entry.eventId);
    expect(keptIds).toContain('anchored');
    expect(result.droppedCount).toBe(2);
    // The two plain successes are dropped before the un-anchored failure.
    expect(keptIds).not.toContain('ok-old');
    expect(keptIds).not.toContain('ok-new');
    expect(keptIds).toContain('fail-bare');
    // Kept entries preserve chronological order.
    expect(keptIds).toEqual(['fail-bare', 'anchored']);
  });

  it('never drops a protected entry even when the budget cannot be met', () => {
    const entries = [success('p1'), success('p2')];
    const result = selectTimelineWithinBudget(
      entries,
      new Set<string>(['p1', 'p2']),
      0,
      countMeasure,
    );
    expect(result.kept.map((entry) => entry.eventId)).toEqual(['p1', 'p2']);
    expect(result.droppedCount).toBe(0);
  });

  it('ranks anchored failure above failure above other', () => {
    expect(timelineEntrySignal(failure('x', 'CODE'))).toBeGreaterThan(
      timelineEntrySignal(failure('y', undefined)),
    );
    expect(timelineEntrySignal(failure('y', undefined))).toBeGreaterThan(
      timelineEntrySignal(success('z')),
    );
  });

  // ── Regression: the 2026-06-29 event-loop wedge ───────────────────────────
  // The original linear drop loop called `measure` once per dropped entry —
  // O(n) tiktoken encodings over a large blob — which pegged the event loop for
  // minutes. The trim must now resolve the drop count in O(log n) measure calls.
  it('resolves the drop count in O(log n) measure calls (no per-entry rescan)', () => {
    const entries = Array.from({ length: 1024 }, (_, i) => success(`e${i}`));
    let calls = 0;
    const measure = (kept: DigestTimelineEntry[]): number => {
      calls += 1;
      return kept.length; // 1 token per entry
    };
    const budget = 4; // force dropping all but 4

    const result = selectTimelineWithinBudget(
      entries,
      new Set<string>(),
      budget,
      measure,
    );

    expect(result.kept.length).toBeLessThanOrEqual(budget);
    expect(result.droppedCount).toBe(entries.length - result.kept.length);
    // log2(1024) === 10; allow generous headroom but far below the old ~1020.
    expect(calls).toBeLessThanOrEqual(20);
  });

  it('drops exactly the minimal lowest-signal prefix (binary-search parity)', () => {
    // 6 entries, budget 3 → must drop the 3 lowest-signal (oldest successes).
    const entries = [
      success('s0'),
      success('s1'),
      success('s2'),
      failure('f3', undefined),
      failure('f4', 'E'),
      failure('f5', 'E'),
    ];
    const result = selectTimelineWithinBudget(
      entries,
      new Set<string>(),
      3,
      (kept) => kept.length,
    );
    expect(result.droppedCount).toBe(3);
    expect(result.kept.map((e) => e.eventId)).toEqual(['f3', 'f4', 'f5']);
  });
});

function success(eventId: string): DigestTimelineEntry {
  return { eventId, tool: 'read', outcome: 'success', summary: 's' };
}

function failure(eventId: string, errorCode?: string): DigestTimelineEntry {
  return {
    eventId,
    tool: 'run_command',
    outcome: 'failure',
    errorCode,
    summary: 's',
  };
}
