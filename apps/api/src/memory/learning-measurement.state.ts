/**
 * In-memory state holder for the EPIC-212 Phase 3 Task 6 causal-measurement
 * trio (behaviour-change counter, A/B holdout lift, cost-per-promoted-memory,
 * suppressed-noise rollup).
 *
 * Extracted from `MemoryMetricsService` so that service stays under the
 * file-level `max-lines` cap and the measurement state has a single,
 * cohesive owner. The lift maths lives in the pure `learning-lift.helper`;
 * this class only owns the per-arm ring buffers and the scalar counters.
 */
import { armRatio, computeLift } from './learning-lift.helper';
import type {
  HoldoutArm,
  LearningBehaviourChangeMetrics,
  LearningBehaviourChangePayload,
  LearningLastBehaviourChange,
  LearningLastProbationPass,
  LearningLiftSnapshot,
  LearningProbationMetrics,
  ProbationOutcomeCounts,
} from './memory-metrics.types';

/** Per-arm outcome sample for the A/B holdout lift rings. */
interface ArmOutcomeSample {
  at: number;
  outcome: 'success' | 'failure';
}

/** Hard cap on each per-scope per-arm ring (mirrors the convergence cap). */
const MAX_ARM_RING_PER_SCOPE = 100_000;

const MS_PER_DAY = 86_400_000;

export class LearningMeasurementState {
  private behaviourChangedTotal = 0;
  private behaviourUnchangedTotal = 0;
  private lastBehaviourChange: LearningLastBehaviourChange | null = null;

  private readonly armOutcomesByScope = new Map<
    string,
    Map<HoldoutArm, ArmOutcomeSample[]>
  >();

  private costPerPromotedMemory: number | null = null;
  private suppressedNoiseCount: number | null = null;

  private probationConfirmedTotal = 0;
  private probationRevertedTotal = 0;
  private probationHeldTotal = 0;
  private lastProbationPass: LearningLastProbationPass | null = null;

  recordBehaviourChange(payload: LearningBehaviourChangePayload): void {
    if (payload.changed) {
      this.behaviourChangedTotal += 1;
    } else {
      this.behaviourUnchangedTotal += 1;
    }
    this.lastBehaviourChange = {
      lesson_id: payload.lesson_id,
      scope: payload.scope,
      changed: payload.changed,
      observed_at: new Date().toISOString(),
    };
  }

  appendArmOutcome(
    scope: string,
    arm: HoldoutArm,
    outcome: 'success' | 'failure',
  ): void {
    let byArm = this.armOutcomesByScope.get(scope);
    if (!byArm) {
      byArm = new Map<HoldoutArm, ArmOutcomeSample[]>();
      this.armOutcomesByScope.set(scope, byArm);
    }
    let ring = byArm.get(arm);
    if (!ring) {
      ring = [];
      byArm.set(arm, ring);
    }
    if (ring.length >= MAX_ARM_RING_PER_SCOPE) {
      ring.shift();
    }
    ring.push({ at: Date.now(), outcome });
  }

  setCostPerPromotedMemory(value: number | null): void {
    this.costPerPromotedMemory =
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : null;
  }

  setSuppressedNoiseCount(value: number | null): void {
    this.suppressedNoiseCount =
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null;
  }

  get cost(): number | null {
    return this.costPerPromotedMemory;
  }

  get suppressed(): number | null {
    return this.suppressedNoiseCount;
  }

  /**
   * Accumulate one probation evaluator pass (EPIC-212 Phase 3, Task 7) into
   * the running totals and record it as the most-recent pass.
   */
  recordProbationOutcome(counts: ProbationOutcomeCounts): void {
    this.probationConfirmedTotal += Math.max(0, Math.floor(counts.confirmed));
    this.probationRevertedTotal += Math.max(0, Math.floor(counts.reverted));
    this.probationHeldTotal += Math.max(0, Math.floor(counts.held));
    this.lastProbationPass = {
      confirmed: Math.max(0, Math.floor(counts.confirmed)),
      reverted: Math.max(0, Math.floor(counts.reverted)),
      held: Math.max(0, Math.floor(counts.held)),
      observed_at: new Date().toISOString(),
    };
  }

  buildProbationMetrics(): LearningProbationMetrics {
    return {
      confirmed_total: this.probationConfirmedTotal,
      reverted_total: this.probationRevertedTotal,
      held_total: this.probationHeldTotal,
      last_pass: this.lastProbationPass ? { ...this.lastProbationPass } : null,
    };
  }

  buildBehaviourChangeMetrics(): LearningBehaviourChangeMetrics {
    return {
      changed_total: this.behaviourChangedTotal,
      unchanged_total: this.behaviourUnchangedTotal,
      last: this.lastBehaviourChange ? { ...this.lastBehaviourChange } : null,
    };
  }

  /**
   * Compute the per-scope lift snapshots over the rolling window, trimming
   * the per-arm rings in place. Returns `{}` when no holdout arm has been
   * measured (the default state with `learning_holdout_fraction = 0`).
   */
  computeLiftSnapshots(
    windowDays: number,
  ): Record<string, LearningLiftSnapshot> {
    const now = Date.now();
    const cutoff = now - windowDays * MS_PER_DAY;
    const computedAt = new Date(now).toISOString();
    const snapshots: Record<string, LearningLiftSnapshot> = {};

    for (const [scope, byArm] of this.armOutcomesByScope.entries()) {
      const injected = this.tallyArm(byArm.get('injected'), cutoff);
      const holdout = this.tallyArm(byArm.get('holdout'), cutoff);
      if (injected.runs === 0 && holdout.runs === 0) {
        this.armOutcomesByScope.delete(scope);
        continue;
      }
      snapshots[scope] = {
        lift: computeLift(injected, holdout),
        injected: { ...injected, ratio: armRatio(injected) },
        holdout: { ...holdout, ratio: armRatio(holdout) },
        window_days: windowDays,
        computed_at: computedAt,
      };
    }
    return snapshots;
  }

  private tallyArm(
    ring: ArmOutcomeSample[] | undefined,
    cutoff: number,
  ): { runs: number; successes: number } {
    if (!ring) {
      return { runs: 0, successes: 0 };
    }
    const kept = ring.filter((sample) => sample.at > cutoff);
    ring.length = 0;
    for (const sample of kept) {
      ring.push(sample);
    }
    const successes = kept.reduce(
      (count, sample) => (sample.outcome === 'success' ? count + 1 : count),
      0,
    );
    return { runs: kept.length, successes };
  }
}
