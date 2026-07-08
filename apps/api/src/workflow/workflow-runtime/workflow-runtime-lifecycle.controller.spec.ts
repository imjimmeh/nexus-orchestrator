import { BadRequestException } from '@nestjs/common';
import type { IMemorySegment, InternalToolExecutionContext } from '@nexus/core';
import { runtimeQueryMemoryBodySchema } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { QueryMemoryHandler } from '../workflow-internal-tools/handlers/query-memory.handler';
import {
  WorkflowRuntimeLifecycleController,
  invokeAgentWorkflowBodySchema,
  setJobOutputBodySchema,
} from './workflow-runtime-lifecycle.controller';
import { WorkflowRuntimeOrchestrationSessionService } from './workflow-runtime-orchestration-session.service';
import { WorkflowRuntimeOrchestrationActionsService } from './workflow-runtime-orchestration-actions.service';
import { WorkflowRuntimeAwaitActionsService } from './workflow-runtime-await-actions.service';
import { WorkflowRuntimeSetJobOutputService } from './workflow-runtime-set-job-output.service';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';

describe('WorkflowRuntimeLifecycleController setJobOutput', () => {
  let controller: WorkflowRuntimeLifecycleController;

  const setJobOutput = vi.fn().mockResolvedValue(undefined);
  const emitBestEffort = vi.fn().mockResolvedValue(undefined);
  const getCapabilities = vi.fn().mockResolvedValue({
    workflow_run_id: 'run-ctx',
    job_id: 'job-ctx',
    callable_tools: ['query_memory'],
  });
  const checkPermission = vi.fn().mockResolvedValue({
    status: 'allow',
    reason: undefined,
    denied_reason_code: undefined,
  });
  const getAgentProfiles = vi.fn().mockResolvedValue({
    total: 1,
    agent_profiles: [{ name: 'product-manager' }],
  });
  const getAgentProfile = vi.fn().mockResolvedValue({
    found: true,
    name: 'product-manager',
    agent_profile: { name: 'product-manager' },
  });
  const listAgentProfileNames = vi.fn().mockResolvedValue({
    total: 1,
    names: ['product-manager'],
  });
  const executeInternalTool = vi.fn().mockResolvedValue({
    memories: [{ id: 'memory-1', text: 'Remembered context' }],
  });
  const invokeAgentWorkflow = vi.fn().mockResolvedValue({
    ok: true,
    run_id: 'child-run-1',
    requested_action: 'invoke_agent_workflow',
  });
  const startAwaitedInvocationWorkflows = vi.fn().mockResolvedValue({
    ok: true,
    requestedAction: 'await_agent_workflow',
    executionStatus: 'suspended',
    awaitId: 'await-1',
    awaitedRunIds: ['child-run-1'],
  });

  const setJobOutputService = {
    setJobOutput,
  } as unknown as WorkflowRuntimeSetJobOutputService;
  const eventLedger = {
    emitBestEffort,
  } as unknown as EventLedgerService;
  const runtimeTools = {
    getCapabilities,
    checkPermission,
    getAgentProfiles,
    getAgentProfile,
    listAgentProfileNames,
    executeInternalTool,
  } as unknown as WorkflowRuntimeToolsService;
  const orchestrationActions = {
    invokeAgentWorkflow,
  } as unknown as WorkflowRuntimeOrchestrationActionsService;
  const awaitActions = {
    startAwaitedInvocationWorkflows,
  } as unknown as WorkflowRuntimeAwaitActionsService;
  let orchestrationSession: WorkflowRuntimeOrchestrationSessionService;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrationSession = new WorkflowRuntimeOrchestrationSessionService();
    controller = new WorkflowRuntimeLifecycleController(
      setJobOutputService,
      eventLedger,
      runtimeTools,
      orchestrationActions,
      awaitActions,
      orchestrationSession,
    );
  });

  it('binds set_job_output to agent token execution context', async () => {
    const result = await controller.setJobOutput(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        data: { pm_summary: 'done' },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(setJobOutput).toHaveBeenCalledWith('run-ctx', 'job-ctx', {
      pm_summary: 'done',
    });
  });

  it('rejects mismatched workflow_run_id against agent token context', async () => {
    await expect(
      controller.setJobOutput(
        {
          user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
        },
        {
          workflow_run_id: 'run-other',
          job_id: 'job-ctx',
          data: { pm_summary: 'done' },
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.set_job_output.context_mismatch',
        errorCode: 'set_job_output_context_mismatch',
      }),
    );
    expect(setJobOutput).not.toHaveBeenCalled();
  });

  it('supports non-agent callers when ids are provided explicitly', async () => {
    const result = await controller.setJobOutput(
      {
        user: { userId: 'admin-1', roles: ['Admin'] },
      },
      {
        workflow_run_id: 'run-explicit',
        job_id: 'job-explicit',
        data: { pm_summary: 'done' },
      },
    );

    expect(result).toEqual({ ok: true });
    expect(setJobOutput).toHaveBeenCalledWith('run-explicit', 'job-explicit', {
      pm_summary: 'done',
    });
  });

  it('normalizes JSON-encoded set_job_output data before controller validation', () => {
    const parsed = setJobOutputBodySchema.parse({
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      data: '{"adviceMarkdown":"done"}',
    });

    expect(parsed).toEqual({
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      data: { adviceMarkdown: 'done' },
    });
  });

  it('wraps checkPermission results in the runtime response envelope', async () => {
    const result = await controller.checkPermission(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        tool_name: 'query_memory',
        payload: { query: 'project context' },
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
      },
    );

    expect(checkPermission).toHaveBeenCalledWith({
      tool_name: 'query_memory',
      payload: { query: 'project context' },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      chat_session_id: undefined,
      scope_id: undefined,
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: {
        status: 'allow',
        reason: undefined,
        denied_reason_code: undefined,
      },
    });
  });

  it('wraps get_capabilities results in the runtime response envelope', async () => {
    const result = await controller.getCapabilities(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
      },
    );

    expect(getCapabilities).toHaveBeenCalledWith({
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      chat_session_id: undefined,
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        callable_tools: ['query_memory'],
      },
    });
  });

  it('wraps invoke_agent_workflow results in the runtime response envelope', async () => {
    const result = await controller.invokeAgentWorkflow(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        agent_profile: 'product-manager',
        task_prompt: 'Draft missing PRDs.',
        trigger_data: {
          scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        },
      },
    );

    expect(invokeAgentWorkflow).toHaveBeenCalledWith({
      agent_profile: 'product-manager',
      task_prompt: 'Draft missing PRDs.',
      trigger_data: {
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
      workflow_run_id: 'run-ctx',
    });
    expect(result).toEqual({
      success: true,
      data: {
        ok: true,
        run_id: 'child-run-1',
        requested_action: 'invoke_agent_workflow',
      },
    });
  });

  it('routes await_agent_workflow to the await actions service with agent run context', async () => {
    const result = await controller.awaitAgentWorkflow(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        step_id: 'await-step',
        workflows: [{ workflow_id: 'workflow_alpha' }],
      },
    );

    expect(startAwaitedInvocationWorkflows).toHaveBeenCalledWith({
      step_id: 'await-step',
      workflows: [{ workflow_id: 'workflow_alpha' }],
      workflow_run_id: 'run-ctx',
    });
    expect(result).toEqual({
      success: true,
      data: {
        ok: true,
        requestedAction: 'await_agent_workflow',
        executionStatus: 'suspended',
        awaitId: 'await-1',
        awaitedRunIds: ['child-run-1'],
      },
    });
  });

  it('resolves step_id from the agent JWT claim when the body omits it', async () => {
    await controller.awaitAgentWorkflow(
      {
        user: {
          userId: 'agent:run-ctx:job-ctx',
          stepId: 'strategize',
          roles: ['Agent'],
        },
      },
      {
        workflows: [{ workflow_id: 'workflow_alpha' }],
      },
    );

    expect(startAwaitedInvocationWorkflows).toHaveBeenCalledWith({
      step_id: 'strategize',
      workflows: [{ workflow_id: 'workflow_alpha' }],
      workflow_run_id: 'run-ctx',
    });
  });

  it('overrides explicit workflow_run_id with agent token context on invoke_agent_workflow calls', async () => {
    await controller.invokeAgentWorkflow(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        agent_profile: 'product-manager',
        workflow_run_id: 'fake-run-id',
      },
    );

    expect(invokeAgentWorkflow).toHaveBeenCalledWith({
      agent_profile: 'product-manager',
      workflow_run_id: 'run-ctx',
    });
  });

  it('preserves explicit workflow_run_id for non-agent invoke_agent_workflow callers', async () => {
    await controller.invokeAgentWorkflow(
      {
        user: { userId: 'admin-user', roles: ['Admin'] },
      },
      {
        agent_profile: 'product-manager',
        workflow_run_id: 'run-explicit',
      },
    );

    expect(invokeAgentWorkflow).toHaveBeenCalledWith({
      agent_profile: 'product-manager',
      workflow_run_id: 'run-explicit',
    });
  });

  it('normalizes empty optional workflow ids before invoke_agent_workflow validation', () => {
    const parsed = invokeAgentWorkflowBodySchema.parse({
      agent_profile: 'product-manager',
      workflow_id: '  ',
      workflow_run_id: '',
    });

    expect(parsed).toEqual({
      agent_profile: 'product-manager',
      workflow_id: undefined,
      workflow_run_id: undefined,
    });
  });

  it('serves query_memory through the internal tool runtime surface', async () => {
    const result = await controller.queryMemory(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'orchestration state',
        memory_type: 'history',
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'query_memory',
      payload: {
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'orchestration state',
        memory_type: 'history',
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { memories: [{ id: 'memory-1', text: 'Remembered context' }] },
    });
  });

  it('passes include_learning through the query_memory runtime surface', async () => {
    executeInternalTool.mockResolvedValueOnce({
      entity_type: 'Project',
      entity_id: 'project-1',
      query: 'repair',
      memory_type: null,
      count: 1,
      segments: [
        {
          id: 'memory-1',
          entity_type: 'Project',
          entity_id: 'project-1',
          memory_type: 'fact',
          content: 'Prefer cited repair evidence',
          version: 1,
          metadata: { source: 'learning_candidate' },
        },
      ],
      learning: {
        query: 'repair',
        count: 1,
        segments: [
          {
            id: 'memory-2',
            entity_type: 'Project',
            entity_id: 'project-1',
            memory_type: 'fact',
            content: 'Cite evidence before mutating workflow behavior.',
            version: 1,
            metadata: { source: 'learning_candidate' },
          },
        ],
      },
    });

    const result = await controller.queryMemory(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      } as unknown as AuthenticatedRequest,
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'repair',
        include_learning: true,
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'query_memory',
      payload: {
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'repair',
        include_learning: true,
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({
        learning: expect.objectContaining({ count: 1 }),
      }),
    });
  });

  it('honors include_provenance=false end-to-end through the query_memory runtime surface', async () => {
    // Wire a real QueryMemoryHandler under executeInternalTool so the
    // controller's payload forwarding and the handler's opt-out are
    // exercised together. This is the regression sentinel for the
    // prior gap where the controller dropped `include_provenance` and
    // the handler's default of `true` always won.
    const sourceDecisionId = 'aaaa1111-4111-4111-8111-111111111111';
    const learningCandidateId = 'bbbb2222-4222-4222-9222-222222222222';
    const workflowRunId = 'cccc3333-4333-4333-a333-333333333333';
    const jobId = 'dddd4444-4444-4444-b444-444444444444';
    const createdAt = new Date('2026-05-16T09:00:00.000Z');
    const lastAccessedAt = new Date('2026-05-16T10:00:00.000Z');
    const segmentFixture: IMemorySegment = {
      id: 'eeee5555-4555-4555-8555-555555555555',
      entity_type: 'Project',
      entity_id: 'project-1',
      memory_type: 'fact',
      content: 'Cite evidence before mutating workflow behavior.',
      version: 1,
      metadata_json: {
        source: 'learning_candidate',
        source_decision_id: sourceDecisionId,
        confidence: 0.87,
        learning_candidate_id: learningCandidateId,
        agent_profile_name: 'senior_dev',
        workflow_run_id: workflowRunId,
        job_id: jobId,
      },
      last_accessed_at: lastAccessedAt,
      created_at: createdAt,
      updated_at: createdAt,
    };
    const memoryManager = {
      getMemorySegments: vi.fn(async () => [segmentFixture]),
      searchMemory: vi.fn(async () => [segmentFixture]),
      searchPromotedLessonsByScope: vi.fn(async () => []),
    };
    // Milestone-3 addition: stub `MemorySegmentFeedbackService`
    // with the no-vote / no-usefulness surface so the pre-existing
    // queryMemory controller spec continues to exercise the
    // pure-read path.
    const feedbackService = {
      recordFeedback: vi.fn(),
      computeUsefulnessForSegment: vi.fn(async () => ({
        usefulness: null,
        sampleSize: 0,
      })),
      computeUsefulnessForSegments: vi.fn(async () => new Map()),
    };
    const handler = new QueryMemoryHandler(
      memoryManager as never,
      feedbackService as never,
    );

    executeInternalTool.mockImplementationOnce(
      async ({
        name,
        payload,
      }: {
        name: string;
        payload: Record<string, unknown>;
      }) => {
        if (name === 'query_memory') {
          return handler.queryMemory(buildContext(), payload);
        }
        throw new Error(`unexpected tool ${name}`);
      },
    );

    const result = await controller.queryMemory(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      } as unknown as AuthenticatedRequest,
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'cited evidence',
        include_provenance: false,
      },
    );

    // The controller must forward include_provenance verbatim to the
    // memory tool — not omit it (which would let the handler default
    // to true and silently ignore the agent's opt-out).
    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'query_memory',
      payload: {
        entity_type: 'Project',
        entity_id: 'project-1',
        query: 'cited evidence',
        include_provenance: false,
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });

    // And the handler-level response must reflect the opt-out:
    // every projected segment carries provenance: null while the
    // other fields (confidence, metadata_json) are still populated so
    // agents can still weight segments.
    const data = result.data as {
      count: number;
      segments: Array<Record<string, unknown>>;
    };
    expect(data.count).toBe(1);
    expect(data.segments).toHaveLength(1);
    for (const segment of data.segments) {
      expect(segment.provenance).toBeNull();
    }
    expect(data.segments[0].confidence).toBe(0.87);
    expect(data.segments[0].metadata_json).toEqual(
      expect.objectContaining({
        source: 'learning_candidate',
        source_decision_id: sourceDecisionId,
        learning_candidate_id: learningCandidateId,
      }),
    );
  });

  it('still defaults include_provenance to true when the agent omits it on the controller', async () => {
    // Companion regression sentinel: the controller's explicit
    // `include_provenance: body.include_provenance` line must not
    // overwrite an agent-supplied `false` with the schema's default.
    // When the agent omits the flag, the schema default `true` flows
    // through `body.include_provenance` and the handler should keep
    // synthesizing provenance as before.
    const memoryManager = {
      getMemorySegments: vi.fn(async () => []),
      searchMemory: vi.fn(async () => []),
      searchPromotedLessonsByScope: vi.fn(async () => []),
    };
    // Milestone-3 addition: stub `MemorySegmentFeedbackService`
    // with the no-vote / no-usefulness surface so the pre-existing
    // queryMemory controller spec continues to exercise the
    // pure-read path.
    const feedbackService = {
      recordFeedback: vi.fn(),
      computeUsefulnessForSegment: vi.fn(async () => ({
        usefulness: null,
        sampleSize: 0,
      })),
      computeUsefulnessForSegments: vi.fn(async () => new Map()),
    };
    const handler = new QueryMemoryHandler(
      memoryManager as never,
      feedbackService as never,
    );

    executeInternalTool.mockImplementationOnce(
      async ({
        name,
        payload,
      }: {
        name: string;
        payload: Record<string, unknown>;
      }) => {
        if (name === 'query_memory') {
          return handler.queryMemory(buildContext(), payload);
        }
        throw new Error(`unexpected tool ${name}`);
      },
    );

    // Run the body through the runtime schema first to mirror what
    // the `@ZodBody` decorator does at the HTTP boundary — otherwise
    // the schema's `.default(true)` never fires and we'd be testing
    // the controller method with an `undefined` body field.
    const parsedBody = runtimeQueryMemoryBodySchema.parse({
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      entity_type: 'Project',
      entity_id: 'project-1',
    });

    await controller.queryMemory(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      } as unknown as AuthenticatedRequest,
      parsedBody,
    );

    // `runtimeQueryMemoryBodySchema` defaults include_provenance to
    // true when omitted, so the controller forwards `true` to the
    // tool and the handler honors that as the default-on path.
    expect(executeInternalTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'query_memory',
        payload: expect.objectContaining({
          entity_type: 'Project',
          entity_id: 'project-1',
          include_provenance: true,
        }),
      }),
    );
  });

  it('serves record_learning through the internal tool runtime surface', async () => {
    executeInternalTool.mockResolvedValueOnce({
      status: 'accepted',
      recorded: false,
    });

    const result = await controller.recordLearning(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        scope_type: 'workflow_run',
        scope_id: 'run-ctx',
        lesson: 'Prefer runtime tool shells before durable writers.',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-ctx',
            summary: 'Task 3 registers only the tool shell.',
          },
        ],
        confidence: 0.83,
        tags: ['runtime', 'memory'],
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'record_learning',
      payload: {
        scope_type: 'workflow_run',
        scope_id: 'run-ctx',
        lesson: 'Prefer runtime tool shells before durable writers.',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-ctx',
            summary: 'Task 3 registers only the tool shell.',
          },
        ],
        confidence: 0.83,
        tags: ['runtime', 'memory'],
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { status: 'accepted', recorded: false },
    });
  });

  it('serves remember through the internal tool runtime surface', async () => {
    executeInternalTool.mockResolvedValueOnce({
      created: true,
      candidate_id: 'candidate-1',
    });

    const result = await controller.remember(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        content: 'Place git diff formatting options before positional refs.',
        memory_type: 'fact',
        scope: 'project',
        tags: ['git'],
        origin: 'discovery',
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'remember',
      payload: {
        content: 'Place git diff formatting options before positional refs.',
        memory_type: 'fact',
        scope: 'project',
        tags: ['git'],
        origin: 'discovery',
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { created: true, candidate_id: 'candidate-1' },
    });
  });

  it('forwards optional remember confidence when supplied', async () => {
    executeInternalTool.mockResolvedValueOnce({ created: true });

    await controller.remember(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        job_id: 'job-ctx',
        content: 'User-approved durable preference about commit hygiene.',
        memory_type: 'preference',
        scope: 'global',
        tags: [],
        origin: 'user_request',
        confidence: 0.95,
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'remember',
      payload: {
        content: 'User-approved durable preference about commit hygiene.',
        memory_type: 'preference',
        scope: 'global',
        tags: [],
        origin: 'user_request',
        confidence: 0.95,
      },
      workflow_run_id: 'run-ctx',
      job_id: 'job-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
  });

  it('rejects record_learning when no workflow/job context is available', async () => {
    await expect(
      controller.recordLearning(
        {
          user: { userId: 'developer-1', roles: ['Developer'] },
        },
        {
          scope_type: 'workflow_run',
          scope_id: 'run-ctx',
          lesson: 'Prefer runtime tool shells before durable writers.',
          evidence: [
            {
              kind: 'workflow_run',
              id: 'run-ctx',
              summary: 'Task 3 registers only the tool shell.',
            },
          ],
          confidence: 0.83,
          tags: ['runtime', 'memory'],
        },
      ),
    ).rejects.toThrow(
      'record_learning requires workflow_run_id and job_id in the request body or agent token context.',
    );

    expect(executeInternalTool).not.toHaveBeenCalled();
  });

  it('allows record_learning with agent token context when body ids are omitted', async () => {
    executeInternalTool.mockResolvedValueOnce({
      status: 'accepted',
      recorded: false,
    });

    const result = await controller.recordLearning(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        scope_type: 'workflow_run',
        scope_id: 'run-ctx',
        lesson: 'Prefer runtime tool shells before durable writers.',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-ctx',
            summary: 'Task 3 registers only the tool shell.',
          },
        ],
        confidence: 0.83,
        tags: ['runtime', 'memory'],
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'record_learning',
      payload: {
        scope_type: 'workflow_run',
        scope_id: 'run-ctx',
        lesson: 'Prefer runtime tool shells before durable writers.',
        evidence: [
          {
            kind: 'workflow_run',
            id: 'run-ctx',
            summary: 'Task 3 registers only the tool shell.',
          },
        ],
        confidence: 0.83,
        tags: ['runtime', 'memory'],
      },
      workflow_run_id: undefined,
      job_id: undefined,
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { status: 'accepted', recorded: false },
    });
  });

  it('serves get_todo_list through the internal tool runtime surface', async () => {
    const result = await controller.getTodoList(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'get_todo_list',
      payload: { workflow_run_id: 'run-ctx' },
      workflow_run_id: 'run-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { memories: [{ id: 'memory-1', text: 'Remembered context' }] },
    });
  });

  it('serves manage_todo_list through the internal tool runtime surface', async () => {
    const result = await controller.manageTodoList(
      {
        user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
      },
      {
        workflow_run_id: 'run-ctx',
        todoList: [
          {
            id: 'task-1',
            status: 'in-progress',
            title: 'Implement auth',
          },
        ],
        todo_list: [
          {
            id: 'task-2',
            status: 'completed',
            title: 'Review PR',
          },
        ],
      },
    );

    expect(executeInternalTool).toHaveBeenCalledWith({
      name: 'manage_todo_list',
      payload: {
        workflow_run_id: 'run-ctx',
        todoList: [
          {
            id: 'task-1',
            status: 'in-progress',
            title: 'Implement auth',
          },
        ],
        todo_list: [
          {
            id: 'task-2',
            status: 'completed',
            title: 'Review PR',
          },
        ],
      },
      workflow_run_id: 'run-ctx',
      user: { userId: 'agent:run-ctx:job-ctx', roles: ['Agent'] },
    });
    expect(result).toEqual({
      success: true,
      data: { memories: [{ id: 'memory-1', text: 'Remembered context' }] },
    });
  });

  it('serves get_agent_profiles through the runtime response envelope', async () => {
    const result = await controller.getAgentProfiles({ limit: 10, offset: 0 });

    expect(getAgentProfiles).toHaveBeenCalledWith({
      limit: 10,
      offset: 0,
    });
    expect(result).toEqual({
      success: true,
      data: {
        total: 1,
        agent_profiles: [{ name: 'product-manager' }],
      },
    });
  });

  it('serves get_agent_profile through the runtime response envelope', async () => {
    const result = await controller.getAgentProfile({
      name: 'product-manager',
    });

    expect(getAgentProfile).toHaveBeenCalledWith('product-manager');
    expect(result).toEqual({
      success: true,
      data: {
        found: true,
        name: 'product-manager',
        agent_profile: { name: 'product-manager' },
      },
    });
  });

  it('serves list_agent_profile_names through the runtime response envelope', async () => {
    const result = await controller.listAgentProfileNames();

    expect(listAgentProfileNames).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        total: 1,
        names: ['product-manager'],
      },
    });
  });
});

/**
 * Build the `InternalToolExecutionContext` the `query_memory`
 * handler expects when the milestone-3 controller-level mock
 * invokes it. Mirrors the agent-context shape the controller
 * resolves from the agent JWT (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 3): a
 * workflow run id, a job id, and a non-empty
 * `agentProfileName` so the handler's feedback-write path
 * never trips the `unknown-agent` fallback.
 */
function buildContext(): InternalToolExecutionContext {
  return {
    workflowRunId: 'run-ctx',
    jobId: 'job-ctx',
    scopeId: 'runtime-scope-789',
    userId: 'agent:run-ctx:job-ctx',
    userRoles: ['Agent'],
    agentProfileName: 'repair-agent',
  };
}
