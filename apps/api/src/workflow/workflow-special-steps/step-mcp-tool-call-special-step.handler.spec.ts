import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpService } from '../../mcp/mcp.service';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import type { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import { StepMcpToolCallSpecialStepHandler } from './step-mcp-tool-call-special-step.handler';

function createHandler(
  overrides: Partial<McpService> = {},
  runStateVariables: Record<string, unknown> = {},
) {
  const mcpService = {
    invokeTool: vi.fn().mockResolvedValue({
      server_id: 'external-mcp',
      remote_tool_name: 'external.resource_update',
      registry_tool_name: 'mcp__external-mcp__external.resource_update',
      duration_ms: 12,
      result: { ok: true },
    }),
    ...overrides,
  } as unknown as McpService;
  const auditPublisher = {
    audit: vi.fn().mockResolvedValue(undefined),
  } as unknown as SpecialStepAuditPublisher;
  const runRepo = {
    findById: vi.fn().mockResolvedValue({ state_variables: runStateVariables }),
  } as unknown as IWorkflowRunRepository;

  return {
    auditPublisher,
    mcpService,
    runRepo,
    handler: new StepMcpToolCallSpecialStepHandler(
      mcpService,
      auditPublisher,
      runRepo,
    ),
  };
}

describe('StepMcpToolCallSpecialStepHandler', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires explicit server and tool allowlist policy', async () => {
    const { handler } = createHandler();

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'call_external',
        step: { id: 'call_external', type: 'mcp_tool_call', tier: 'light' },
        resolvedStepInputs: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_update',
          params: {},
        },
      }),
    ).rejects.toThrow(
      'Step call_external: mcp_tool_call requires inputs.policy.allowed_servers',
    );
  });

  it('blocks tools outside policy and audits the denial', async () => {
    const { handler, auditPublisher } = createHandler();

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'call_external',
        step: { id: 'call_external', type: 'mcp_tool_call', tier: 'light' },
        resolvedStepInputs: {
          server_id: 'external-mcp',
          tool_name: 'filesystem.write_file',
          params: {},
          policy: {
            allowed_servers: ['external-mcp'],
            allowed_tools: ['external.*'],
          },
        },
      }),
    ).rejects.toThrow(
      "Step call_external: mcp_tool_call tool 'filesystem.write_file' is not allowed by policy",
    );
    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mcp_tool_call',
        outcome: 'blocked',
        workflowRunId: 'run-1',
        stepId: 'call_external',
        payload: {
          server_id: 'external-mcp',
          tool_name: 'filesystem.write_file',
        },
        errorMessage:
          "Step call_external: mcp_tool_call tool 'filesystem.write_file' is not allowed by policy",
      }),
    );
  });

  it('invokes an allowed MCP tool and audits success', async () => {
    const { handler, mcpService, auditPublisher } = createHandler();

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'call_external',
      step: { id: 'call_external', type: 'mcp_tool_call', tier: 'light' },
      resolvedStepInputs: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_update',
        params: { scope_id: 'p1', contextId: 'w1' },
        policy: {
          allowed_servers: ['external-mcp'],
          allowed_tools: ['external.*'],
        },
      },
    });

    expect(mcpService.invokeTool).toHaveBeenCalledWith(
      'external-mcp',
      'external.resource_update',
      { scope_id: 'p1', contextId: 'w1' },
    );
    expect(result.result).toEqual({
      status: 'completed',
      mode: 'mcp_tool_call',
      serverId: 'external-mcp',
      toolName: 'external.resource_update',
    });
    expect(result.output).toMatchObject({ ok: true, result: { ok: true } });
    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mcp_tool_call',
        outcome: 'succeeded',
        workflowRunId: 'run-1',
        stepId: 'call_external',
        payload: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_update',
        },
      }),
    );
  });

  it('invokes a matching run-scoped external MCP URL mount without using the registry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'updated' }] },
        }),
      ),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { handler, mcpService } = createHandler(
      {},
      {
        trigger: {
          externalMcpMounts: [
            {
              id: 'external-mcp',
              url: 'http://external.local/mcp',
              headers: { authorization: 'Bearer test-token' },
            },
          ],
        },
      },
    );

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'call_external',
      step: { id: 'call_external', type: 'mcp_tool_call', tier: 'light' },
      resolvedStepInputs: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_update',
        params: { scope_id: 'p1', contextId: 'w1' },
        policy: {
          allowed_servers: ['external-mcp'],
          allowed_tools: ['external.*'],
        },
      },
    });

    expect(mcpService.invokeTool).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://external.local/mcp',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        }),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'external.resource_update',
            arguments: { scope_id: 'p1', contextId: 'w1' },
          },
        }),
      }),
    );
    expect(result.output).toMatchObject({
      ok: true,
      server_id: 'external-mcp',
      remote_tool_name: 'external.resource_update',
      result: { content: [{ type: 'text', text: 'updated' }] },
    });
  });

  it('throws after audit when MCP invocation fails', async () => {
    const { handler, auditPublisher } = createHandler({
      invokeTool: vi.fn().mockRejectedValue(new Error('tool failed')),
    });

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'call_external',
        step: { id: 'call_external', type: 'mcp_tool_call', tier: 'light' },
        resolvedStepInputs: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_update',
          params: {},
          policy: {
            allowed_servers: ['external-mcp'],
            allowed_tools: ['external.*'],
          },
        },
      }),
    ).rejects.toThrow('tool failed');

    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mcp_tool_call',
        outcome: 'failed',
        workflowRunId: 'run-1',
        stepId: 'call_external',
        payload: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_update',
        },
        errorMessage: 'tool failed',
      }),
    );
  });
});
