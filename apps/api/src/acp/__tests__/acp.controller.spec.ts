import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcpAuthType, AcpRunMode } from '@nexus/core';
import type { AcpService } from '../acp.service';
import { AcpController } from '../acp.controller';

describe('AcpController', () => {
  const listServersMock = vi.fn();
  const createServerMock = vi.fn();
  const updateServerMock = vi.fn();
  const deleteServerMock = vi.fn();
  const testServerMock = vi.fn();
  const reloadServerMock = vi.fn();
  const reloadAllServersMock = vi.fn();
  const listDiscoveredAgentsMock = vi.fn();
  const getAgentManifestMock = vi.fn();
  const invokeAgentMock = vi.fn();

  const service = {
    listServers: listServersMock,
    createServer: createServerMock,
    updateServer: updateServerMock,
    deleteServer: deleteServerMock,
    testServer: testServerMock,
    reloadServer: reloadServerMock,
    reloadAllServers: reloadAllServersMock,
    listDiscoveredAgents: listDiscoveredAgentsMock,
    getAgentManifest: getAgentManifestMock,
    invokeAgent: invokeAgentMock,
  } as unknown as AcpService;

  let controller: AcpController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AcpController(service);
  });

  describe('listServers', () => {
    it('returns list response envelope', async () => {
      listServersMock.mockResolvedValue([{ id: 'server-1' }]);

      const response = await controller.listServers();

      expect(response).toEqual({
        success: true,
        data: [{ id: 'server-1' }],
      });
    });
  });

  describe('createServer', () => {
    it('returns created server in envelope', async () => {
      createServerMock.mockResolvedValue({ id: 'server-1' });

      const response = await controller.createServer({
        name: 'Test ACP',
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.NONE,
        enabled: true,
      });

      expect(createServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test ACP',
        }),
      );
      expect(response).toEqual({
        success: true,
        data: { id: 'server-1' },
      });
    });
  });

  describe('updateServer', () => {
    it('returns updated server in envelope', async () => {
      updateServerMock.mockResolvedValue({ id: 'server-1', name: 'Updated' });

      const response = await controller.updateServer('server-1', {
        name: 'Updated',
      });

      expect(updateServerMock).toHaveBeenCalledWith('server-1', {
        name: 'Updated',
      });
      expect(response).toEqual({
        success: true,
        data: { id: 'server-1', name: 'Updated' },
      });
    });
  });

  describe('deleteServer', () => {
    it('returns void in envelope', async () => {
      deleteServerMock.mockResolvedValue(undefined);

      const response = await controller.deleteServer('server-1');

      expect(deleteServerMock).toHaveBeenCalledWith('server-1');
      expect(response).toEqual({
        success: true,
        data: undefined,
      });
    });
  });

  describe('testServer', () => {
    it('returns test result in envelope', async () => {
      testServerMock.mockResolvedValue({
        server_id: 'server-1',
        ok: true,
        latency_ms: 100,
        discovered_agents: [],
      });

      const response = await controller.testServer('server-1');

      expect(testServerMock).toHaveBeenCalledWith('server-1');
      expect(response).toEqual({
        success: true,
        data: {
          server_id: 'server-1',
          ok: true,
          latency_ms: 100,
          discovered_agents: [],
        },
      });
    });
  });

  describe('reloadServer', () => {
    it('returns reload result in envelope', async () => {
      reloadServerMock.mockResolvedValue({
        server_id: 'server-1',
        server_name: 'Test ACP',
        ok: true,
        discovered_agent_count: 3,
        removed_agent_count: 0,
      });

      const response = await controller.reloadServer('server-1');

      expect(reloadServerMock).toHaveBeenCalledWith('server-1');
      expect(response).toEqual({
        success: true,
        data: {
          server_id: 'server-1',
          server_name: 'Test ACP',
          ok: true,
          discovered_agent_count: 3,
          removed_agent_count: 0,
        },
      });
    });
  });

  describe('reloadAllServers', () => {
    it('returns reload result in envelope', async () => {
      reloadAllServersMock.mockResolvedValue({
        started_at: new Date(),
        completed_at: new Date(),
        total_servers: 2,
        succeeded_servers: 2,
        failed_servers: 0,
        results: [],
      });

      const response = await controller.reloadAllServers();

      expect(reloadAllServersMock).toHaveBeenCalled();
      expect(response.success).toBe(true);
      expect(response.data.total_servers).toBe(2);
    });
  });

  describe('listDiscoveredAgents', () => {
    it('returns agents list in envelope', async () => {
      const agents = [
        { id: 'agent-1', agent_name: 'agent-1' },
        { id: 'agent-2', agent_name: 'agent-2' },
      ];
      listDiscoveredAgentsMock.mockResolvedValue(agents);

      const response = await controller.listDiscoveredAgents('server-1');

      expect(listDiscoveredAgentsMock).toHaveBeenCalledWith('server-1');
      expect(response).toEqual({
        success: true,
        data: agents,
      });
    });
  });

  describe('getAgentManifest', () => {
    it('returns agent manifest in envelope', async () => {
      const agent = {
        id: 'agent-1',
        agent_name: 'test-agent',
        description: 'Test agent',
      };
      getAgentManifestMock.mockResolvedValue(agent);

      const response = await controller.getAgentManifest(
        'server-1',
        'test-agent',
      );

      expect(getAgentManifestMock).toHaveBeenCalledWith(
        'server-1',
        'test-agent',
      );
      expect(response).toEqual({
        success: true,
        data: agent,
      });
    });
  });

  describe('invokeAgent', () => {
    it('returns invoke result in envelope', async () => {
      invokeAgentMock.mockResolvedValue({
        server_id: 'server-1',
        agent_name: 'test-agent',
        registry_tool_name: 'acp:server-1/test-agent',
        duration_ms: 500,
        run_id: 'run-123',
        result: null,
      });

      const response = await controller.invokeAgent('server-1', 'test-agent', {
        params: { input: 'value' },
      });

      expect(invokeAgentMock).toHaveBeenCalledWith(
        'server-1',
        'test-agent',
        { input: 'value' },
        undefined,
      );
      expect(response).toEqual({
        success: true,
        data: {
          server_id: 'server-1',
          agent_name: 'test-agent',
          registry_tool_name: 'acp:server-1/test-agent',
          duration_ms: 500,
          run_id: 'run-123',
          result: null,
        },
      });
    });

    it('passes run mode override', async () => {
      invokeAgentMock.mockResolvedValue({});

      await controller.invokeAgent('server-1', 'test-agent', {
        params: {},
        run_mode: AcpRunMode.SYNC,
      });

      expect(invokeAgentMock).toHaveBeenCalledWith(
        'server-1',
        'test-agent',
        {},
        AcpRunMode.SYNC,
      );
    });
  });
});
