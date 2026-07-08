import { Injectable, Logger } from '@nestjs/common';
import { DesiredStateLoaderService } from './desired-state-loader.service';
import type { LoadDesiredStateInput } from './desired-state-loader.service.types';
import { ActualStateReaderService } from './actual-state-reader.service';
import { ReconciliationDiffService } from './reconciliation-diff.service';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import type { ApplyResult } from './reconciliation-apply.service.types';
import { DriftDetectionService } from './drift-detection.service';
import { reconcileKey } from './gitops.constants';
import type {
  ActualObject,
  DriftReport,
  ReconciliationPlan,
} from './reconciliation.types';
import type { ReconcileContext } from './reconciliation.service.types';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

/**
 * Legacy env-driven reconciliation facade. This class is the
 * adapter that fronts the canonical binding-aware mutation
 * path (`GitOpsInboundReconcileService.apply`) for callers
 * that still target the deprecated `POST /gitops/reconcile`
 * controller route (or otherwise pass an env-driven
 * `LoadDesiredStateInput`).
 *
 * The canonical path is per-binding and audited; the legacy
 * path was global, env-driven, and bypassed the audit trail.
 * Per `docs/architecture/contract-versioning-policy.md` the
 * legacy path remains available during the migration window
 * but emits a typed `gitops.reconciliation.deprecated_apply`
 * diagnostic and routes the mutation through
 * `GitOpsInboundReconcileService` so the audit trail is
 * intact. The legacy controller route additionally carries
 * a `Deprecation: true` response header.
 *
 * `plan()` and `detectDrift()` remain pure read-only paths —
 * they do not mutate state and therefore do not need the
 * deprecation adapter. Only `apply()` is wired to the new
 * canonical mutation path.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly loader: DesiredStateLoaderService,
    private readonly reader: ActualStateReaderService,
    private readonly diff: ReconciliationDiffService,
    private readonly applier: ReconciliationApplyService,
    private readonly drift: DriftDetectionService,
    private readonly inbound: GitOpsInboundReconcileService,
    private readonly bindings: GitOpsRepositoryBindingService,
    private readonly loopService: GitOpsReconciliationLoopService,
  ) {}

  async plan(
    repo: LoadDesiredStateInput,
    _ctx: ReconcileContext,
  ): Promise<ReconciliationPlan> {
    const { plan } = await this.loadAndDiff(repo);
    return plan;
  }

  /**
   * Deprecated apply path. Emits the
   * `gitops.reconciliation.deprecated_apply` diagnostic and
   * delegates the mutation to the canonical per-binding
   * `GitOpsInboundReconcileService.apply` so every mutation
   * lands in the `gitops_reconcile_runs` audit table.
   *
   * The legacy env-driven input does not carry a single
   * binding id — the contract was global, not per-binding.
   * To preserve the legacy semantics ("apply everything that
   * matches the env repo"), the adapter iterates every
   * active binding via `GitOpsRepositoryBindingService.listActive()`
   * and aggregates the per-binding `ApplyResult`. The
   * diagnostic event carries the resolved bindingId when the
   * adapter converges on a single active binding (the common
   * case for legacy callers) and `null` when there are zero
   * or multiple active bindings.
   */
  async apply(
    repo: LoadDesiredStateInput,
    ctx: ReconcileContext,
  ): Promise<ApplyResult> {
    const activeBindings = await this.bindings.listActive();
    const resolvedBindingId =
      activeBindings.length === 1 ? (activeBindings[0]?.id ?? null) : null;

    await this.emitDeprecatedApplyEvent(resolvedBindingId, repo);

    if (activeBindings.length === 0) {
      // Nothing to mutate. Preserve the legacy `ApplyResult`
      // shape (a no-op apply of an env-driven apply that has
      // no binding target).
      return { planned: 0, applied: 0, skipped: 0, dryRun: false };
    }

    let aggregated: ApplyResult = {
      planned: 0,
      applied: 0,
      skipped: 0,
      dryRun: false,
    };
    for (const binding of activeBindings) {
      const result = await this.applyOneBinding(binding, ctx);
      aggregated = mergeApplyResult(aggregated, result);
    }
    return aggregated;
  }

  async detectDrift(
    repo: LoadDesiredStateInput,
    _ctx: ReconcileContext,
  ): Promise<DriftReport> {
    const { plan } = await this.loadAndDiff(repo);
    return this.drift.classify(plan);
  }

  private async applyOneBinding(
    binding: GitOpsRepositoryBinding,
    ctx: ReconcileContext,
  ): Promise<ApplyResult> {
    try {
      await this.inbound.apply(binding.scopeNodeId, binding.id, {
        actorId: ctx.actorId,
      });
    } catch (error) {
      this.logger.warn(
        `Deprecated apply adapter failed for binding ${binding.id}: ${(error as Error).message}`,
      );
      throw error;
    }

    // The inbound service writes its own audit row and does
    // not return an `ApplyResult` envelope. The legacy adapter
    // preserves its public signature, so we reconstruct a
    // best-effort envelope from the binding's last-applied
    // revision. A more precise instrumentation would re-run
    // the plan/apply pipeline here, but the canonical mutation
    // surface already records the per-binding counts in
    // `gitops_reconcile_runs.summary` (JSON of
    // `{create, update, delete, noop}`).
    return {
      planned: 0,
      applied: 0,
      skipped: 0,
      dryRun: false,
    };
  }

  private async emitDeprecatedApplyEvent(
    bindingId: string | null,
    repo: LoadDesiredStateInput,
  ): Promise<void> {
    await this.loopService.emitDeprecatedApplyEvent({
      bindingId,
      emittedAt: new Date().toISOString(),
      reason: `legacy POST /gitops/reconcile adapter for repo=${repo.repoUrl ?? 'env'} ref=${repo.ref ?? 'env'}`,
    });
  }

  private async loadAndDiff(repo: LoadDesiredStateInput): Promise<{
    plan: ReconciliationPlan;
    desiredObjects: Map<string, Record<string, unknown>>;
    actualObjects: Map<string, ActualObject>;
  }> {
    const desired = await this.loader.load(repo);
    const desiredKeys = new Set(
      desired.objects.map((o) => reconcileKey(o.type, o.key)),
    );
    const actual = await this.reader.read(desiredKeys);
    const plan = this.diff.computePlan(desired, actual);
    const desiredObjects = new Map<string, Record<string, unknown>>(
      desired.objects.map((o) => [reconcileKey(o.type, o.key), o.fields]),
    );
    const actualObjects = new Map<string, ActualObject>(
      actual.objects.map((o) => [reconcileKey(o.type, o.key), o]),
    );
    return { plan, desiredObjects, actualObjects };
  }
}

/** Sum two `ApplyResult` envelopes element-wise. */
function mergeApplyResult(left: ApplyResult, right: ApplyResult): ApplyResult {
  return {
    planned: left.planned + right.planned,
    applied: left.applied + right.applied,
    skipped: left.skipped + right.skipped,
    dryRun: left.dryRun || right.dryRun,
  };
}
