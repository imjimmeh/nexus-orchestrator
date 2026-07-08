import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatMemoryJobService } from './chat-memory-job.service';

describe('ChatMemoryJobService', () => {
  afterEach(() => {
    delete process.env.CHAT_MEMORY_JOBS_DISABLED;
  });

  it('processes a distillation job and schedules consolidation', async () => {
    const jobs = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      claimNextPending: vi.fn().mockResolvedValue({
        id: 'job-1',
        job_type: 'distill_session',
        chat_session_id: 'chat-1',
        profile_id: 'profile-1',
        trigger_reason: 'turn_count',
        attempts: 1,
        max_attempts: 3,
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const distillation = {
      distillSessionMemory: vi.fn().mockResolvedValue(undefined),
      consolidateProfileMemory: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordDistillationSuccess: vi.fn(),
      recordDistillationFailure: vi.fn(),
    };

    const service = new ChatMemoryJobService(
      jobs as never,
      distillation as never,
      metrics as never,
    );

    await service.pollOnce();

    expect(distillation.distillSessionMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        chatSessionId: 'chat-1',
        profileId: 'profile-1',
      }),
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        job_type: 'consolidate_profile',
        profile_id: 'profile-1',
      }),
    );
    expect(jobs.update).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(metrics.recordDistillationSuccess).toHaveBeenCalledTimes(1);
  });

  it('requeues failed jobs when attempts remain', async () => {
    const jobs = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      claimNextPending: vi.fn().mockResolvedValue({
        id: 'job-2',
        job_type: 'distill_session',
        chat_session_id: 'chat-2',
        profile_id: 'profile-2',
        trigger_reason: 'turn_count',
        attempts: 1,
        max_attempts: 3,
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const distillation = {
      distillSessionMemory: vi.fn().mockRejectedValue(new Error('transient')),
      consolidateProfileMemory: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordDistillationSuccess: vi.fn(),
      recordDistillationFailure: vi.fn(),
    };

    const service = new ChatMemoryJobService(
      jobs as never,
      distillation as never,
      metrics as never,
    );

    await service.pollOnce();

    expect(jobs.update).toHaveBeenCalledWith(
      'job-2',
      expect.objectContaining({
        status: 'pending',
        last_error: 'transient',
      }),
    );
    expect(metrics.recordDistillationFailure).toHaveBeenCalledTimes(1);
  });
});
