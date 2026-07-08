import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AcpAuthType,
  AcpAwaitPolicy,
  AcpRunMode,
  AcpServerStatus,
} from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpServer } from '../database/entities/acp-server.entity';
import type { AcpDiscoveredAgent } from '../database/entities/acp-discovered-agent.entity';
import type { AcpServerRepository } from '../database/repositories/acp-server.repository';
import type { AcpDiscoveredAgentRepository } from '../database/repositories/acp-discovered-agent.repository';
import type { AcpRuntimeManagerService } from '../acp-runtime-manager.service';
import type { SecretReferenceResolver } from '../../security/secret-reference-resolver.service';
import { AcpService } from '../acp.service';
import type { CreateAcpServerRequest } from '@nexus/core';

describe('AcpService', () => {
  const createServer = (overrides: Partial<AcpServer> = {}): AcpServer => ({
    id: 'server-1',
    name: 'Test ACP',
    enabled: true,
    url: 'http://localhost:3000',
    auth_type: AcpAuthType.NONE,
    auth_token: null,
    auth_secret_id: null,
    headers: null,
    headers_secret_id: null,
    timeout_ms: 30000,
    connect_timeout_ms: 10000,
    max_retries: 2,
    retry_backoff_ms: 1000,
    default_run_mode: AcpRunMode.ASYNC,
    await_policy: AcpAwaitPolicy.SURFACE_TO_USER,
    include_agents: null,
    exclude_agents: null,
    last_status: AcpServerStatus.UNKNOWN,
    last_error: null,
    last_connected_at: null,
    last_discovered_at: null,
    last_discovered_agent_count: null,
    created_at: new Date('2026-04-12T00:00:00.000Z'),
    updated_at: new Date('2026-04-12T00:00:00.000Z'),
    ...overrides,
  });

  const createDiscoveredAgent = (
    overrides: Partial<AcpDiscoveredAgent> = {},
  ): AcpDiscoveredAgent =>
    ({
      id: 'agent-1',
      server_id: 'server-1',
      agent_name: 'test-agent',
      description: 'Test agent',
      input_content_types: ['application/json'],
      output_content_types: ['application/json'],
      manifest_metadata: null,
      registry_tool_name: 'acp:server-1/test-agent',
      is_registered: true,
      created_at: new Date('2026-04-12T00:00:00.000Z'),
      updated_at: new Date('2026-04-12T00:00:00.000Z'),
      ...overrides,
    }) as AcpDiscoveredAgent;

  const acpServerRepository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as AcpServerRepository;

  const acpDiscoveredAgentRepository = {
    findByServerId: vi.fn(),
    deleteByServerId: vi.fn(),
  } as unknown as AcpDiscoveredAgentRepository;

  const runtimeManager = {
    removeAgentsForServer: vi.fn(),
    reloadServer: vi.fn(),
    reloadAllServers: vi.fn(),
    testServer: vi.fn(),
    invokeAgent: vi.fn(),
  } as unknown as AcpRuntimeManagerService;

  const secretReferenceResolver = {
    resolveString: vi.fn(),
    resolveMap: vi.fn(),
    assertSecretExists: vi.fn().mockResolvedValue(undefined),
    redactServer: vi.fn((server: AcpServer) => server) as any,
  } as unknown as SecretReferenceResolver;

  let service: AcpService;

  beforeEach(() => {
    vi.clearAllMocks();
    secretReferenceResolver.assertSecretExists = vi
      .fn()
      .mockResolvedValue(undefined);
    (secretReferenceResolver as any).redactServer = vi.fn(
      (server: AcpServer) => server,
    );
    service = new AcpService(
      acpServerRepository,
      acpDiscoveredAgentRepository,
      runtimeManager,
      secretReferenceResolver,
    );
  });

  describe('listServers', () => {
    it('returns all servers', async () => {
      const servers = [
        createServer({ id: 'server-1' }),
        createServer({ id: 'server-2' }),
      ];
      acpServerRepository.findAll = vi.fn().mockResolvedValue(servers);

      const result = await service.listServers();

      expect(result).toEqual(servers);
      expect(acpServerRepository.findAll).toHaveBeenCalled();
    });
  });

  describe('createServer', () => {
    it('creates a server and triggers runtime reload', async () => {
      const dto: CreateAcpServerRequest = {
        name: ' New ACP ',
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.BEARER,
        auth_token: 'secret-token',
        enabled: true,
      };

      const createdServer = createServer({ id: 'server-1', name: 'New ACP' });
      acpServerRepository.create = vi.fn().mockResolvedValue(createdServer);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

      const result = await service.createServer(dto);

      expect(acpServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New ACP',
          auth_type: AcpAuthType.BEARER,
          auth_token: 'secret-token',
        }),
      );
      expect(runtimeManager.reloadServer).toHaveBeenCalledWith(
        createdServer.id,
      );
      expect(result).toEqual(createdServer);
    });

    it('rejects creation when name is missing', async () => {
      const dto = {
        name: '   ',
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.NONE,
        enabled: true,
      } as CreateAcpServerRequest;

      await expect(service.createServer(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects creation when url is missing', async () => {
      const dto = {
        name: 'Test ACP',
        url: '   ',
        auth_type: AcpAuthType.NONE,
        enabled: true,
      } as CreateAcpServerRequest;

      await expect(service.createServer(dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('normalizes headers object', async () => {
      const dto: CreateAcpServerRequest = {
        name: 'Test ACP',
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.NONE,
        enabled: true,
        headers: { 'X-Custom': 'value', 'X-Empty': '  ' },
      };

      const createdServer = createServer();
      acpServerRepository.create = vi.fn().mockResolvedValue(createdServer);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

      await service.createServer(dto);

      expect(acpServerRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { 'X-Custom': 'value' },
        }),
      );
    });
  });

  describe('updateServer', () => {
    it('updates server and reloads it', async () => {
      const existing = createServer({ id: 'server-1' });
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);
      acpServerRepository.update = vi.fn().mockResolvedValue({
        ...existing,
        max_retries: 5,
      });
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

      const result = await service.updateServer('server-1', { max_retries: 5 });

      expect(acpServerRepository.update).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({ max_retries: 5 }),
      );
      expect(runtimeManager.reloadServer).toHaveBeenCalledWith('server-1');
      expect(result.max_retries).toBe(5);
    });

    it('throws NotFoundException when server does not exist', async () => {
      acpServerRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.updateServer('unknown-id', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects update with invalid name', async () => {
      const existing = createServer();
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);

      await expect(
        service.updateServer('server-1', { name: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteServer', () => {
    it('removes agents and deletes server', async () => {
      const existing = createServer({ id: 'server-1' });
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);
      runtimeManager.removeAgentsForServer = vi.fn().mockResolvedValue(2);
      acpServerRepository.remove = vi.fn().mockResolvedValue(undefined);

      await service.deleteServer('server-1');

      expect(runtimeManager.removeAgentsForServer).toHaveBeenCalledWith(
        'server-1',
      );
      expect(acpServerRepository.remove).toHaveBeenCalledWith('server-1');
    });

    it('throws NotFoundException when deleting unknown server', async () => {
      acpServerRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.deleteServer('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('testServer', () => {
    it('delegates to runtime manager', async () => {
      const testResult = {
        server_id: 'server-1',
        ok: true,
        latency_ms: 100,
        discovered_agents: [],
      };
      runtimeManager.testServer = vi.fn().mockResolvedValue(testResult);

      const result = await service.testServer('server-1');

      expect(runtimeManager.testServer).toHaveBeenCalledWith('server-1');
      expect(result).toEqual(testResult);
    });
  });

  describe('reloadServer', () => {
    it('delegates to runtime manager', async () => {
      const reloadResult = {
        server_id: 'server-1',
        server_name: 'Test ACP',
        ok: true,
        discovered_agent_count: 3,
        removed_agent_count: 0,
      };
      runtimeManager.reloadServer = vi.fn().mockResolvedValue(reloadResult);

      const result = await service.reloadServer('server-1');

      expect(runtimeManager.reloadServer).toHaveBeenCalledWith('server-1');
      expect(result).toEqual(reloadResult);
    });
  });

  describe('reloadAllServers', () => {
    it('delegates to runtime manager', async () => {
      const reloadResult = {
        started_at: new Date(),
        completed_at: new Date(),
        total_servers: 2,
        succeeded_servers: 2,
        failed_servers: 0,
        results: [],
      };
      runtimeManager.reloadAllServers = vi.fn().mockResolvedValue(reloadResult);

      const result = await service.reloadAllServers();

      expect(runtimeManager.reloadAllServers).toHaveBeenCalled();
      expect(result).toEqual(reloadResult);
    });
  });

  describe('listDiscoveredAgents', () => {
    it('returns agents for a server', async () => {
      const existing = createServer({ id: 'server-1' });
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);
      const agents = [
        createDiscoveredAgent(),
        createDiscoveredAgent({ id: 'agent-2', agent_name: 'agent-2' }),
      ];
      acpDiscoveredAgentRepository.findByServerId = vi
        .fn()
        .mockResolvedValue(agents);

      const result = await service.listDiscoveredAgents('server-1');

      expect(result).toEqual(agents);
    });

    it('throws NotFoundException for unknown server', async () => {
      acpServerRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.listDiscoveredAgents('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAgentManifest', () => {
    it('returns agent by name', async () => {
      const existing = createServer({ id: 'server-1' });
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);
      const agent = createDiscoveredAgent();
      acpDiscoveredAgentRepository.findByServerId = vi
        .fn()
        .mockResolvedValue([agent]);

      const result = await service.getAgentManifest('server-1', 'test-agent');

      expect(result).toEqual(agent);
    });

    it('throws NotFoundException for unknown agent', async () => {
      const existing = createServer();
      acpServerRepository.findById = vi.fn().mockResolvedValue(existing);
      acpDiscoveredAgentRepository.findByServerId = vi
        .fn()
        .mockResolvedValue([]);

      await expect(
        service.getAgentManifest('server-1', 'unknown-agent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invokeAgent', () => {
    it('delegates to runtime manager with params', async () => {
      const invokeResult = {
        server_id: 'server-1',
        agent_name: 'test-agent',
        registry_tool_name: 'acp:server-1/test-agent',
        duration_ms: 500,
        run_id: 'run-123',
        result: null,
      };
      runtimeManager.invokeAgent = vi.fn().mockResolvedValue(invokeResult);

      const result = await service.invokeAgent('server-1', 'test-agent', {
        param: 'value',
      });

      expect(runtimeManager.invokeAgent).toHaveBeenCalledWith(
        'server-1',
        'test-agent',
        { param: 'value' },
        undefined,
      );
      expect(result).toEqual(invokeResult);
    });

    it('passes run mode override', async () => {
      runtimeManager.invokeAgent = vi.fn().mockResolvedValue({});

      await service.invokeAgent('server-1', 'test-agent', {}, AcpRunMode.SYNC);

      expect(runtimeManager.invokeAgent).toHaveBeenCalledWith(
        'server-1',
        'test-agent',
        {},
        AcpRunMode.SYNC,
      );
    });
  });

  describe('resolveAuthTokenForServer', () => {
    it('delegates to the SecretReferenceResolver with the server credentials', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      const server = createServer({ auth_secret_id: secretId });
      secretReferenceResolver.resolveString = vi
        .fn()
        .mockResolvedValue('resolved-token');

      const result = await service.resolveAuthTokenForServer(server);

      expect(secretReferenceResolver.resolveString).toHaveBeenCalledWith({
        secretId,
        plaintext: server.auth_token,
        purpose: 'auth',
        serverName: server.name,
        allowEmptySecret: true,
      });
      expect(result).toBe('resolved-token');
    });
  });

  describe('secret FK validation', () => {
    it('rejects creation when auth_secret_id does not reference an existing secret', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      secretReferenceResolver.assertSecretExists = vi
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            `auth_secret_id does not reference an existing secret (${secretId})`,
          ),
        );

      await expect(
        service.createServer({
          name: 'Test ACP',
          enabled: true,
          url: 'http://localhost:3000',
          auth_type: AcpAuthType.BEARER,
          auth_secret_id: secretId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(acpServerRepository.create).not.toHaveBeenCalled();
    });

    it('rejects creation when headers_secret_id does not reference an existing secret', async () => {
      const secretId = '88888888-8888-4888-8888-888888888888';
      const assertMock = vi
        .fn()
        .mockImplementation(async (candidate: string | null | undefined) => {
          if (candidate === secretId) {
            throw new BadRequestException(
              `headers_secret_id does not reference an existing secret (${secretId})`,
            );
          }
        });
      secretReferenceResolver.assertSecretExists = assertMock;

      await expect(
        service.createServer({
          name: 'Test ACP',
          enabled: true,
          url: 'http://localhost:3000',
          auth_type: AcpAuthType.BEARER,
          headers_secret_id: secretId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(acpServerRepository.create).not.toHaveBeenCalled();
      expect(assertMock).toHaveBeenCalledWith(secretId, 'headers');
    });

    it('redacts server responses to drop plaintext auth_token when the secret FK is set', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      const created = createServer({ auth_secret_id: secretId });
      const redacted = { ...created, auth_token: null };
      acpServerRepository.create = vi.fn().mockResolvedValue(created);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });
      secretReferenceResolver.redactServer = vi.fn().mockReturnValue(redacted);

      const result = await service.createServer({
        name: 'Test ACP',
        enabled: true,
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.BEARER,
        auth_secret_id: secretId,
      });

      expect(secretReferenceResolver.redactServer).toHaveBeenCalledWith(
        created,
      );
      expect(result.auth_token).toBeNull();
    });

    it('redacts server responses to drop plaintext headers when headers_secret_id is set', async () => {
      const secretId = '88888888-8888-4888-8888-888888888888';
      const created = createServer({
        headers_secret_id: secretId,
        headers: { authorization: 'Bearer plain' },
      });
      const redacted = { ...created, headers: null };
      acpServerRepository.create = vi.fn().mockResolvedValue(created);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });
      secretReferenceResolver.redactServer = vi.fn().mockReturnValue(redacted);

      const result = await service.createServer({
        name: 'Test ACP',
        enabled: true,
        url: 'http://localhost:3000',
        auth_type: AcpAuthType.NONE,
        headers_secret_id: secretId,
      });

      expect(secretReferenceResolver.redactServer).toHaveBeenCalledWith(
        created,
      );
      expect(result.headers).toBeNull();
    });
  });

  describe('resolveHeadersForServer', () => {
    it('delegates to the SecretReferenceResolver with the server credentials', async () => {
      const secretId = '88888888-8888-4888-8888-888888888888';
      const server = createServer({ headers_secret_id: secretId });
      const resolved = { authorization: 'Bearer secret' };
      secretReferenceResolver.resolveMap = vi.fn().mockResolvedValue(resolved);

      const result = await service.resolveHeadersForServer(server);

      expect(secretReferenceResolver.resolveMap).toHaveBeenCalledWith({
        secretId,
        plaintext: server.headers,
        purpose: 'headers',
        serverName: server.name,
      });
      expect(result).toBe(resolved);
    });
  });
});
