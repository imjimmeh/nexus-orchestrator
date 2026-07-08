import { buildWorkflowRunRequestV1 } from './workflow-run-request.contract';

describe('buildWorkflowRunRequestV1', () => {
  it('builds a schema-valid workflow run request', () => {
    const request = buildWorkflowRunRequestV1({
      workflow_id: 'workflow-1',
      input: {
        objective: 'Ship split-service contracts',
      },
      launch_source: 'manual',
      context: {
        scopeId: 'project-1',
        contextId: 'project-1',
        contextType: 'scope',
        scopeNodeId: null,
        scopePath: null,
        metadata: { contextId: 'resource-1' },
      },
      requested_by: 'tester',
      correlation_id: 'corr-1',
    });

    expect(request).toEqual({
      workflow_id: 'workflow-1',
      input: {
        objective: 'Ship split-service contracts',
      },
      launch_source: 'manual',
      context: {
        scopeId: 'project-1',
        contextId: 'project-1',
        contextType: 'scope',
        metadata: { contextId: 'resource-1' },
        scopeNodeId: null,
        scopePath: null,
      },
      metadata: {
        correlation_id: 'corr-1',
        causation_id: null,
        idempotency_key: null,
        requested_by: 'tester',
      },
    });
  });

  it('throws when workflow_id is empty', () => {
    expect(() =>
      buildWorkflowRunRequestV1({
        workflow_id: ' ',
        input: {},
        launch_source: 'manual',
      }),
    ).toThrow();
  });
});
