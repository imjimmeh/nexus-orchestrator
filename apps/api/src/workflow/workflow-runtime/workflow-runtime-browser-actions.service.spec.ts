import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntimeBrowserActionsService } from './workflow-runtime-browser-actions.service';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import { WebAutomationActionExecutorService } from '../../web-automation/web-automation-action-executor.service';
import { WebAutomationSessionStoreService } from '../../web-automation/web-automation-session-store.service';
import { WebAutomationArtifactQueryService } from '../../web-automation/web-automation-artifact-query.service';
import { WorkflowEventLogService } from '../workflow-event-log.service';

describe('WorkflowRuntimeBrowserActionsService', () => {
  const capabilityExecutor = {
    execute: vi.fn(),
  };

  const webAutomationExecutor = {
    execute: vi.fn(),
  };

  const sessionStore = {
    closeSession: vi.fn(),
  };

  const artifactQuery = {
    listRunArtifacts: vi.fn(),
    getRunArtifact: vi.fn(),
  };

  const workflowEventLog = {
    appendBestEffort: vi.fn().mockResolvedValue(undefined),
  };

  let service: WorkflowRuntimeBrowserActionsService;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BROWSER_RUNTIME_ALLOWED_DOMAINS;
    delete process.env.BROWSER_RUNTIME_DENIED_DOMAINS;

    capabilityExecutor.execute.mockImplementation(
      async (params: { execute: () => Promise<Record<string, unknown>> }) =>
        params.execute(),
    );

    service = new WorkflowRuntimeBrowserActionsService(
      capabilityExecutor as unknown as WorkflowRuntimeCapabilityExecutorService,
      webAutomationExecutor as unknown as WebAutomationActionExecutorService,
      sessionStore as unknown as WebAutomationSessionStoreService,
      artifactQuery as unknown as WebAutomationArtifactQueryService,
      workflowEventLog as unknown as WorkflowEventLogService,
    );
  });

  it('executes open_page via web automation executor and appends success event', async () => {
    webAutomationExecutor.execute.mockResolvedValue({
      ok: true,
      action: 'open_page',
      session_id: 'default',
      attempts: [],
      current_url: 'https://example.com',
    });

    const result = await service.openPage({
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
      url: 'https://example.com',
    });

    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'browser_open_page',
        context: expect.objectContaining({
          workflow_run_id: 'run-1',
          job_id: 'job-1',
        }),
      }),
    );
    expect(webAutomationExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        stepId: 'job-1.runtime.open_page',
      }),
    );
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        eventType: 'runtime.browser_action.succeeded',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'open_page',
      }),
    );
  });

  it('blocks navigate when url host is outside allowlist', async () => {
    process.env.BROWSER_RUNTIME_ALLOWED_DOMAINS = 'allowed.example.com';

    const result = await service.navigate({
      workflow_run_id: 'run-2',
      job_id: 'job-2',
      user: { userId: 'agent:run-2:job-2', roles: ['Agent'] },
      url: 'https://blocked.example.com/page',
    });

    expect(webAutomationExecutor.execute).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        action: 'navigate',
      }),
    );
    const errorMessage = (result as { error?: string }).error;
    expect(errorMessage).toContain('allowlist rejected host');
    expect(workflowEventLog.appendBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'runtime.browser_action.failed',
      }),
    );
  });

  it('resolves workflow run context from agent token when workflow_run_id is omitted', async () => {
    webAutomationExecutor.execute.mockResolvedValue({
      ok: true,
      action: 'read_page',
      session_id: 'default',
      attempts: [],
      current_url: 'https://example.com',
      title: 'Example',
      html: '<html></html>',
    });

    await service.readPage({
      user: { userId: 'agent:run-token:job-token', roles: ['Agent'] },
    });

    expect(webAutomationExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-token',
        stepId: 'job-token.runtime.read_page',
      }),
    );
  });

  it('closes runtime browser session explicitly', async () => {
    sessionStore.closeSession.mockResolvedValue(true);

    const result = await service.closePage({
      workflow_run_id: 'run-3',
      job_id: 'job-3',
      session_id: 'auth',
      user: { userId: 'agent:run-3:job-3', roles: ['Agent'] },
    });

    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'browser_close_page',
      }),
    );
    expect(sessionStore.closeSession).toHaveBeenCalledWith('run-3', 'auth');
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        action: 'close_page',
        closed: true,
      }),
    );
  });

  it('lists failure artifacts with bounded pagination defaults', async () => {
    artifactQuery.listRunArtifacts.mockResolvedValue({
      data: [{ id: 'artifact-1' }],
      total: 1,
    });

    const result = await service.listFailureArtifacts({
      workflow_run_id: 'run-4',
      user: { userId: 'agent:run-4:job-4', roles: ['Agent'] },
    });

    expect(capabilityExecutor.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'browser_list_failure_artifacts',
      }),
    );
    expect(artifactQuery.listRunArtifacts).toHaveBeenCalledWith('run-4', 20, 0);
    expect(result).toEqual(
      expect.objectContaining({
        workflow_run_id: 'run-4',
        count: 1,
        total: 1,
      }),
    );
  });

  it('throws for missing artifact_id when loading detailed failure artifact', async () => {
    await expect(
      service.getFailureArtifact({
        workflow_run_id: 'run-5',
        artifact_id: '  ',
        user: { userId: 'agent:run-5:job-5', roles: ['Agent'] },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(capabilityExecutor.execute).not.toHaveBeenCalled();
  });
});
