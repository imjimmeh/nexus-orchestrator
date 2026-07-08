import { z } from 'zod';
import {
  awaitAgentWorkflowSchema,
  cancelDelegationContractInputSchema,
  createDelegationContractInputSchema,
  CheckSubagentStatusSchema,
  dispatchDelegationContractsInputSchema,
  getDelegationContractInputSchema,
  getDelegationReplayInputSchema,
  listRunningWorkflowsSchema,
  SpawnSubagentAsyncSchema,
  sweepDelegationTimeoutsInputSchema,
  WaitForSubagentsSchema,
  invokeAgentWorkflowSchema,
} from '@nexus/core';
import { Capability } from '../../capability-infra/capability.decorator';

const SpawnSubagentAsyncInputSchema = SpawnSubagentAsyncSchema.omit({
  action: true,
});

const WaitForSubagentsInputSchema = WaitForSubagentsSchema.omit({
  action: true,
}).extend({
  timeout_seconds: z.number().optional().default(3600),
});

const CheckSubagentStatusInputSchema = CheckSubagentStatusSchema.omit({
  action: true,
});

export class DelegationCapabilityProvider {
  @Capability({
    name: 'invoke_agent_workflow',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description:
      'Launch a Core workflow, optionally targeting an agent profile with opaque caller context.',
    inputSchema: invokeAgentWorkflowSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/orchestration/invoke-agent-workflow',
      bodyMapping: {
        workflow_id: 'workflow_id',
        agent_profile: 'agent_profile',
        task_prompt: 'task_prompt',
        trigger_data: 'trigger_data',
        context: 'context',
        workflow_run_id: 'workflow_run_id',
        reasoning: 'reasoning',
        reason: 'reason',
      },
    },
  })
  invokeAgentWorkflow() {
    return { ok: true };
  }

  @Capability({
    name: 'await_agent_workflow',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description:
      'Durably suspend the calling step until the awaited workflows finish. ' +
      'Provide workflows/workflow_id to LAUNCH-and-await new children, OR ' +
      'awaited_run_ids to attach to runs you already started (e.g. via a ' +
      'delegate_* tool). Do NOT pass workflow_run_id as a target — the calling ' +
      'run is inferred. It never launches a default workflow. After a delegate_* ' +
      'call you do NOT need this: delegate_* already suspends and awaits.',
    inputSchema: awaitAgentWorkflowSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/orchestration/await-agent-workflow',
      bodyMapping: {
        workflows: 'workflows',
        workflow_id: 'workflow_id',
        agent_profile: 'agent_profile',
        objective: 'objective',
        task_prompt: 'task_prompt',
        inputs: 'inputs',
        context: 'context',
        awaited_run_ids: 'awaited_run_ids',
        awaited_run_id: 'awaited_run_id',
        workflow_run_id: 'workflow_run_id',
        reasoning: 'reasoning',
        reason: 'reason',
      },
    },
  })
  awaitAgentWorkflow() {
    return { ok: true };
  }

  @Capability({
    name: 'list_running_workflows',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only'],
    description:
      'List the workflows still running for the current scope (name, status, age, wait reason) so an orchestrator avoids re-spawning in-flight work.',
    inputSchema: listRunningWorkflowsSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate:
        '/api/workflow-runtime/orchestration/list-running-workflows',
      bodyMapping: {
        scope_id: 'scope_id',
        workflow_run_id: 'workflow_run_id',
        limit: 'limit',
      },
    },
  })
  listRunningWorkflows() {
    return { ok: true };
  }

  @Capability({
    name: 'spawn_subagent_async',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Spawn an async subagent and return an execution handle.',
    inputSchema: SpawnSubagentAsyncInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/spawn-async',
      bodyMapping: {
        agent_profile: 'agent_profile',
        task_prompt: 'task_prompt',
        tools: 'tools',
        assigned_files: 'assigned_files',
        host_mounts: 'host_mounts',
        inherit_host_mounts: 'inherit_host_mounts',
      },
    },
  })
  spawnSubagentAsync() {
    return { ok: true };
  }

  @Capability({
    name: 'wait_for_subagents',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Block until subagent executions complete or timeout.',
    inputSchema: WaitForSubagentsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/wait',
      bodyMapping: {
        execution_ids: 'execution_ids',
        timeout_seconds: 'timeout_seconds',
      },
    },
  })
  waitForSubagents() {
    return { ok: true };
  }

  @Capability({
    name: 'check_subagent_status',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only'],
    description: 'Get the latest status for a subagent execution.',
    inputSchema: CheckSubagentStatusInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/status',
      bodyMapping: {
        execution_id: 'execution_id',
      },
    },
  })
  checkSubagentStatus() {
    return { ok: true };
  }

  @Capability({
    name: 'create_delegation_contract',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Create a mesh delegation contract and schedule work.',
    inputSchema: createDelegationContractInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/delegations/create',
      bodyMapping: {
        objective: 'objective',
        task_prompt: 'task_prompt',
        success_criteria: 'success_criteria',
        agent_profile: 'agent_profile',
        tools: 'tools',
        tier: 'tier',
        assigned_files: 'assigned_files',
        allowed_tools: 'allowed_tools',
        denied_tools: 'denied_tools',
        token_budget: 'token_budget',
        time_budget_ms: 'time_budget_ms',
        max_retries: 'max_retries',
        queue_priority: 'queue_priority',
        escalation_path: 'escalation_path',
        expected_artifacts: 'expected_artifacts',
        metadata: 'metadata',
        parent_delegation_id: 'parent_delegation_id',
        parent_trace_id: 'parent_trace_id',
        allow_privileged_tools: 'allow_privileged_tools',
      },
    },
  })
  createDelegationContract() {
    return { ok: true };
  }

  @Capability({
    name: 'get_delegation_contract',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only'],
    description: 'Get the current state of a mesh delegation contract.',
    inputSchema: getDelegationContractInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/delegations/get',
      bodyMapping: {
        contract_id: 'contract_id',
      },
    },
  })
  getDelegationContract() {
    return { ok: true };
  }

  @Capability({
    name: 'cancel_delegation_contract',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Cancel a queued or running mesh delegation contract.',
    inputSchema: cancelDelegationContractInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/delegations/cancel',
      bodyMapping: {
        contract_id: 'contract_id',
        reason: 'reason',
      },
    },
  })
  cancelDelegationContract() {
    return { ok: true };
  }

  @Capability({
    name: 'dispatch_delegation_contracts',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Dispatch queued mesh delegation contracts.',
    inputSchema: dispatchDelegationContractsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/delegations/dispatch',
      bodyMapping: {},
    },
  })
  dispatchDelegationContracts() {
    return { ok: true };
  }

  @Capability({
    name: 'sweep_delegation_timeouts',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['mutating'],
    description: 'Sweep and recover timed-out mesh delegation contracts.',
    inputSchema: sweepDelegationTimeoutsInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate:
        '/api/workflow-runtime/subagents/delegations/sweep-timeouts',
      bodyMapping: {},
    },
  })
  sweepDelegationTimeouts() {
    return { ok: true };
  }

  @Capability({
    name: 'get_delegation_replay',
    tierRestriction: 2,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: ['read_only'],
    description: 'Get contract and lifecycle replay data for the run.',
    inputSchema: getDelegationReplayInputSchema,
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/workflow-runtime/subagents/delegations/replay',
      bodyMapping: {
        limit: 'limit',
        offset: 'offset',
      },
    },
  })
  getDelegationReplay() {
    return { ok: true };
  }
}
