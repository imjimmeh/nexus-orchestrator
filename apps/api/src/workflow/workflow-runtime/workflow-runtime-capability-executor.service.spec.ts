import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WorkflowRuntimeCapabilityExecutorService } from './workflow-runtime-capability-executor.service';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { ToolApprovalRuleService } from '../../capability-governance/tool-approval-rule.service';
import { ToolCallApprovalRequestService } from '../../capability-governance/tool-call-approval-request.service';
import { PolicyEngineService } from '../../capability-governance/policy-engine.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { ToolPolicyEffect } from '@nexus/core';

describe('WorkflowRuntimeCapabilityExecutorService', () => {
  let service: WorkflowRuntimeCapabilityExecutorService;

  const mockRuntimeTools = {
    getCapabilities: vi.fn(),
  };

  const mockEventLedger = {
    emit: vi.fn(),
    emitBestEffort: vi.fn(),
  };

  const mockRuleService = {
    resolveToolEffectExecution: vi.fn(),
  };

  const mockApprovalRequestService = {
    requestAndWaitForApproval: vi.fn(),
  };

  const mockPolicyEngine = {
    decide: vi.fn(),
  };

  beforeEach(async () => {
    vi.resetAllMocks();

    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: [],
      denied_tools: [],
      approval_required_tools: [],
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValue(null);
    mockPolicyEngine.decide.mockReturnValue({ status: 'allow' });
    mockApprovalRequestService.requestAndWaitForApproval.mockResolvedValue({
      status: 'approved',
      approvedBy: 'admin',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRuntimeCapabilityExecutorService,
        { provide: WorkflowRuntimeToolsService, useValue: mockRuntimeTools },
        { provide: EventLedgerService, useValue: mockEventLedger },
        { provide: ToolApprovalRuleService, useValue: mockRuleService },
        {
          provide: ToolCallApprovalRequestService,
          useValue: mockApprovalRequestService,
        },
        { provide: PolicyEngineService, useValue: mockPolicyEngine },
        ToolPolicyEvaluatorService,
      ],
    }).compile();

    service = module.get(WorkflowRuntimeCapabilityExecutorService);
  });

  it('checkPermission should evaluate governance and return result', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: [],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'allow' });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: { command: 'ls' },
    });

    expect(result.status).toBe('allow');
    expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.capability.attempt',
      }),
    );
    expect(
      mockApprovalRequestService.requestAndWaitForApproval,
    ).not.toHaveBeenCalled();
  });

  it('allows callable tool when no argument-aware rule matches', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: [],
      scope_id: 'project-1',
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValue(null);
    mockPolicyEngine.decide.mockReturnValue({ status: 'allow' });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: {
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        user: {
          userId: 'agent:run-1:job-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
        },
      },
      payload: { command: 'rg "foo" apps/api/src' },
    });

    expect(result).toEqual({ status: 'allow' });
    expect(mockRuleService.resolveToolEffectExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'project-1',
        workflowRunId: 'run-1',
        agentProfile: 'investigation-subagent',
      }),
      'bash',
      { command: 'rg "foo" apps/api/src' },
    );
    expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleEffect: null,
      }),
    );
  });

  it('requires approval when an argument-aware rule requires approval', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: [],
      scope_id: 'project-1',
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValue(
      'require_approval',
    );
    mockPolicyEngine.decide.mockReturnValue({ status: 'approval_required' });
    mockApprovalRequestService.requestAndWaitForApproval.mockResolvedValue({
      status: 'approved',
      approvedBy: 'admin',
    });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: {
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        user: {
          userId: 'agent:run-1:job-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
        },
      },
      payload: { command: 'grep -R "secret" .' },
    });

    expect(mockRuleService.resolveToolEffectExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'project-1',
        workflowRunId: 'run-1',
        agentProfile: 'investigation-subagent',
      }),
      'bash',
      { command: 'grep -R "secret" .' },
    );
    expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleEffect: 'require_approval',
      }),
    );
    expect(
      mockApprovalRequestService.requestAndWaitForApproval,
    ).toHaveBeenCalled();
    expect(result).toEqual({ status: 'allow' });
  });

  it('denies callable tools when an argument-aware rule matches at execution time', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: [],
      scope_id: 'project-1',
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValueOnce('deny');
    mockPolicyEngine.decide.mockReturnValue({
      status: 'deny',
      deniedReason: { reason: 'Denied by rule', reasonCode: 'rule_denied' },
      explanation: { phases: [], decidedBy: 'dynamic_rule' },
    });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: {
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        user: {
          userId: 'agent:run-1:job-1',
          roles: ['Agent'],
          agentProfileName: 'investigation-subagent',
        },
      },
      payload: { command: 'rm -rf /workspace' },
    });

    expect(mockRuleService.resolveToolEffectExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeId: 'project-1',
        workflowRunId: 'run-1',
        agentProfile: 'investigation-subagent',
      }),
      'bash',
      { command: 'rm -rf /workspace' },
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: 'denied',
        deniedReasonCode: 'rule_denied',
      }),
    );
    expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleEffect: 'deny',
      }),
    );
    expect(
      mockApprovalRequestService.requestAndWaitForApproval,
    ).not.toHaveBeenCalled();
  });

  it('denies callable tools when the agent tool policy rejects the payload', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['invoke_agent_workflow'],
      denied_tools: [],
      approval_required_tools: [],
      agent_tool_policy: {
        default: ToolPolicyEffect.DENY,
        rules: [
          {
            effect: ToolPolicyEffect.ALLOW,
            tool: 'invoke_agent_workflow',
            arguments: { workflow_id: { operator: 'absent' } },
          },
        ],
      },
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValueOnce(null);
    mockPolicyEngine.decide.mockImplementation((input: any) => {
      expect(input).toEqual(
        expect.objectContaining({ ruleEffect: ToolPolicyEffect.DENY }),
      );
      return {
        status: 'deny',
        deniedReason: { reason: 'Denied by rule', reasonCode: 'rule_denied' },
        explanation: { phases: [], decidedBy: 'dynamic_rule' },
      };
    });

    const result = await service.checkPermission({
      capabilityName: 'invoke_agent_workflow',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: { workflow_id: 'standard_feature_flow' },
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'denied',
        deniedReasonCode: 'rule_denied',
      }),
    );
  });

  it('denies callable tools when the agent tool policy is malformed', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['invoke_agent_workflow'],
      denied_tools: [],
      approval_required_tools: [],
      agent_tool_policy: { default: ToolPolicyEffect.DENY },
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValueOnce(null);
    mockPolicyEngine.decide.mockImplementation((input: any) => {
      expect(input).toEqual(
        expect.objectContaining({ ruleEffect: ToolPolicyEffect.DENY }),
      );
      return {
        status: 'deny',
        deniedReason: { reason: 'Denied by rule', reasonCode: 'rule_denied' },
        explanation: { phases: [], decidedBy: 'dynamic_rule' },
      };
    });

    const result = await service.checkPermission({
      capabilityName: 'invoke_agent_workflow',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: {},
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'denied',
        deniedReasonCode: 'rule_denied',
      }),
    );
  });

  it('allows approval flow for approval-required tools that are not callable', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: [],
      denied_tools: [],
      approval_required_tools: ['some_capability'],
    });
    mockRuleService.resolveToolEffectExecution.mockResolvedValueOnce(null);
    mockPolicyEngine.decide.mockImplementation((input: any) => {
      expect(input).toEqual(
        expect.objectContaining({
          capabilityName: 'some_capability',
          isRegistered: true,
          profileDecision: 'allow',
          workflowAllowed: true,
          modeOutcome: 'allow',
          approvalRequiredByProfile: true,
          ruleEffect: null,
        }),
      );
      return { status: 'approval_required' };
    });
    mockApprovalRequestService.requestAndWaitForApproval.mockResolvedValue({
      status: 'approved',
      approvedBy: 'admin',
    });

    const result = await service.checkPermission({
      capabilityName: 'some_capability',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: { command: 'ls' },
    });

    expect(result.status).toBe('allow');
    expect(
      mockApprovalRequestService.requestAndWaitForApproval,
    ).toHaveBeenCalled();
  });

  it('checkPermission should support chatSessionId', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: [],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'allow' });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: { chat_session_id: 'chat-1' },
      payload: { command: 'ls' },
    });

    expect(result.status).toBe('allow');
    expect(mockRuntimeTools.getCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_session_id: 'chat-1',
      }),
    );
  });

  it('checkPermission should return denied if tool is denied', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: [],
      denied_tools: [{ toolName: 'bash', reason: 'Forbidden' }],
      approval_required_tools: [],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'deny' });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: { command: 'ls' },
    });

    expect(result.status).toBe('denied');
    expect(result.reason).toContain('Forbidden');
  });

  it('returns a denied action result and does not execute record_learning when governance denies it', async () => {
    const execute = vi.fn();
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: [],
      denied_tools: [
        {
          toolName: 'record_learning',
          reason: 'Record learning is not allowed for this job.',
          reasonCode: 'job_policy_denied',
        },
      ],
      approval_required_tools: [],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'deny' });

    const result = await service.execute({
      capabilityName: 'record_learning',
      context: {
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
      },
      payload: { lesson: 'Keep context governed.' },
      execute,
    });

    expect(result).toEqual({
      ok: false,
      action: 'record_learning',
      execution_status: 'denied',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      reason: 'Record learning is not allowed for this job.',
      denied_reason_code: 'job_policy_denied',
      error: undefined,
      result: undefined,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.capability.denied',
        outcome: 'denied',
        toolName: 'record_learning',
      }),
    );
  });

  it('executes record_learning only after runtime governance allows it', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'pending',
      candidate_id: 'candidate-1',
      created: true,
    });
    const payload = {
      scope_type: 'workflow_run',
      scope_id: 'run-1',
      lesson: 'Keep context governed.',
      evidence: [
        {
          kind: 'workflow_run',
          id: 'run-1',
          summary: 'Runtime capability governance allowed this learning input.',
        },
      ],
      confidence: 0.82,
      tags: ['runtime'],
    };
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['record_learning'],
      denied_tools: [],
      approval_required_tools: [],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'allow' });

    const result = await service.execute({
      capabilityName: 'record_learning',
      context: {
        workflow_run_id: 'run-1',
        job_id: 'job-1',
        user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
      },
      payload,
      execute,
    });

    expect(result).toEqual({
      ok: true,
      action: 'record_learning',
      execution_status: 'executed',
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      reason: undefined,
      denied_reason_code: undefined,
      error: undefined,
      result: {
        status: 'pending',
        candidate_id: 'candidate-1',
        created: true,
      },
    });
    expect(mockRuntimeTools.getCapabilities).toHaveBeenCalledWith({
      workflow_run_id: 'run-1',
      job_id: 'job-1',
      chat_session_id: undefined,
      user: { userId: 'agent:run-1:job-1', roles: ['Agent'] },
    });
    expect(mockRuleService.resolveToolEffectExecution).toHaveBeenCalledWith(
      {
        scopeId: undefined,
        workflowRunId: 'run-1',
        chatSessionId: undefined,
        agentProfile: undefined,
      },
      'record_learning',
      payload,
    );
    expect(mockPolicyEngine.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityName: 'record_learning',
        isRegistered: true,
        workflowAllowed: true,
        workflowDenied: false,
        modeOutcome: 'allow',
      }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(mockEventLedger.emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.runtime.capability.succeeded',
        outcome: 'success',
        toolName: 'record_learning',
      }),
    );
  });

  it('checkPermission should trigger approval flow if needed', async () => {
    mockRuntimeTools.getCapabilities.mockResolvedValue({
      callable_tools: ['bash'],
      denied_tools: [],
      approval_required_tools: ['bash'],
    });
    mockPolicyEngine.decide.mockReturnValue({ status: 'approval_required' });
    mockApprovalRequestService.requestAndWaitForApproval.mockResolvedValue({
      status: 'approved',
      approvedBy: 'admin',
    });

    const result = await service.checkPermission({
      capabilityName: 'bash',
      context: { workflow_run_id: 'run-1', job_id: 'job-1' },
      payload: { command: 'ls' },
    });

    expect(result.status).toBe('allow');
    expect(
      mockApprovalRequestService.requestAndWaitForApproval,
    ).toHaveBeenCalled();
  });
});
