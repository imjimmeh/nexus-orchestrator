/**
 * Public type surface for the MemoryEvictionReaperService.
 *
 * Splitting the types out of `memory-eviction.reaper.ts` keeps the
 * service file focused on its implementation and lets the
 * integration milestone (and any future scheduler that wraps the
 * reaper) import the contracts without pulling in the service's
 * NestJS decorators and side-effectful imports.
 */

export interface MemoryEvictionRunSummary {
  /** Number of rows the reaper scanned as candidates. */
  scanned: number;
  /** Number of rows actually deleted in this run. */
  evicted: number;
  /** Number of rows that matched the candidate query but were skipped
   *  (e.g. protection changed between scan and delete). Reserved for
   *  future hardening; always 0 today. */
  skipped: number;
  /** Number of per-row errors encountered (e.g. DB connection blip
   *  mid-run). The reaper continues past these so a transient
   *  failure does not lose the whole batch. */
  errors: number;
  /** ISO timestamp captured at the start of the run. */
  startedAt: string;
  /** ISO timestamp captured at the end of the run (success or fail). */
  finishedAt: string;
  /** Resolved settings used for the run. Surfaced for log lines and
   *  the metric/event payloads; lets the operator trace which values
   *  were active at run time. */
  settings: {
    maxIdleDays: number;
    minAccessCount: number;
    protectedSources: readonly string[];
  };
}

export interface MemoryEvictionRunOptions {
  /** Override "now" for deterministic tests. The reaper computes
   *  `idleCutoff = now - maxIdleDays * MS_PER_DAY`. Defaults to the
   *  system clock. */
  now?: Date;
  /** Cap the number of rows the reaper will delete in a single
   *  invocation. Defaults to {@link DEFAULT_MAX_ROWS_PER_RUN}. The
   *  reaper deletes rows in the order the repository returns them
   *  (id-ordered under the hood) so the cap is a safety valve, not
   *  a prioritization. */
  maxRows?: number;
}
