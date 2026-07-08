import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from './database/repositories/execution.repository';
import type { OwnerLeaseParams } from './database/repositories/execution.repository.types';
import { ExecutionInstanceIdentityService } from './execution-instance-identity.service';
import type { ActiveExecutionLease } from './execution-owner-lease.service.types';

export const EXECUTION_OWNER_LEASE_TTL_MS = 2 * 60_000;
export const EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS = 30_000;

@Injectable()
export class ExecutionOwnerLeaseService {
  private readonly logger = new Logger(ExecutionOwnerLeaseService.name);

  constructor(
    private readonly repo: ExecutionRepository,
    private readonly identity: ExecutionInstanceIdentityService,
  ) {}

  async claim(executionId: string): Promise<ActiveExecutionLease> {
    const claimed = await this.repo.claimOwnerLease(
      this.buildParams(executionId, new Date()),
    );
    if (!claimed) {
      return { claimed: false, stop: () => undefined };
    }

    const handle = setInterval(() => {
      void this.renew(executionId).catch(() => {
        this.logger.warn(
          `Owner lease renewal errored for execution ${executionId}`,
        );
      });
    }, EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS);

    return {
      claimed: true,
      stop: async () => {
        clearInterval(handle);
        await this.repo.releaseOwnerLease(executionId, this.identity.id);
      },
    };
  }

  private async renew(executionId: string): Promise<void> {
    const renewed = await this.repo.renewOwnerLease(
      this.buildParams(executionId, new Date()),
    );
    if (!renewed) {
      this.logger.warn(
        `Owner lease renewal failed for execution ${executionId}`,
      );
    }
  }

  private buildParams(executionId: string, now: Date): OwnerLeaseParams {
    return {
      executionId,
      ownerInstanceId: this.identity.id,
      now,
      leaseExpiresAt: new Date(now.getTime() + EXECUTION_OWNER_LEASE_TTL_MS),
    };
  }
}
