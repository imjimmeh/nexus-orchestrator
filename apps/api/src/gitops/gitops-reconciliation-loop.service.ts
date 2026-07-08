import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import type {
  GitOpsReconciliationDeprecatedApplyEvent,
  GitOpsReconciliationTickCompletedEvent,
} from '@nexus/gitops-contracts';
import { EventLedgerService } from '../observability/event-ledger.service';
import { MetricsService } from '../observability/metrics.service';
import { GitOpsReconciliationLoop } from './gitops-reconciliation-loop';
import type {
  GitOpsLoopParams,
  GitOpsTickResult,
} from './gitops-reconciliation-loop.types';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

const DEFAULT_INTERVAL_MS = 300_000;
const DEFAULT_JITTER_MS = 30_000;

/** System actor used when the loop invokes the inbound service. */
const SYSTEM_ACTOR_ID = 'system:gitops-reconciliation-loop';

/**
 * NestJS service that wires the scheduled reconciliation tick
 * to the binding-aware `GitOpsInboundReconcileService.apply`
 * mutation path. The legacy env-driven `ReconciliationService`
 * is intentionally NOT called from this loop — see the work
 * item for the migration context.
 *
 * Public surface:
 *   - `tick()` — single binding-aware tick. Iterates every
 *     enabled binding via
 *     `GitOpsRepositoryBindingService.listActive()` and calls
 *     `GitOpsInboundReconcileService.apply` per binding,
 *     isolating failures with a per-binding try/catch so one
 *     failing binding never blocks the others.
 *   - `start()` / `stop()` — bootstrap helpers that wrap the
 *     existing `GitOpsReconciliationLoop` scheduling primitive
 *     (the timer + interval-jitter scaffolding).
 *   - `resolveIntervalMs()` / `resolveJitterMs()` — public so
 *     tests can assert the env-driven wiring.
 */
@Injectable()
export class GitOpsReconciliationLoopService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(GitOpsReconciliationLoopService.name);
  private readonly loop: GitOpsReconciliationLoop;

  constructor(
    private readonly config: ConfigService,
    private readonly bindings: GitOpsRepositoryBindingService,
    private readonly inbound: GitOpsInboundReconcileService,
    private readonly eventLedger: EventLedgerService,
    private readonly metrics: MetricsService,
  ) {
    const params: GitOpsLoopParams = {
      logger: this.logger,
      isEnabled: () => this.isEnabled(),
      intervalMs: this.resolveIntervalMs(),
      jitterMs: this.resolveJitterMs(),
      runTick: () => this.tick(),
    };
    this.loop = new GitOpsReconciliationLoop(params);
  }

  onApplicationBootstrap(): void {
    this.loop.start();
  }

  onModuleDestroy(): void {
    this.loop.stop();
  }

  /**
   * Public binding-aware tick. Iterates all enabled bindings
   * in id-ascending order (deterministic) and invokes
   * `GitOpsInboundReconcileService.apply` per binding.
   *
   * Returns a counts envelope that mirrors the
   * `GitOpsReconciliationTickCompletedEvent` contract. Per-binding
   * failures are isolated: a single binding that throws will
   * be counted under `errors` (or `conflicts` when the
   * underlying exception is a `BadRequestException` from the
   * plan-conflict guard) but will not abort the iteration.
   */
  async tick(): Promise<GitOpsReconciliationTickCompletedEvent> {
    if (!this.isEnabled()) {
      // The loop param already short-circuits on `isEnabled()`,
      // but the public method must remain idempotent if a
      // caller invokes `tick()` directly (e.g. from a test or
      // an admin endpoint). Returning a zero-counts envelope
      // without emitting any events keeps the no-op semantics
      // consistent: a disabled loop never reaches the event
      // ledger or the prom-client counter pipeline.
      return {
        applied: 0,
        conflicts: 0,
        errors: 0,
        bindingsEvaluated: 0,
        emittedAt: new Date().toISOString(),
        durationMs: 0,
      };
    }

    const startedAt = Date.now();
    const activeBindings = await this.bindings.listActive();
    let applied = 0;
    let conflicts = 0;
    let errors = 0;

    for (const binding of activeBindings) {
      const result = await this.applyOneBinding(binding);
      if (result === 'applied') applied += 1;
      else if (result === 'conflict') conflicts += 1;
      else errors += 1;
    }

    const durationMs = Date.now() - startedAt;
    return this.buildTickCompletedEvent(
      applied,
      conflicts,
      errors,
      activeBindings.length,
      durationMs,
    );
  }

  start(): void {
    this.loop.start();
  }

  stop(): void {
    this.loop.stop();
  }

  /** `GITOPS_RECONCILIATION_ENABLED` env var, default `true`. */
  isEnabled(): boolean {
    const raw = this.config.get<string>('GITOPS_RECONCILIATION_ENABLED');
    if (raw === undefined || raw === null || raw === '') {
      return true;
    }
    const normalized = raw.trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
  }

  /** `GITOPS_RECONCILIATION_INTERVAL_MS` env var, default 300_000ms. */
  resolveIntervalMs(): number {
    return readPositiveInteger(
      this.config.get<string>('GITOPS_RECONCILIATION_INTERVAL_MS'),
      DEFAULT_INTERVAL_MS,
    );
  }

  /** `GITOPS_RECONCILIATION_JITTER_MS` env var, default 30_000ms. */
  resolveJitterMs(): number {
    return readPositiveInteger(
      this.config.get<string>('GITOPS_RECONCILIATION_JITTER_MS'),
      DEFAULT_JITTER_MS,
    );
  }

  /**
   * Emit the canonical `gitops.reconciliation.deprecated_apply`
   * event for the legacy adapter path. Public so the
   * `ReconciliationService` deprecation adapter can call it.
   */
  async emitDeprecatedApplyEvent(
    payload: GitOpsReconciliationDeprecatedApplyEvent,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'gitops',
      eventName: 'gitops.reconciliation.deprecated_apply',
      outcome: 'success',
      payload,
    });
  }

  private async applyOneBinding(
    binding: GitOpsRepositoryBinding,
  ): Promise<GitOpsTickResult> {
    try {
      await this.inbound.apply(binding.scopeNodeId, binding.id, {
        actorId: SYSTEM_ACTOR_ID,
      });
      this.metrics.gitopsReconciliationTickCompletedTotal.inc({
        result: 'applied',
      });
      return 'applied';
    } catch (error) {
      if (error instanceof BadRequestException) {
        this.logger.warn(
          `GitOps reconcile tick conflict for binding ${binding.id}: ${error.message}`,
        );
        this.metrics.gitopsReconciliationTickCompletedTotal.inc({
          result: 'conflict',
        });
        return 'conflict';
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `GitOps reconcile tick error for binding ${binding.id}: ${message}`,
      );
      this.metrics.gitopsReconciliationTickCompletedTotal.inc({
        result: 'error',
      });
      return 'error';
    }
  }

  private async emitTickCompletedEvent(
    payload: GitOpsReconciliationTickCompletedEvent,
  ): Promise<void> {
    await this.eventLedger.emitBestEffort({
      domain: 'gitops',
      eventName: 'gitops.reconciliation.tick_completed',
      outcome: payload.errors > 0 ? 'failure' : 'success',
      payload,
    });
  }

  private buildTickCompletedEvent(
    applied: number,
    conflicts: number,
    errors: number,
    bindingsEvaluated: number,
    durationMs: number,
  ): GitOpsReconciliationTickCompletedEvent {
    const event: GitOpsReconciliationTickCompletedEvent = {
      applied,
      conflicts,
      errors,
      bindingsEvaluated,
      emittedAt: new Date().toISOString(),
      durationMs,
    };
    // Fire-and-forget emit — the loop must not block on the
    // event ledger. Errors are absorbed by `emitBestEffort`.
    void this.emitTickCompletedEvent(event);
    return event;
  }
}

/**
 * Parse a positive integer from an env-var string with a
 * documented default. Negative or non-numeric values fall back
 * to the default so a typo cannot silently disable the loop.
 */
function readPositiveInteger(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}
