import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { MergeProviderFactory } from '../common/git/integration/merge-provider.factory';
import { PullRequestTrackingRepository } from '../common/git/integration/pull-request-tracking.repository';
import type { PullRequestTracking } from '../common/git/integration/pull-request-tracking.entity';
import { isPullRequestMergeable } from '../common/git/integration/merge-provider.helpers';
import { IntegrationLifecycleStreamPublisher } from './integration-lifecycle-stream.publisher';
import { PrMergeFinalizerService } from './pr-merge-finalizer.service';

const DEFAULT_RECONCILE_INTERVAL_MS = 60_000;

function resolveIntervalMs(): number {
  const value = Number(process.env.PR_POLL_RECONCILE_INTERVAL_MS);
  return Number.isFinite(value) && value > 0
    ? Math.round(value)
    : DEFAULT_RECONCILE_INTERVAL_MS;
}

/**
 * Fallback for missed PR webhooks: periodically loads open tracked PRs, asks the
 * provider for their status, and finalizes any now-merged PR via the shared
 * finalizer (idempotent with the webhook path). For rows whose resolved config
 * did NOT enable provider-native auto-merge, it also API-merges a PR observed
 * green (passing checks, not changes-requested); the close still happens via the
 * single idempotent finalizer on the next observed merged state.
 */
@Injectable()
export class PrPollReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrPollReconcilerService.name);
  private readonly intervalMs = resolveIntervalMs();
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly trackingRepo: PullRequestTrackingRepository,
    private readonly providerFactory: MergeProviderFactory,
    private readonly finalizer: PrMergeFinalizerService,
    private readonly publisher: IntegrationLifecycleStreamPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileOnce();
    this.timer = setInterval(() => {
      void this.reconcileOnce();
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcileOnce(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      const open = await this.trackingRepo.findOpen();
      for (const row of open) {
        await this.reconcileRow(row);
      }
    } catch (error) {
      this.logger.warn(`PR poll reconcile failed: ${this.describe(error)}`);
    } finally {
      this.inFlight = false;
    }
  }

  private async reconcileRow(row: PullRequestTracking): Promise<void> {
    try {
      const provider = this.providerFactory.resolveForRepository(
        row.repository_url,
      );
      const status = await provider.getPullRequestStatus({
        provider: row.provider,
        owner: row.owner,
        repo: row.repo,
        number: row.pr_number,
        url: row.pr_url,
      });
      if (status.state === 'merged' && status.mergeCommitSha) {
        // Single idempotent close path: convergent with the webhook. API-merge
        // only requests the merge; the observed-merge close remains here.
        await this.finalizer.finalizeMergedRow(row, status.mergeCommitSha);
        return;
      }

      // Still open: refresh the observed checks/reviewDecision downstream so the
      // stalled-PR detector sees current dynamic status each poll tick. Neutral
      // scope/context identifiers only.
      await this.publisher.publishPrStatus({
        scopeId: row.scope_id,
        contextId: row.context_id,
        prUrl: row.pr_url,
        checks: status.checks,
        reviewDecision: status.reviewDecision,
      });

      // Engine-owned API-merge: only when the repo did NOT enable provider-native
      // auto-merge. Provider branch protection still decides; this requests the
      // merge and lets the next observed merged state run the close path.
      if (!row.auto_merge && isPullRequestMergeable(status)) {
        await provider.mergePullRequest(status.ref, row.merge_method);
        this.logger.log(
          `pr-reconciler: API-merged PR ${row.pr_url} (${row.merge_method}); awaiting merged observation`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to reconcile PR ${row.pr_url}: ${this.describe(error)}`,
      );
    }
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
