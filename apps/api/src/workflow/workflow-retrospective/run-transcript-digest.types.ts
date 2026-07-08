/**
 * Exported contract for the token-bounded, struggle-anchored run digest
 * (EPIC-212 Phase-2 Task 4).
 *
 * The digest is the deterministic input contract Task 6's analysis
 * orchestrator feeds to the retrospective analyst. It is scope-neutral: no
 * domain-specific identifiers appear in any field — only neutral `scopeId`,
 * tool names, outcomes, error codes, and real `event_ledger` row ids.
 *
 * Every line carries its source `event_id` so downstream findings can cite
 * real `evidenceEventIds` (and fabricated ids can be rejected). The companion
 * service builds these shapes; the pure trim helper operates on
 * {@link DigestTimelineEntry} arrays alone.
 */

/**
 * One tool-execution entry in the digest timeline, tagged with the source
 * `event_ledger` row that produced it. The `summary` is already
 * secret-redacted and NUL-stripped.
 */
export interface DigestTimelineEntry {
  /** Source `event_ledger.id` — the citation anchor for this line. */
  eventId: string;
  /** Tool name (`event_ledger.tool_name`), or `unknown` when absent. */
  tool: string;
  /** Tool-execution outcome (`success` | `failure` | …). */
  outcome: string;
  /** Anchored error code when the row carried one. */
  errorCode?: string;
  /** Redacted, NUL-stripped one-line summary of the call/result. */
  summary: string;
}

/**
 * A cluster of failed tool-executions sharing one tool + error code. Clusters
 * are always preserved through token trimming (anchored, diagnosable signal).
 */
export interface DigestErrorCluster {
  errorCode: string;
  tool: string;
  /** Number of failures in this cluster. */
  count: number;
  /** Source `event_ledger.id`s of every failure in the cluster. */
  evidenceEventIds: string[];
}

/**
 * A struggle span enriched with the source event ids of its failures and the
 * recovering call. The `recoveringSummary` preserves the command that finally
 * worked verbatim (redacted + NUL-stripped) — the most actionable content.
 */
export interface DigestStruggleSpan {
  tool: string;
  errorCodes: string[];
  failureCount: number;
  /** The recovering call, verbatim (redacted + NUL-stripped). */
  recoveringSummary: string;
  /** Source `event_ledger.id`s of the failures + the recovering call. */
  evidenceEventIds: string[];
}

/**
 * The bounded, struggle-anchored, secret-free digest of a single run. A run
 * with no ledger rows yields an empty-but-valid digest; any build error yields
 * a minimal digest with `truncated: true`.
 */
export interface RunDigest {
  runId: string;
  scopeId: string | null;
  struggleSpans: DigestStruggleSpan[];
  toolTimeline: DigestTimelineEntry[];
  errorClusters: DigestErrorCluster[];
  /** Union of every `event_ledger.id` referenced anywhere in the digest. */
  evidenceEventIds: string[];
  /** True when the struggle anchor was lost or timeline entries were dropped. */
  truncated: boolean;
}

/** Result of trimming a digest timeline to a token budget. */
export interface TimelineBudgetResult {
  kept: DigestTimelineEntry[];
  droppedCount: number;
}
