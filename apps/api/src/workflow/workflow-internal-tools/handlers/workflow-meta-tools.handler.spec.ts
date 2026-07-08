import { describe, expect, it, vi } from 'vitest';
import { WorkflowMetaToolsHandler } from './workflow-meta-tools.handler';

describe('WorkflowMetaToolsHandler', () => {
  it('readWorkflowSummary includes optional agent_profile when present', async () => {
    const workflowPersistence = {
      getWorkflow: vi.fn().mockResolvedValue({
        workflow_id: 'wf-1',
        name: 'Test workflow',
        trigger: { type: 'manual' },
        jobs: [
          {
            id: 'job-1',
            type: 'execution',
            tier: 'heavy',
            steps: [],
            agent_profile: 'qa-reviewer',
          },
          {
            id: 'job-2',
            type: 'execution',
            tier: 'light',
            steps: [],
          },
        ],
      }),
    };

    const handler = new WorkflowMetaToolsHandler(workflowPersistence as never);

    const result = await handler.readWorkflowSummary('wf-1');
    const jobs = (result.workflow as { jobs: Array<Record<string, unknown>> })
      .jobs;

    expect(jobs[0]?.agent_profile).toBe('qa-reviewer');
    expect(jobs[1]?.agent_profile).toBeUndefined();
  });
});
