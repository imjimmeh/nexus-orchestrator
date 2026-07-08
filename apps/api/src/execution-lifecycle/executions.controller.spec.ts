import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionsController } from './executions.controller';

describe('ExecutionsController.getById', () => {
  it('returns the execution read model when found', async () => {
    const row = {
      id: 'exec-1',
      kind: 'workflow_step',
      state: 'running',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      harness_id: 'pi',
      agent_profile_name: null,
      provider_source: null,
      workflow_run_id: 'run-1',
      chat_session_id: null,
      context_id: 'job-1',
      created_at: new Date('2026-06-13T00:00:00Z'),
      terminal_at: null,
    };
    const repo = { findById: vi.fn().mockResolvedValue(row) };
    const controller = new ExecutionsController(repo as never);

    const result = await controller.getById('exec-1');

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-opus-4-8');
    expect(result.harnessId).toBe('pi');
  });

  it('throws NotFound when missing', async () => {
    const repo = { findById: vi.fn().mockResolvedValue(null) };
    const controller = new ExecutionsController(repo as never);

    await expect(controller.getById('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
