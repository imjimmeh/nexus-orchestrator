import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IWorkflowStep } from '@nexus/core';
import { StepSpecialStepExecutorService } from './step-special-step-executor.service';
import { createStepSpecialStepExecutorTestFixture } from './step-special-step-executor.test-fixture';

type StepSpecialStepExecutorTestFixture = Awaited<
  ReturnType<typeof createStepSpecialStepExecutorTestFixture>
>;

describe('StepSpecialStepExecutorService', () => {
  let service: StepSpecialStepExecutorService;
  let registry: StepSpecialStepExecutorTestFixture['registry'];
  let workflowEngine: StepSpecialStepExecutorTestFixture['workflowEngine'];
  let workflowRepoFindAll: StepSpecialStepExecutorTestFixture['workflowRepoFindAll'];
  let mergeWithConflictDetectionMock: StepSpecialStepExecutorTestFixture['mergeWithConflictDetectionMock'];
  let runRepoFindById: StepSpecialStepExecutorTestFixture['runRepoFindById'];
  let listRemoteBranchesMock: StepSpecialStepExecutorTestFixture['listRemoteBranchesMock'];
  let manageToolCandidateExecuteMock: StepSpecialStepExecutorTestFixture['manageToolCandidateExecuteMock'];
  let webAutomationExecuteMock: StepSpecialStepExecutorTestFixture['webAutomationExecuteMock'];
  let mcpToolCallExecuteMock: StepSpecialStepExecutorTestFixture['mcpToolCallExecuteMock'];
  beforeEach(async () => {
    const fixture = await createStepSpecialStepExecutorTestFixture();
    service = fixture.service;
    registry = fixture.registry;
    workflowEngine = fixture.workflowEngine;
    workflowRepoFindAll = fixture.workflowRepoFindAll;
    mergeWithConflictDetectionMock = fixture.mergeWithConflictDetectionMock;
    runRepoFindById = fixture.runRepoFindById;
    listRemoteBranchesMock = fixture.listRemoteBranchesMock;
    manageToolCandidateExecuteMock = fixture.manageToolCandidateExecuteMock;
    webAutomationExecuteMock = fixture.webAutomationExecuteMock;
    mcpToolCallExecuteMock = fixture.mcpToolCallExecuteMock;
  });
  it('registers tool for register_tool step', async () => {
    const result = await service.executeSpecialStep(
      'run-1',
      'register-1',
      {
        id: 'register-1',
        type: 'register_tool',
        tier: 'light',
      },
      {
        name: 't1',
        schema: { type: 'object' },
        typescript_code: 'export const tool = {}',
      },
    );
    expect(result).toEqual({
      status: 'completed',
      mode: 'tool_registration',
      toolId: 'tool-1',
    });
  });
  it('invokes child workflow for invoke_workflow step', async () => {
    const result = await service.executeSpecialStep(
      'run-1',
      'invoke-1',
      {
        id: 'invoke-1',
        type: 'invoke_workflow',
        tier: 'light',
        workflow_id: 'child-workflow-1',
      },
      {},
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'child-workflow-1',
      expect.objectContaining({
        parentWorkflowRunId: 'run-1',
        parentStepId: 'invoke-1',
      }),
    );
    expect(result).toEqual({
      status: 'completed',
      mode: 'workflow_invocation',
      childRunId: 'child-run-1',
    });
  });

  it('fails invoke_workflow when concurrency policy skips the child run', async () => {
    workflowEngine.startWorkflow.mockResolvedValueOnce(null);

    await expect(
      service.executeSpecialStep(
        'run-1',
        'invoke-1',
        {
          id: 'invoke-1',
          type: 'invoke_workflow',
          tier: 'light',
          workflow_id: 'child-workflow-1',
        },
        {},
      ),
    ).rejects.toThrow(
      'Step invoke-1 could not start child workflow child-workflow-1 because concurrency policy skipped the invocation',
    );
    expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
  });

  it('continues invoke_workflow concurrency skips when explicitly configured', async () => {
    workflowEngine.startWorkflow.mockResolvedValueOnce(null);

    const result = await service.executeSpecialStep(
      'run-1',
      'invoke-1',
      {
        id: 'invoke-1',
        type: 'invoke_workflow',
        tier: 'light',
        workflow_id: 'child-workflow-1',
        continue_on_concurrency_skip: true,
      },
      {},
    );

    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'invoke-1',
      expect.objectContaining({
        ok: false,
        childWorkflowStatus: 'SKIPPED',
        reason: 'concurrency_policy',
      }),
    );
    expect(result).toEqual({
      status: 'completed',
      mode: 'workflow_invocation',
      childRunId: '',
    });
  });

  it('resolves symbolic workflow_id to workflow UUID before invocation', async () => {
    workflowRepoFindAll.mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Project Discovery (CEO)',
        yaml_definition:
          'workflow_id: project_discovery_ceo\nname: Project Discovery (CEO)',
      },
    ]);

    await service.executeSpecialStep(
      'run-1',
      'invoke-discovery',
      {
        id: 'invoke-discovery',
        type: 'invoke_workflow',
        tier: 'light',
        workflow_id: 'project_discovery_ceo',
      },
      {},
    );

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        parentWorkflowRunId: 'run-1',
        parentStepId: 'invoke-discovery',
      }),
    );
  });
  it('executes manage_tool_candidate validate action via handler', async () => {
    manageToolCandidateExecuteMock.mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'validate',
        artifactId: 'artifact-1',
      },
      output: {
        ok: true,
        action: 'validate',
        artifact_id: 'artifact-1',
        validation_run_id: 'run-1',
        validation_status: 'passed',
      },
    });
    const result = await service.executeSpecialStep(
      'run-1',
      'validate-1',
      {
        id: 'validate-1',
        type: 'manage_tool_candidate',
        tier: 'light',
      },
      { action: 'validate', artifact_id: 'artifact-1' },
    );
    expect(manageToolCandidateExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        stepId: 'validate-1',
      }),
    );
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'validate-1',
      expect.objectContaining({
        ok: true,
        artifact_id: 'artifact-1',
        validation_status: 'passed',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'manage_tool_candidate',
        action: 'validate',
        artifactId: 'artifact-1',
      }),
    );
  });
  it('executes manage_tool_candidate publish action via handler', async () => {
    manageToolCandidateExecuteMock.mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'manage_tool_candidate',
        action: 'publish',
        artifactId: 'artifact-2',
      },
      output: {
        ok: true,
        action: 'publish',
        artifact_id: 'artifact-2',
        tool_name: 'query_memory',
        published_version: 4,
      },
    });

    const result = await service.executeSpecialStep(
      'run-2',
      'publish-1',
      {
        id: 'publish-1',
        type: 'manage_tool_candidate',
        tier: 'light',
      },
      { action: 'publish', artifact_id: 'artifact-2' },
    );

    expect(manageToolCandidateExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-2',
        stepId: 'publish-1',
      }),
    );
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-2',
      'publish-1',
      expect.objectContaining({
        ok: true,
        tool_name: 'query_memory',
        published_version: 4,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        mode: 'manage_tool_candidate',
        action: 'publish',
        artifactId: 'artifact-2',
      }),
    );
  });

  it('executes web_automation special step via handler', async () => {
    webAutomationExecuteMock.mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'web_automation',
        action: 'click',
        success: false,
        artifactId: 'artifact-web-1',
        sessionId: 'default',
      },
      output: {
        ok: false,
        action: 'click',
        failure_artifact_id: 'artifact-web-1',
      },
    });

    const result = await service.executeSpecialStep(
      'run-web-1',
      'web-step-1',
      {
        id: 'web-step-1',
        type: 'web_automation',
        tier: 'light',
      },
      {
        action: 'click',
        selector_alias: 'primary_button',
      },
    );

    expect(webAutomationExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-web-1',
        stepId: 'web-step-1',
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        mode: 'web_automation',
        success: false,
        artifactId: 'artifact-web-1',
      }),
    );
  });

  it('executes a plugin handler registered on the special step registry', async () => {
    const pluginResult = {
      status: 'completed',
      source: 'plugin',
      mode: 'acme.send_webhook',
      webhookId: 'wh_1',
    } as const;
    const pluginOutput = { ok: true, webhook_id: 'wh_1' };
    const execute = vi.fn().mockResolvedValue({
      result: pluginResult,
      output: pluginOutput,
    });

    registry.registerPluginHandler({
      type: 'acme.send_webhook',
      descriptor: {
        type: 'acme.send_webhook',
        owningDomain: 'plugin',
        pluginId: 'com.acme.webhooks',
        inputContract: 'inputs.url and inputs.payload are required',
      },
      execute,
    });

    const result = await service.executeSpecialStep(
      'run-plugin-1',
      'notify',
      {
        id: 'notify',
        type: 'acme.send_webhook',
        tier: 'light',
      },
      { url: 'https://hooks.example.test', payload: { event: 'created' } },
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-plugin-1',
        stepId: 'notify',
        resolvedStepInputs: {
          url: 'https://hooks.example.test',
          payload: { event: 'created' },
        },
      }),
    );
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-plugin-1',
      'notify',
      pluginOutput,
    );
    expect(result).toEqual(pluginResult);
  });

  describe('git_operation merge action', () => {
    const triggerData = {
      trigger: {
        git: {
          repository_id: 'project-1',
          worktree_id: 'resource-1',
          base_branch: 'main',
          target_branch: 'feature/resource-1',
        },
      },
    };

    it('outputs succeeded on clean merge', async () => {
      runRepoFindById.mockResolvedValue({
        id: 'run-1',
        state_variables: triggerData,
      });
      mergeWithConflictDetectionMock.mockResolvedValue({
        outcome: 'succeeded',
        sourceBranch: 'feature/resource-1',
        destinationBranch: 'main',
        conflictedFiles: [],
        message: 'Successfully merged',
      });

      const result = await service.executeSpecialStep(
        'run-1',
        'attempt-merge',
        {
          id: 'attempt-merge',
          type: 'git_operation',
          tier: 'light',
        },
        { action: 'merge' },
      );

      expect(mergeWithConflictDetectionMock).toHaveBeenCalledWith(
        'project-1',
        'feature/resource-1',
        'main',
        '/workspace',
      );
      expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
        'run-1',
        'attempt-merge',
        expect.objectContaining({
          ok: true,
          action: 'merge',
          merge_outcome: 'succeeded',
          base_branch: 'main',
          target_branch: 'feature/resource-1',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          mode: 'git_operation',
          action: 'merge',
        }),
      );
    });

    it('outputs conflict on merge conflict', async () => {
      runRepoFindById.mockResolvedValue({
        id: 'run-1',
        state_variables: triggerData,
      });
      mergeWithConflictDetectionMock.mockResolvedValue({
        outcome: 'conflict',
        sourceBranch: 'feature/resource-1',
        destinationBranch: 'main',
        conflictedFiles: ['src/app.ts', 'src/index.ts'],
        message: 'Merge conflicts detected in 2 file(s)',
      });

      const result = await service.executeSpecialStep(
        'run-1',
        'attempt-merge',
        {
          id: 'attempt-merge',
          type: 'git_operation',
          tier: 'light',
        },
        { action: 'merge' },
      );

      expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
        'run-1',
        'attempt-merge',
        expect.objectContaining({
          ok: false,
          action: 'merge',
          merge_outcome: 'conflict',
          base_branch: 'main',
          target_branch: 'feature/resource-1',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          mode: 'git_operation',
          action: 'merge',
        }),
      );
    });

    it('outputs failed on non-conflict error', async () => {
      runRepoFindById.mockResolvedValue({
        id: 'run-1',
        state_variables: triggerData,
      });
      mergeWithConflictDetectionMock.mockResolvedValue({
        outcome: 'failed',
        sourceBranch: 'feature/resource-1',
        destinationBranch: 'main',
        conflictedFiles: [],
        message: 'fatal: not a git repository',
      });

      const result = await service.executeSpecialStep(
        'run-1',
        'attempt-merge',
        {
          id: 'attempt-merge',
          type: 'git_operation',
          tier: 'light',
        },
        { action: 'merge' },
      );

      expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
        'run-1',
        'attempt-merge',
        expect.objectContaining({
          ok: false,
          action: 'merge',
          merge_outcome: 'failed',
          base_branch: 'main',
          target_branch: 'feature/resource-1',
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({
          status: 'completed',
          mode: 'git_operation',
          action: 'merge',
        }),
      );
    });

    it('throws when generic repository context is missing', async () => {
      runRepoFindById.mockResolvedValue({
        id: 'run-1',
        state_variables: { trigger: {} },
      });

      await expect(
        service.executeSpecialStep(
          'run-1',
          'attempt-merge',
          {
            id: 'attempt-merge',
            type: 'git_operation',
            tier: 'light',
          },
          { action: 'merge' },
        ),
      ).rejects.toThrow(
        'git_operation requires inputs.repository_id or trigger.git.repository_id',
      );
    });

    it('falls back to inferred base branch when generic context omits base branch', async () => {
      runRepoFindById.mockResolvedValue({
        id: 'run-1',
        state_variables: {
          trigger: {
            git: {
              repository_id: 'project-1',
              worktree_id: 'resource-1',
            },
          },
        },
      });
      listRemoteBranchesMock.mockResolvedValue(['master']);
      mergeWithConflictDetectionMock.mockResolvedValue({
        outcome: 'succeeded',
        sourceBranch: 'feature/resource-1',
        destinationBranch: 'master',
        conflictedFiles: [],
        message: 'Successfully merged',
      });

      await service.executeSpecialStep(
        'run-1',
        'attempt-merge',
        {
          id: 'attempt-merge',
          type: 'git_operation',
          tier: 'light',
        },
        { action: 'merge', target_branch: 'feature/resource-1' },
      );

      expect(mergeWithConflictDetectionMock).toHaveBeenCalledWith(
        'project-1',
        'feature/resource-1',
        'main',
        '/workspace',
      );
    });

    it('returns null for unknown step types', async () => {
      const result = await service.executeSpecialStep(
        'run-1',
        'custom-step',
        {
          id: 'custom-step',
          type: 'execution',
          tier: 'light',
        },
        {},
      );

      expect(result).toBeNull();
    });
  });

  it('for_each step resolves item.* templates independently per iteration', async () => {
    const items = [
      { id: 'subtask-1', title: 'First subtask' },
      { id: 'subtask-2', title: 'Second subtask' },
    ];
    const templateVariables = { jobs: { upstream: { output: { items } } } };

    const step = {
      id: 'materialize',
      type: 'mcp_tool_call',
      tier: 'light',
      for_each: '{{ jobs.upstream.output.items }}',
      inputs: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_subtask_upsert',
        params: {
          subtask_id: '{{ item.id }}',
          title: '{{ item.title }}',
        },
        policy: {
          allowed_servers: ['external-mcp'],
          allowed_tools: ['external.*'],
        },
      },
    } as unknown as IWorkflowStep;

    await service.executeSpecialStep(
      'run-1',
      'materialize',
      step,
      {},
      templateVariables,
    );

    expect(mcpToolCallExecuteMock).toHaveBeenCalledTimes(2);
    expect(mcpToolCallExecuteMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({
            subtask_id: 'subtask-1',
            title: 'First subtask',
          }),
        }),
      }),
    );
    expect(mcpToolCallExecuteMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({
            subtask_id: 'subtask-2',
            title: 'Second subtask',
          }),
        }),
      }),
    );
  });

  it('for_each tolerates a {item:[...]} XML-array artifact from upstream output', async () => {
    const templateVariables = {
      jobs: {
        upstream: {
          output: {
            items: {
              item: [
                { id: 'subtask-1', title: 'First subtask' },
                { id: 'subtask-2', title: 'Second subtask' },
              ],
            },
          },
        },
      },
    };

    const step = {
      id: 'materialize',
      type: 'mcp_tool_call',
      tier: 'light',
      for_each: '{{ jobs.upstream.output.items }}',
      inputs: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_subtask_upsert',
        params: {
          subtask_id: '{{ item.id }}',
          title: '{{ item.title }}',
        },
        policy: {
          allowed_servers: ['external-mcp'],
          allowed_tools: ['external.*'],
        },
      },
    } as unknown as IWorkflowStep;

    await service.executeSpecialStep(
      'run-1',
      'materialize',
      step,
      {},
      templateVariables,
    );

    expect(mcpToolCallExecuteMock).toHaveBeenCalledTimes(2);
    expect(mcpToolCallExecuteMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({ subtask_id: 'subtask-1' }),
        }),
      }),
    );
  });
});
