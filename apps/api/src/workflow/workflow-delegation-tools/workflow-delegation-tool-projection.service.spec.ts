import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityRegistrarService } from '../../tool-registry/capability-registrar.service';
import { WorkflowRuntimeOrchestrationActionsService } from '../workflow-runtime/workflow-runtime-orchestration-actions.service';
import { WorkflowRuntimeAwaitActionsService } from '../workflow-runtime/workflow-runtime-await-actions.service';
import { WorkflowDelegationToolProjectionService } from './workflow-delegation-tool-projection.service';

describe('WorkflowDelegationToolProjectionService', () => {
  const previousSeedDir = process.env.WORKFLOW_DELEGATION_TOOLS_SEED_DIR;
  let seedDir: string;
  let registrar: { registerToolProjection: ReturnType<typeof vi.fn> };
  let actions: { invokeAgentWorkflow: ReturnType<typeof vi.fn> };
  let awaitActions: {
    startAwaitedInvocationWorkflows: ReturnType<typeof vi.fn>;
  };
  const previousAwaitFlag = process.env.ORCHESTRATION_AWAIT_ENABLED;

  beforeEach(() => {
    seedDir = mkdtempSync(path.join(tmpdir(), 'workflow-delegation-tools-'));
    process.env.WORKFLOW_DELEGATION_TOOLS_SEED_DIR = seedDir;
    registrar = {
      registerToolProjection: vi.fn().mockResolvedValue({ id: 'tool-1' }),
    };
    actions = {
      invokeAgentWorkflow: vi
        .fn()
        .mockResolvedValue({ ok: true, runId: 'run-child' }),
    };
    awaitActions = {
      startAwaitedInvocationWorkflows: vi.fn().mockResolvedValue({
        ok: true,
        requestedAction: 'await_agent_workflow',
        executionStatus: 'suspended',
        awaitId: 'await-1',
        awaitedRunIds: ['run-child'],
      }),
    };
  });

  afterEach(() => {
    rmSync(seedDir, { recursive: true, force: true });
    if (previousSeedDir === undefined) {
      delete process.env.WORKFLOW_DELEGATION_TOOLS_SEED_DIR;
    } else {
      process.env.WORKFLOW_DELEGATION_TOOLS_SEED_DIR = previousSeedDir;
    }
    if (previousAwaitFlag === undefined) {
      delete process.env.ORCHESTRATION_AWAIT_ENABLED;
    } else {
      process.env.ORCHESTRATION_AWAIT_ENABLED = previousAwaitFlag;
    }
  });

  function writeConfig() {
    writeFileSync(
      path.join(seedDir, 'test.delegations.json'),
      JSON.stringify({
        tools: [
          {
            id: 'ceo.goal_backlog',
            enabled: true,
            tool_name: 'delegate_goal_backlog_planning',
            description: 'Launch goal backlog planning.',
            workflow_id: 'project_goal_backlog_planning',
            tier_restriction: 1,
            input_schema: {
              type: 'object',
              properties: {
                reason: { type: 'string' },
                goals: { type: 'array', items: { type: 'string' } },
                trigger_data: { type: 'object' },
              },
              required: ['reason'],
            },
            fixed_trigger_data: { selectedRoute: 'goal-backlog' },
            trigger_data_fields: ['goals'],
          },
          {
            id: 'disabled',
            enabled: false,
            tool_name: 'delegate_disabled',
            description: 'Disabled.',
            workflow_id: 'disabled_workflow',
            input_schema: { type: 'object', properties: {} },
          },
        ],
      }),
      'utf8',
    );
  }

  it('projects enabled definitions with description, metadata, source, and api callback', async () => {
    writeConfig();
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );

    const results = await service.projectEnabledTools();

    expect(results).toEqual([
      {
        toolName: 'delegate_goal_backlog_planning',
        workflowId: 'project_goal_backlog_planning',
        status: 'projected',
      },
      {
        toolName: 'delegate_disabled',
        workflowId: 'disabled_workflow',
        status: 'skipped',
        reason: 'disabled',
      },
    ]);
    expect(registrar.registerToolProjection).toHaveBeenCalledWith({
      tool: expect.objectContaining({
        name: 'delegate_goal_backlog_planning',
        description: 'Launch goal backlog planning.',
        metadata: {
          source: 'workflow_delegation_projection',
          projection_id: 'ceo.goal_backlog',
          workflow_id: 'project_goal_backlog_planning',
        },
        runtime_owner: 'api',
        transport: 'api_callback',
        publication_status: 'published',
        api_callback: expect.objectContaining({
          method: 'POST',
          path_template:
            '/api/workflow-runtime/orchestration/projected-workflow-delegations/delegate_goal_backlog_planning/invoke',
          body_mapping: {
            reason: 'reason',
            goals: 'goals',
            trigger_data: 'trigger_data',
          },
        }),
      }),
      source: 'manual',
      sourceMetadata: {
        source: 'workflow_delegation_projection',
        projection_id: 'ceo.goal_backlog',
        workflow_id: 'project_goal_backlog_planning',
      },
    });
  });

  describe('feature flag gating', () => {
    const FLAG = 'DESIGN_INGESTION_WORKFLOWS_ENABLED';
    const previousFlag = process.env[FLAG];

    function writeFeatureFlaggedConfig() {
      writeFileSync(
        path.join(seedDir, 'flagged.delegations.json'),
        JSON.stringify({
          tools: [
            {
              id: 'ceo.design_ingestion',
              enabled: true,
              feature_flag: FLAG,
              tool_name: 'delegate_design_ingestion',
              description: 'Delegate design ingestion.',
              workflow_id: 'design_ingestion_new_project',
              tier_restriction: 1,
              input_schema: {
                type: 'object',
                properties: { reason: { type: 'string' } },
                required: ['reason'],
              },
            },
          ],
        }),
        'utf8',
      );
    }

    afterEach(() => {
      if (previousFlag === undefined) {
        Reflect.deleteProperty(process.env, FLAG);
      } else {
        process.env[FLAG] = previousFlag;
      }
    });

    it('projects delegate_design_ingestion when feature flag env var is true', async () => {
      process.env[FLAG] = 'true';
      writeFeatureFlaggedConfig();
      const service = new WorkflowDelegationToolProjectionService(
        registrar as unknown as CapabilityRegistrarService,
        actions as unknown as WorkflowRuntimeOrchestrationActionsService,
        awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
      );
      const results = await service.projectEnabledTools();
      const tool = results.find(
        (r) => r.toolName === 'delegate_design_ingestion',
      );
      expect(tool?.status).toBe('projected');
    });

    it('skips delegate_design_ingestion when feature flag env var is absent', async () => {
      Reflect.deleteProperty(process.env, FLAG);
      writeFeatureFlaggedConfig();
      const service = new WorkflowDelegationToolProjectionService(
        registrar as unknown as CapabilityRegistrarService,
        actions as unknown as WorkflowRuntimeOrchestrationActionsService,
        awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
      );
      const results = await service.projectEnabledTools();
      const tool = results.find(
        (r) => r.toolName === 'delegate_design_ingestion',
      );
      expect(tool?.status).toBe('skipped');
      expect(tool?.reason).toBe('feature_flag_disabled');
    });
  });

  it('invokes configured workflow and ignores body workflow_id and fixed trigger overrides', async () => {
    writeConfig();
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    const result = await service.invokeProjectedDelegation(
      'delegate_goal_backlog_planning',
      {
        workflow_id: 'malicious',
        reason: 'Need backlog',
        goals: ['Goal A'],
        trigger_data: { extra: true, selectedRoute: 'malicious-route' },
      },
      'run-parent',
    );

    expect(result).toEqual({ ok: true, runId: 'run-child' });
    expect(actions.invokeAgentWorkflow).toHaveBeenCalledWith({
      workflow_id: 'project_goal_backlog_planning',
      workflow_run_id: 'run-parent',
      reason: 'Need backlog',
      trigger_data: {
        extra: true,
        goals: ['Goal A'],
        selectedRoute: 'goal-backlog',
      },
    });
    expect(awaitActions.startAwaitedInvocationWorkflows).not.toHaveBeenCalled();
  });

  it('durably awaits the delegation when await is enabled and a calling step is known', async () => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;
    writeConfig();
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    const result = await service.invokeProjectedDelegation(
      'delegate_goal_backlog_planning',
      {
        reason: 'Need backlog',
        goals: ['Goal A'],
        trigger_data: { extra: true },
      },
      'run-parent',
      'decide',
    );

    expect(actions.invokeAgentWorkflow).not.toHaveBeenCalled();
    expect(awaitActions.startAwaitedInvocationWorkflows).toHaveBeenCalledWith({
      workflow_id: 'project_goal_backlog_planning',
      workflow_run_id: 'run-parent',
      step_id: 'decide',
      inputs: {
        extra: true,
        goals: ['Goal A'],
        selectedRoute: 'goal-backlog',
        reason: 'Need backlog',
      },
    });
    expect(result).toEqual({
      ok: true,
      requestedAction: 'await_agent_workflow',
      executionStatus: 'suspended',
      awaitId: 'await-1',
      awaitedRunIds: ['run-child'],
    });
  });

  it('falls back to fire-and-forget invoke when durable await is disabled', async () => {
    process.env.ORCHESTRATION_AWAIT_ENABLED = 'false';
    writeConfig();
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    await service.invokeProjectedDelegation(
      'delegate_goal_backlog_planning',
      { reason: 'Need backlog', goals: ['Goal A'] },
      'run-parent',
      'decide',
    );

    expect(awaitActions.startAwaitedInvocationWorkflows).not.toHaveBeenCalled();
    expect(actions.invokeAgentWorkflow).toHaveBeenCalled();
  });

  it('uses fire-and-forget invoke when no calling step can be resolved', async () => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;
    writeConfig();
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    await service.invokeProjectedDelegation(
      'delegate_goal_backlog_planning',
      { reason: 'Need backlog', goals: ['Goal A'] },
      'run-parent',
    );

    expect(awaitActions.startAwaitedInvocationWorkflows).not.toHaveBeenCalled();
    expect(actions.invokeAgentWorkflow).toHaveBeenCalled();
  });

  it('durably awaits delegate_rediscovery and forwards refresh mode', async () => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;
    writeFileSync(
      path.join(seedDir, 'rediscovery.delegations.json'),
      JSON.stringify({
        tools: [
          {
            id: 'ceo.rediscovery',
            enabled: true,
            tool_name: 'delegate_rediscovery',
            description: 'Launch delta-aware re-discovery.',
            workflow_id: 'project_codebase_deep_investigation',
            tier_restriction: 1,
            fixed_trigger_data: { mode: 'refresh' },
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reason: { type: 'string' },
                trigger_data: { type: 'object' },
              },
              required: ['reason'],
            },
            trigger_data_fields: [],
          },
        ],
      }),
      'utf8',
    );
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    // NOTE: The CEO calls delegate_rediscovery from the strategize step
    // (before synthesizing, per Task 8). Pass step_id: "strategize" to match
    // the actual calling step in the CEO cycle workflow.
    await service.invokeProjectedDelegation(
      'delegate_rediscovery',
      { reason: 'Capability map drifted' },
      'run-parent',
      'strategize',
    );

    expect(actions.invokeAgentWorkflow).not.toHaveBeenCalled();
    // The durable-await path sends workflow_run_id (snake_case) to
    // startAwaitedInvocationWorkflows — confirmed in the production service.
    expect(awaitActions.startAwaitedInvocationWorkflows).toHaveBeenCalledWith({
      workflow_id: 'project_codebase_deep_investigation',
      workflow_run_id: 'run-parent',
      step_id: 'strategize',
      inputs: {
        mode: 'refresh',
        reason: 'Capability map drifted',
      },
    });
  });

  it('durably awaits delegate_roadmap_planning to project_roadmap_planning', async () => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;
    writeFileSync(
      path.join(seedDir, 'roadmap.delegations.json'),
      JSON.stringify({
        tools: [
          {
            id: 'ceo.roadmap_planning',
            enabled: true,
            tool_name: 'delegate_roadmap_planning',
            description:
              'Launch roadmap planning for the current project scope.',
            workflow_id: 'project_roadmap_planning',
            tier_restriction: 1,
            input_schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                reason: { type: 'string' },
                goals: { type: 'array', items: { type: 'string' } },
                trigger_data: { type: 'object' },
              },
              required: ['reason'],
            },
            trigger_data_fields: ['goals'],
          },
        ],
      }),
      'utf8',
    );
    const service = new WorkflowDelegationToolProjectionService(
      registrar as unknown as CapabilityRegistrarService,
      actions as unknown as WorkflowRuntimeOrchestrationActionsService,
      awaitActions as unknown as WorkflowRuntimeAwaitActionsService,
    );
    await service.projectEnabledTools();

    await service.invokeProjectedDelegation(
      'delegate_roadmap_planning',
      { reason: 'horizons stale', goals: ['Goal A'] },
      'run-parent',
      'strategize',
    );

    expect(actions.invokeAgentWorkflow).not.toHaveBeenCalled();
    expect(awaitActions.startAwaitedInvocationWorkflows).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_id: 'project_roadmap_planning',
        workflow_run_id: 'run-parent',
        step_id: 'strategize',
      }),
    );
  });

  it('the real CEO delegations seed declares delegate_roadmap_planning', () => {
    const real = JSON.parse(
      readFileSync(
        resolve(
          __dirname,
          '../../../../../seed/workflow-delegation-tools/project-orchestration-cycle-ceo.delegations.json',
        ),
        'utf8',
      ),
    ) as { tools: { tool_name: string; workflow_id: string }[] };
    const tool = real.tools.find(
      (t) => t.tool_name === 'delegate_roadmap_planning',
    );
    expect(tool?.workflow_id).toBe('project_roadmap_planning');
  });
});
