import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpTransportType } from '@nexus/core';
import type { McpService } from './mcp.service';
import { McpController } from './mcp.controller';

describe('McpController', () => {
  const listServersMock = vi.fn();
  const createServerMock = vi.fn();
  const updateServerMock = vi.fn();
  const deleteServerMock = vi.fn();
  const testServerMock = vi.fn();
  const reloadServerMock = vi.fn();
  const reloadAllServersMock = vi.fn();
  const invokeToolMock = vi.fn();

  const service = {
    listServers: listServersMock,
    createServer: createServerMock,
    updateServer: updateServerMock,
    deleteServer: deleteServerMock,
    testServer: testServerMock,
    reloadServer: reloadServerMock,
    reloadAllServers: reloadAllServersMock,
    invokeTool: invokeToolMock,
  } as unknown as McpService;

  let controller: McpController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new McpController(service);
  });

  it('returns list response envelope', async () => {
    listServersMock.mockResolvedValue([{ id: 'server-1' }]);

    const response = await controller.listServers();

    expect(response).toEqual({
      success: true,
      data: [{ id: 'server-1' }],
    });
  });

  it('delegates create request', async () => {
    createServerMock.mockResolvedValue({ id: 'server-1' });

    const response = await controller.createServer({
      name: 'Git MCP',
      transport_type: McpTransportType.HTTP,
      url: 'http://localhost:4000/mcp',
      enabled: true,
    });

    expect(createServerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Git MCP',
      }),
    );
    expect(response).toEqual({
      success: true,
      data: { id: 'server-1' },
    });
  });

  it('delegates invoke tool request with runtime context headers', async () => {
    invokeToolMock.mockResolvedValue({ ok: true });

    const response = await controller.invokeTool(
      'server-1',
      'git/status',
      {
        params: { path: '.' },
      },
      {
        headers: {
          'x-workflow-run-id': 'run-1',
          'x-job-id': 'job-1',
          'x-step-id': 'step-1',
        },
      } as never,
    );

    expect(invokeToolMock).toHaveBeenCalledWith(
      'server-1',
      'git/status',
      { path: '.' },
      {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
      },
    );
    expect(response).toEqual({
      success: true,
      data: { ok: true },
    });
  });

  it('resolves scope from the x-scope-id header into runtime context', async () => {
    invokeToolMock.mockResolvedValue({ ok: true });

    await controller.invokeTool(
      'server-1',
      'external.scope_state',
      { params: {} },
      {
        headers: {
          'x-workflow-run-id': 'run-1',
          'x-scope-id': 'scope-from-header',
        },
      } as never,
    );

    expect(invokeToolMock).toHaveBeenCalledWith(
      'server-1',
      'external.scope_state',
      {},
      expect.objectContaining({ scopeId: 'scope-from-header' }),
    );
  });

  it('falls back to the x-correlation-id header for scope', async () => {
    invokeToolMock.mockResolvedValue({ ok: true });

    await controller.invokeTool(
      'server-1',
      'external.scope_state',
      { params: {} },
      {
        headers: {
          'x-workflow-run-id': 'run-1',
          'x-correlation-id': 'scope-from-correlation',
        },
      } as never,
    );

    expect(invokeToolMock).toHaveBeenCalledWith(
      'server-1',
      'external.scope_state',
      {},
      expect.objectContaining({ scopeId: 'scope-from-correlation' }),
    );
  });

  it('falls back to the authenticated user scope when no header is present', async () => {
    invokeToolMock.mockResolvedValue({ ok: true });

    await controller.invokeTool(
      'server-1',
      'external.scope_state',
      { params: {} },
      {
        headers: {},
        user: { workflowRunId: 'run-1', scopeId: 'scope-from-user' },
      } as never,
    );

    expect(invokeToolMock).toHaveBeenCalledWith(
      'server-1',
      'external.scope_state',
      {},
      expect.objectContaining({ scopeId: 'scope-from-user' }),
    );
  });

  it('delegates server-specific and global reload requests', async () => {
    reloadServerMock.mockResolvedValue({ ok: true });
    reloadAllServersMock.mockResolvedValue({ total_servers: 1 });

    const single = await controller.reloadServer('server-1');
    const all = await controller.reloadAllServers();

    expect(single).toEqual({ success: true, data: { ok: true } });
    expect(all).toEqual({ success: true, data: { total_servers: 1 } });
  });

  it('delegates delete request', async () => {
    deleteServerMock.mockResolvedValue({ id: 'server-1' });

    const response = await controller.deleteServer('server-1');

    expect(deleteServerMock).toHaveBeenCalledWith('server-1');
    expect(response).toEqual({ success: true, data: { id: 'server-1' } });
  });
});
