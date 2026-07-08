import { Injectable, Logger } from '@nestjs/common';
import { PullRequestTrackingRepository } from '../common/git/integration/pull-request-tracking.repository';
import type { PullRequestTracking } from '../common/git/integration/pull-request-tracking.entity';
import { IntegrationLifecycleStreamPublisher } from './integration-lifecycle-stream.publisher';
import type { FinalizeMergedByIdentityInput } from './pr-merge-finalizer.service.types';

/**
 * Single convergence point for both the webhook and the poll reconciler. Marks
 * the tracking row merged (idempotent on row state) and, only on the first
 * transition, emits the neutral `core.integration.pr_merged.v1` lifecycle event.
 * Neutral throughout — scope/context identifiers only, no downstream domain
 * terms.
 */
@Injectable()
export class PrMergeFinalizerService {
  private readonly logger = new Logger(PrMergeFinalizerService.name);

  constructor(
    private readonly trackingRepo: PullRequestTrackingRepository,
    private readonly publisher: IntegrationLifecycleStreamPublisher,
  ) {}

  async finalizeMergedByIdentity(
    input: FinalizeMergedByIdentityInput,
  ): Promise<{ emitted: boolean }> {
    const row = await this.trackingRepo.findByProviderIdentity(
      input.provider,
      input.owner,
      input.repo,
      input.prNumber,
    );
    if (!row) {
      this.logger.debug(
        `No tracking row for ${input.provider}:${input.owner}/${input.repo}#${input.prNumber}; ignoring merge`,
      );
      return { emitted: false };
    }
    return this.finalizeMergedRow(row, input.mergeCommitSha);
  }

  async finalizeMergedRow(
    row: PullRequestTracking,
    mergeCommitSha: string,
  ): Promise<{ emitted: boolean }> {
    const { alreadyMerged } = await this.trackingRepo.markMerged(
      row.id,
      mergeCommitSha,
    );
    if (alreadyMerged) {
      return { emitted: false };
    }

    await this.publisher.publishPrMerged({
      scopeId: row.scope_id,
      contextId: row.context_id,
      prUrl: row.pr_url,
      mergeCommitSha,
    });
    this.logger.log(
      `Emitted pr_merged for scope ${row.scope_id} (${row.pr_url}, commit ${mergeCommitSha})`,
    );
    return { emitted: true };
  }
}
