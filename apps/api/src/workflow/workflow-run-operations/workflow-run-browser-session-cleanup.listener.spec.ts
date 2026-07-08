import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowRunBrowserSessionCleanupListener } from './workflow-run-browser-session-cleanup.listener';
import type { WorkflowRunEvent } from '../workflow-events.types';
import { WebAutomationSessionStoreService } from '../../web-automation/web-automation-session-store.service';

describe('WorkflowRunBrowserSessionCleanupListener', () => {
  const sessionStore = {
    closeRunSessions: vi.fn().mockResolvedValue(undefined),
  };

  let listener: WorkflowRunBrowserSessionCleanupListener;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = new WorkflowRunBrowserSessionCleanupListener(
      sessionStore as unknown as WebAutomationSessionStoreService,
    );
  });

  const event = (
    workflowRunId: string,
    status: WorkflowStatus,
  ): WorkflowRunEvent => ({
    workflowRunId,
    workflowId: 'wf-1',
    status,
    stateVariables: {},
  });

  it('closes run browser sessions on COMPLETED status', async () => {
    await listener.handleWorkflowRunTerminated(
      event('run-1', WorkflowStatus.COMPLETED),
    );

    expect(sessionStore.closeRunSessions).toHaveBeenCalledWith('run-1');
  });

  it('closes run browser sessions on FAILED status', async () => {
    await listener.handleWorkflowRunTerminated(
      event('run-2', WorkflowStatus.FAILED),
    );

    expect(sessionStore.closeRunSessions).toHaveBeenCalledWith('run-2');
  });

  it('closes run browser sessions on CANCELLED status', async () => {
    await listener.handleWorkflowRunTerminated(
      event('run-3', WorkflowStatus.CANCELLED),
    );

    expect(sessionStore.closeRunSessions).toHaveBeenCalledWith('run-3');
  });
});
