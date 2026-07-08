import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { handleSpawnSubagentAsyncCompat } from './telemetry-gateway-subagent.helpers';

describe('telemetry-gateway-subagent.helpers', () => {
  it('rejects spawning a subagent when the workflow run is terminal', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      jobId: 'implement_and_commit',
      stepId: 'implement',
      containerId: 'container-1',
      emit: vi.fn(),
    } as any;

    const spawn = vi.fn();
    const terminalRunGuard = {
      assertRunIsActive: vi
        .fn()
        .mockRejectedValue(
          new ConflictException(
            'Workflow run wf-1 has terminal status COMPLETED; spawn_subagent_async is not allowed.',
          ),
        ),
    };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: [],
      },
      subagentOrchestrator: { spawn },
      terminalRunGuard: terminalRunGuard,
    });

    expect(terminalRunGuard.assertRunIsActive).toHaveBeenCalledWith('wf-1', {
      action: 'spawn_subagent_async',
      jobId: 'implement_and_commit',
      stepId: 'implement',
    });
    expect(spawn).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: false,
        error: expect.stringContaining('terminal status') as unknown,
        executionStatus: 'terminated',
      }),
    );
  });

  it('spawns normally when the terminal-run guard reports an active run', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      jobId: 'implement',
      containerId: 'container-1',
      emit: vi.fn(),
    } as any;

    const spawn = vi.fn().mockResolvedValue('exec-active');
    const terminalRunGuard = {
      assertRunIsActive: vi.fn().mockResolvedValue(undefined),
    };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: [],
      },
      subagentOrchestrator: { spawn },
      terminalRunGuard: terminalRunGuard,
    });

    expect(spawn).toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: true,
        execution_id: 'exec-active',
      }),
    );
  });
  it('allows subagent orchestration when called from chat session with valid context', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      jobId: 'implement',
      containerId: 'container-1',
      emit: vi.fn(),
    } as any;

    const spawn = vi.fn().mockResolvedValue('exec-1');

    const subagentOrchestrator = { spawn };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: ['read'],
        assigned_files: ['src/a.ts'],
        host_mounts: [
          {
            alias: 'skills_library',
            subpath: 'compose-mounted-skill',
            mode: 'ro',
          },
        ],
        inherit_host_mounts: false,
      },
      subagentOrchestrator,
    });

    expect(spawn).toHaveBeenCalledWith(
      'container-1',
      expect.objectContaining({
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        workflowRunId: 'wf-1',
        parent_job_id: 'implement',
        tier: 'heavy',
        host_mounts: [
          {
            alias: 'skills_library',
            subpath: 'compose-mounted-skill',
            mode: 'ro',
          },
        ],
        inherit_host_mounts: false,
      }),
    );
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: true,
        execution_id: 'exec-1',
      }),
    );
  });

  it('denies subagent orchestration when missing container context', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      containerId: undefined,
      emit: vi.fn(),
    } as any;

    const subagentOrchestrator = { spawn: vi.fn() };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: ['read'],
        assigned_files: ['src/a.ts'],
      },
      subagentOrchestrator,
    });

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: false,
        error: expect.stringContaining('missing container context'),
      }),
    );
  });

  it('denies subagent orchestration when missing workflow run context', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: undefined,
      containerId: 'container-1',
      emit: vi.fn(),
    } as any;

    const subagentOrchestrator = { spawn: vi.fn() };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: ['read'],
        assigned_files: ['src/a.ts'],
      },
      subagentOrchestrator,
    });

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: false,
        error: expect.stringContaining('missing workflow run context'),
      }),
    );
  });

  it('resolves missing container context and proceeds with subagent orchestration', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      jobId: 'implement_and_commit',
      stepId: 'implement',
      containerId: undefined,
      emit: vi.fn(),
    } as any;

    const spawn = vi.fn().mockResolvedValue('exec-2');
    const resolveContainerContext = vi
      .fn()
      .mockResolvedValue('container-recovered');

    const subagentOrchestrator = { spawn };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: ['read'],
        assigned_files: ['src/a.ts'],
      },
      subagentOrchestrator,
      resolveContainerContext,
    });

    expect(resolveContainerContext).toHaveBeenCalledWith({
      workflowRunId: 'wf-1',
      jobId: 'implement_and_commit',
      stepId: 'implement',
    });
    expect(spawn).toHaveBeenCalledWith(
      'container-recovered',
      expect.objectContaining({
        workflowRunId: 'wf-1',
        parent_job_id: 'implement_and_commit',
        tier: 'heavy',
      }),
    );
    expect(client.containerId).toBe('container-recovered');
  });

  it('denies subagent orchestration when fallback container resolution fails', async () => {
    const client = {
      role: 'agent',
      chatSessionId: 'chat-1',
      workflowRunId: 'wf-1',
      jobId: 'implement_and_commit',
      stepId: 'implement',
      containerId: undefined,
      emit: vi.fn(),
    } as any;

    const subagentOrchestrator = { spawn: vi.fn() };

    await handleSpawnSubagentAsyncCompat({
      client,
      payload: {
        agent_profile: 'architect-agent',
        task_prompt: 'Implement feature X',
        tools: ['read'],
        assigned_files: ['src/a.ts'],
      },
      subagentOrchestrator,
      resolveContainerContext: vi.fn().mockResolvedValue(null),
    });

    expect(subagentOrchestrator.spawn).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith(
      'command',
      expect.objectContaining({
        type: 'spawn_subagent_async_result',
        success: false,
        error: expect.stringContaining('missing container context'),
      }),
    );
  });
});
