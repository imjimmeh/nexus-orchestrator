import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS,
  EXECUTION_OWNER_LEASE_TTL_MS,
  ExecutionOwnerLeaseService,
} from './execution-owner-lease.service';
import type { ExecutionRepository } from './database/repositories/execution.repository';
import type { ExecutionInstanceIdentityService } from './execution-instance-identity.service';

describe('ExecutionOwnerLeaseService', () => {
  let repo: Pick<
    ExecutionRepository,
    'claimOwnerLease' | 'renewOwnerLease' | 'releaseOwnerLease'
  >;
  let service: ExecutionOwnerLeaseService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-30T12:00:00.000Z'));
    repo = {
      claimOwnerLease: vi.fn(),
      renewOwnerLease: vi.fn(),
      releaseOwnerLease: vi.fn(),
    };
    service = new ExecutionOwnerLeaseService(repo as ExecutionRepository, {
      id: 'api-instance-1',
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('claims and renews the owner lease until stopped', async () => {
    vi.mocked(repo.claimOwnerLease).mockResolvedValue(true);
    vi.mocked(repo.renewOwnerLease).mockResolvedValue(true);

    const lease = await service.claim('exec-1');

    expect(lease.claimed).toBe(true);
    expect(repo.claimOwnerLease).toHaveBeenCalledWith({
      executionId: 'exec-1',
      ownerInstanceId: 'api-instance-1',
      now: new Date('2026-06-30T12:00:00.000Z'),
      leaseExpiresAt: new Date(
        Date.parse('2026-06-30T12:00:00.000Z') + EXECUTION_OWNER_LEASE_TTL_MS,
      ),
    });

    await vi.advanceTimersByTimeAsync(EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS);

    expect(repo.renewOwnerLease).toHaveBeenCalledWith(
      expect.objectContaining({ executionId: 'exec-1' }),
    );

    await lease.stop();

    expect(repo.releaseOwnerLease).toHaveBeenCalledWith(
      'exec-1',
      'api-instance-1',
    );
  });

  it('does not start renewal when claim fails', async () => {
    vi.mocked(repo.claimOwnerLease).mockResolvedValue(false);

    const lease = await service.claim('exec-1');

    expect(lease.claimed).toBe(false);
    await vi.advanceTimersByTimeAsync(EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS);
    expect(repo.renewOwnerLease).not.toHaveBeenCalled();
  });

  it('contains renewal repository failures so interval callbacks do not reject', async () => {
    vi.mocked(repo.claimOwnerLease).mockResolvedValue(true);
    vi.mocked(repo.renewOwnerLease).mockRejectedValue(new Error('db offline'));

    const lease = await service.claim('exec-1');

    await vi.advanceTimersByTimeAsync(EXECUTION_OWNER_LEASE_RENEW_INTERVAL_MS);

    expect(repo.renewOwnerLease).toHaveBeenCalledTimes(1);

    await lease.stop();
  });
});
