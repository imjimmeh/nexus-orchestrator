/**
 * `RetrospectiveDrainService` — EPIC-212 Phase-2 Task 3, the cost governor.
 *
 * Two entry points, both budget-capped and fail-soft:
 *
 *   - `drainWindow()` — the windowed batch path. Atomically claims the top-N
 *     highest-interest `queued` rows (`claimTopN` already orders by priority
 *     then interest_score DESC and flips them to `draining`), then for each
 *     claimed row:
 *       • interest_score < floor → mark `skipped` WITHOUT any analyzer call
 *         (never spend an LLM on noise);
 *       • analysis port ABSENT (Task 6 not yet wired) → reset the row to
 *         `queued` so it is NOT lost and the orchestrator picks it up once
 *         bound;
 *       • otherwise → hand to the analysis PORT and mark `analyzed` / `failed`
 *         per the outcome (or `skipped` if the analyzer declined).
 *     Per-row failures are isolated: one bad row never aborts the window.
 *
 *   - `analyzeImmediately(runId)` — the `bypass` path. Looks up the row,
 *     guards it (must still be `queued`), enforces the floor, and analyzes on
 *     the spot — counted against a SEPARATE `bypassBudget` that resets each
 *     window so a burst of high-signal failures cannot blow the cost budget.
 *
 * Budgets (`budgetPerWindow`, `bypassBudget`) are HARD caps. The analysis port
 * is injected as an ABSTRACTION (`@Optional()`); its absence degrades the drain
 * gracefully without losing rows.
 *
 * Scope-neutral: no domain-specific identifiers leave this boundary.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { RetrospectiveQueueRepository } from './retrospective-queue.repository';
import type { RetrospectiveQueue } from './database/entities/retrospective-queue.entity';
import {
  RETROSPECTIVE_ANALYSIS_PORT,
  type RetrospectiveAnalysisOutcome,
  type RetrospectiveAnalysisPort,
} from './retrospective-analysis.port';
import {
  RETROSPECTIVE_DRAIN_SETTING_DEFAULTS,
  RETROSPECTIVE_DRAIN_SETTING_KEYS,
} from './retrospective-drain.settings.constants';
import { resolveRetrospectiveEnabled } from './retrospective-enabled.settings';
import type { DrainBudget, DrainSummary } from './retrospective-drain.types';

const QUEUE_STATUS_QUEUED = 'queued';
const QUEUE_STATUS_DRAINING = 'draining';
const QUEUE_STATUS_ANALYZED = 'analyzed';
const QUEUE_STATUS_FAILED = 'failed';
const QUEUE_STATUS_SKIPPED = 'skipped';

/** Per-row disposition the windowed drain tallies into its summary. */
type RowDisposition = 'analyzed' | 'failed' | 'skipped' | 'deferred';

@Injectable()
export class RetrospectiveDrainService {
  private readonly logger = new Logger(RetrospectiveDrainService.name);

  /**
   * Immediate (`bypass`) analyses spent in the current window. Reset to 0 at
   * the start of every `drainWindow()` tick so the bypass budget is bounded per
   * window — a simple, restart-safe accounting that needs no extra table.
   */
  private bypassUsedInWindow = 0;

  constructor(
    private readonly repository: RetrospectiveQueueRepository,
    private readonly settings: SystemSettingsService,
    @Optional()
    @Inject(RETROSPECTIVE_ANALYSIS_PORT)
    private readonly analysisPort?: RetrospectiveAnalysisPort,
  ) {}

  // ── Windowed batch drain ──────────────────────────────────────────────────

  /**
   * Claim and dispatch up to `budgetPerWindow` highest-interest queued rows.
   * Resets the per-window bypass budget. No-ops with an empty summary when the
   * `retrospective_enabled` master kill-switch is off (the analyst loop is
   * inert; only the deterministic Phase-0/1 loop runs). A claim failure
   * propagates (the processor logs + rethrows so BullMQ can retry); per-row
   * failures do not.
   */
  async drainWindow(): Promise<DrainSummary> {
    this.bypassUsedInWindow = 0;

    if (!(await resolveRetrospectiveEnabled(this.settings))) {
      this.logger.debug(
        'RetrospectiveDrainService drain tick skipped: retrospective_enabled is false.',
      );
      return { claimed: 0, analyzed: 0, skipped: 0, failed: 0, deferred: 0 };
    }

    const budget = await this.resolveBudget();
    const rows = await this.repository.claimTopN(budget.budgetPerWindow, [
      QUEUE_STATUS_QUEUED,
    ]);

    const summary: DrainSummary = {
      claimed: rows.length,
      analyzed: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    };

    for (const row of rows) {
      const disposition = await this.dispatchClaimedRow(row, budget);
      summary[disposition] += 1;
    }

    this.logger.log(
      `RetrospectiveDrainService drain tick: claimed=${summary.claimed.toString()}, ` +
        `analyzed=${summary.analyzed.toString()}, skipped=${summary.skipped.toString()}, ` +
        `failed=${summary.failed.toString()}, deferred=${summary.deferred.toString()}.`,
    );
    return summary;
  }

  /**
   * Disposition for a single claimed (`draining`) row. Never throws — analyzer
   * failures are caught so one row cannot abort the window.
   */
  private async dispatchClaimedRow(
    row: RetrospectiveQueue,
    budget: DrainBudget,
  ): Promise<RowDisposition> {
    if (row.interest_score < budget.interestFloor) {
      await this.markSkipped(row, 'below_interest_floor');
      return 'skipped';
    }

    if (this.analysisPort === undefined) {
      // Task 6 not yet wired: return the row to the pool rather than lose it.
      await this.safeMark(row, QUEUE_STATUS_QUEUED, {
        signals_json: this.mergeSignals(row, { drain_deferred: true }),
      });
      return 'deferred';
    }

    return this.analyzeRow(row);
  }

  // ── Immediate (bypass) drain ──────────────────────────────────────────────

  /**
   * Analyze a single high-signal run immediately, outside the window. Bounded
   * by `bypassBudget`; below-floor or budget-exhausted requests are skipped
   * (the row is left `queued` so the windowed drain can still pick it up).
   * Never throws.
   */
  async analyzeImmediately(
    runId?: string,
    chatSessionId?: string,
  ): Promise<RetrospectiveAnalysisOutcome> {
    try {
      const budget = await this.resolveBudget();
      const row = runId
        ? await this.repository.findByRunId(runId)
        : chatSessionId
          ? await this.repository.findByChatSessionId(chatSessionId)
          : null;
      if (row === null) {
        return { status: 'skipped', reason: 'not_found' };
      }
      if (row.status !== QUEUE_STATUS_QUEUED) {
        return { status: 'skipped', reason: 'not_claimable' };
      }
      if (row.interest_score < budget.interestFloor) {
        await this.markSkipped(row, 'below_interest_floor');
        return { status: 'skipped', reason: 'below_interest_floor' };
      }
      if (this.bypassUsedInWindow >= budget.bypassBudget) {
        // Leave the row `queued` — the windowed drain remains its fallback.
        return { status: 'skipped', reason: 'bypass_budget_exhausted' };
      }
      if (this.analysisPort === undefined) {
        return { status: 'skipped', reason: 'analyzer_unavailable' };
      }

      this.bypassUsedInWindow += 1;
      await this.safeMark(row, QUEUE_STATUS_DRAINING);
      const disposition = await this.analyzeRow(row);
      return { status: disposition === 'failed' ? 'failed' : 'analyzed' };
    } catch (error) {
      const identifier = runId ?? chatSessionId ?? 'unknown';
      this.warn(
        `immediate analysis failed for identifier ${identifier}`,
        error,
      );
      return { status: 'failed', reason: 'bypass_error' };
    }
  }

  // ── Shared analysis hand-off ──────────────────────────────────────────────

  /**
   * Hand a claimed row to the analysis port and persist the terminal status.
   * Caller guarantees `this.analysisPort` is defined. Catches analyzer throws
   * so the window/bypass caller never unwinds.
   */
  private async analyzeRow(row: RetrospectiveQueue): Promise<RowDisposition> {
    const port = this.analysisPort;
    if (port === undefined) {
      await this.safeMark(row, QUEUE_STATUS_QUEUED, {
        signals_json: this.mergeSignals(row, { drain_deferred: true }),
      });
      return 'deferred';
    }

    try {
      const outcome = await port.analyze(row);
      const status = mapOutcomeStatus(outcome.status);
      await this.safeMark(row, status, {
        drained_at: new Date(),
        signals_json: this.mergeSignals(row, {
          drain_outcome: outcome.status,
          ...(outcome.reason === undefined
            ? {}
            : { drain_reason: outcome.reason }),
        }),
      });
      return outcome.status === 'skipped'
        ? 'skipped'
        : outcome.status === 'failed'
          ? 'failed'
          : 'analyzed';
    } catch (error) {
      this.warn(`analyzer threw for row ${row.id}`, error);
      await this.safeMark(row, QUEUE_STATUS_FAILED, {
        drained_at: new Date(),
        signals_json: this.mergeSignals(row, { drain_outcome: 'failed' }),
      });
      return 'failed';
    }
  }

  // ── Persistence + settings (fail-soft) ────────────────────────────────────

  private async markSkipped(
    row: RetrospectiveQueue,
    reason: string,
  ): Promise<void> {
    await this.safeMark(row, QUEUE_STATUS_SKIPPED, {
      drained_at: new Date(),
      signals_json: this.mergeSignals(row, { drain_skip_reason: reason }),
    });
  }

  private async safeMark(
    row: RetrospectiveQueue,
    status: string,
    patch: Partial<RetrospectiveQueue> = {},
  ): Promise<void> {
    try {
      await this.repository.markStatus(row.id, status, patch);
    } catch (error) {
      this.warn(`status write '${status}' failed for row ${row.id}`, error);
    }
  }

  private mergeSignals(
    row: RetrospectiveQueue,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return { ...(row.signals_json ?? {}), ...extra };
  }

  private async resolveBudget(): Promise<DrainBudget> {
    const read = async (key: string, fallback: number): Promise<number> =>
      coerceNumber(await this.settings.get<unknown>(key, fallback), fallback);
    try {
      const keys = RETROSPECTIVE_DRAIN_SETTING_KEYS;
      const d = RETROSPECTIVE_DRAIN_SETTING_DEFAULTS;
      return {
        budgetPerWindow: clampBudget(
          await read(keys.budgetPerWindow, d.budgetPerWindow),
          d.budgetPerWindow,
        ),
        bypassBudget: clampBudget(
          await read(keys.bypassBudget, d.bypassBudget),
          d.bypassBudget,
        ),
        interestFloor: await read(keys.interestFloor, d.interestFloor),
      };
    } catch (error) {
      this.warn('budget resolution failed; using compiled defaults', error);
      return { ...RETROSPECTIVE_DRAIN_SETTING_DEFAULTS };
    }
  }

  private warn(context: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `RetrospectiveDrainService ${context}: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}

// ── Pure helpers (module-private) ────────────────────────────────────────────

function mapOutcomeStatus(
  status: RetrospectiveAnalysisOutcome['status'],
): string {
  switch (status) {
    case 'analyzed':
      return QUEUE_STATUS_ANALYZED;
    case 'failed':
      return QUEUE_STATUS_FAILED;
    case 'skipped':
      return QUEUE_STATUS_SKIPPED;
  }
}

/** A budget must be a non-negative integer; a bad operator value falls back. */
function clampBudget(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return Math.floor(value);
}

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
