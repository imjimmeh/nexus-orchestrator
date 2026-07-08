import { BadRequestException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContextResolverService } from './execution-context-resolver.service';
import type { WorkflowRunRepository } from './database/repositories/workflow-run.repository';

function makeRepo(run: unknown = null): WorkflowRunRepository {
  return {
    findById: vi.fn().mockResolvedValue(run),
  } as unknown as WorkflowRunRepository;
}

describe('ExecutionContextResolverService', () => {
  let repo: WorkflowRunRepository;
  let service: ExecutionContextResolverService;

  beforeEach(() => {
    repo = makeRepo();
    service = new ExecutionContextResolverService(repo);
  });

  describe('parseAgentToken', () => {
    it('returns null for undefined', () => {
      expect(service.parseAgentToken(undefined)).toBeNull();
    });

    it('returns null for non-agent prefix', () => {
      expect(service.parseAgentToken('user:abc')).toBeNull();
    });

    it('returns null when only two segments after agent:', () => {
      expect(service.parseAgentToken('agent:run-id')).toBeNull();
    });

    it('returns null when workflowRunId is blank', () => {
      expect(service.parseAgentToken('agent: :job-id')).toBeNull();
    });

    it('parses a valid agent token', () => {
      expect(service.parseAgentToken('agent:run-123:job-456')).toEqual({
        workflowRunId: 'run-123',
        jobId: 'job-456',
      });
    });

    it('trims whitespace from segments', () => {
      expect(service.parseAgentToken('agent: run-123 : job-456 ')).toEqual({
        workflowRunId: 'run-123',
        jobId: 'job-456',
      });
    });
  });

  describe('resolveWorkflowRunId', () => {
    it('returns explicit workflowRunId when provided', () => {
      expect(
        service.resolveWorkflowRunId({ workflowRunId: 'explicit-id' }),
      ).toBe('explicit-id');
    });

    it('falls back to token when no explicit workflowRunId', () => {
      const result = service.resolveWorkflowRunId({
        user: { userId: 'agent:token-run:job-1' },
      });
      expect(result).toBe('token-run');
    });

    it('prefers explicit workflowRunId over token', () => {
      const result = service.resolveWorkflowRunId({
        workflowRunId: 'explicit-id',
        user: { userId: 'agent:token-run:job-1' },
      });
      expect(result).toBe('explicit-id');
    });

    it('throws BadRequestException when neither source available', () => {
      expect(() => service.resolveWorkflowRunId({})).toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveAgentExecutionContext', () => {
    it('throws when no workflowRunId can be resolved', async () => {
      await expect(
        service.resolveAgentExecutionContext({ user: { userId: 'user:123' } }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when run is not found', async () => {
      (repo.findById as any).mockResolvedValue(null);
      await expect(
        service.resolveAgentExecutionContext({ workflowRunId: 'missing-run' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when jobId cannot be resolved and run has no current_step_id', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: undefined,
      });

      await expect(
        service.resolveAgentExecutionContext({ workflowRunId: 'run-123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('resolves using explicit workflowRunId and jobId', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: undefined,
      });

      const result = await service.resolveAgentExecutionContext({
        workflowRunId: 'run-123',
        jobId: 'job-456',
      });

      expect(result).toEqual({ workflowRunId: 'run-123', jobId: 'job-456' });
    });

    it('resolves jobId from agent token when no explicit jobId', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: undefined,
      });

      const result = await service.resolveAgentExecutionContext({
        user: { userId: 'agent:run-123:job-from-token' },
      });

      expect(result).toEqual({
        workflowRunId: 'run-123',
        jobId: 'job-from-token',
      });
    });

    it('prefers authenticated JWT jobId claim over token subject job segment', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: undefined,
      });

      const result = await service.resolveAgentExecutionContext({
        user: {
          userId: 'agent:run-123:subagent-execution-1',
          jobId: 'parent-job',
        },
      });

      expect(result).toEqual({
        workflowRunId: 'run-123',
        jobId: 'parent-job',
      });
    });

    it('falls back to current_step_id when jobId not in token or params', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: 'step-from-db',
      });

      const result = await service.resolveAgentExecutionContext({
        workflowRunId: 'run-123',
      });

      expect(result).toEqual({
        workflowRunId: 'run-123',
        jobId: 'step-from-db',
      });
    });

    it('prefers authenticated token jobId over explicit body jobId for agents', async () => {
      (repo.findById as any).mockResolvedValue({
        id: 'run-123',
        current_step_id: 'step-from-db',
      });

      const result = await service.resolveAgentExecutionContext({
        workflowRunId: 'run-123',
        jobId: 'body-job',
        user: { userId: 'agent:run-123:job-from-token' },
      });

      expect(result).toEqual({
        workflowRunId: 'run-123',
        jobId: 'job-from-token',
      });
    });
  });
});
