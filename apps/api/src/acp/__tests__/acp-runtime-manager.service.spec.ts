import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AcpAgentManifest,
  AcpAuthType,
  AcpAwaitPolicy,
  AcpRunMode,
  AcpRunStatus,
  AcpServerStatus,
} from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpServer } from '../database/entities/acp-server.entity';
import type { AcpServerRepository } from '../database/repositories/acp-server.repository';
import type { AcpDiscoveredAgentRepository } from '../database/repositories/acp-discovered-agent.repository';
import type { ToolRegistryRepository } from '../../tool/database/repositories/tool-registry.repository';
import type { CapabilityRegistrarService } from '../../tool-registry/capability-registrar.service';
import type { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import type { AcpHttpClient } from '../acp-http.client';
import type { SecretReferenceResolver } from '../../security/secret-reference-resolver.service';
import { AcpRuntimeManagerService } from '../acp-runtime-manager.service';

describe('AcpRuntimeManagerService', () => {
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

  const acpServerRepository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  } as unknown as AcpServerRepository;

  const acpDiscoveredAgentRepository = {
    deleteByServerId: vi.fn(),
    upsertByServerAndAgentName: vi.fn(),
  } as unknown as AcpDiscoveredAgentRepository;

  const toolRegistryRepository = {
    findByNamePrefix: vi.fn(),
  } as unknown as ToolRegistryRepository;

  const capabilityRegistrar = {
    registerToolProjection: vi.fn(),
  } as unknown as CapabilityRegistrarService;

  const toolRegistryService = {
    deleteTool: vi.fn(),
  } as unknown as ToolRegistryService;

  const eventLedger = {
    emitBestEffort: vi.fn(),
  } as unknown as EventLedgerService;

  const secretReferenceResolver = {
    resolveString: vi.fn(),
    resolveMap: vi.fn(),
    assertSecretExists: vi.fn().mockResolvedValue(undefined),
    redactServer: vi.fn((server: AcpServer) => server),
  } as unknown as SecretReferenceResolver;

  let service: AcpRuntimeManagerService;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new AcpRuntimeManagerService(
      acpServerRepository,
      acpDiscoveredAgentRepository,
      toolRegistryRepository,
      capabilityRegistrar,
      toolRegistryService,
      eventLedger,
      secretReferenceResolver,
    );
  });

  describe('reloadAllServers', () => {
    it('calls discovery on all enabled servers', async () => {
      const server1 = createServer({ id: 'server-1', name: 'Server 1' });
      const server2 = createServer({ id: 'server-2', name: 'Server 2' });

      acpServerRepository.findAll = vi
        .fn()
        .mockResolvedValue([server1, server2]);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockResolvedValue([
        { name: 'agent-1' } as AcpAgentManifest,
      ]);

      toolRegistryRepository.findByNamePrefix = vi.fn().mockResolvedValue([]);
      acpDiscoveredAgentRepository.upsertByServerAndAgentName = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await service.reloadAllServers();

      expect(result.total_servers).toBe(2);
      expect(result.succeeded_servers).toBe(2);
      expect(result.failed_servers).toBe(0);
    });

    it('marks servers as disabled and prunes tools', async () => {
      const disabledServer = createServer({
        id: 'server-disabled',
        name: 'Disabled',
        enabled: false,
      });

      acpServerRepository.findAll = vi.fn().mockResolvedValue([disabledServer]);
      toolRegistryRepository.findByNamePrefix = vi
        .fn()
        .mockResolvedValue([
          { id: 'tool-1', name: 'acp:server-disabled/agent-1' },
        ]);
      acpDiscoveredAgentRepository.deleteByServerId = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await service.reloadAllServers();

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          ok: true,
          discovered_agent_count: 0,
          removed_agent_count: 1,
        }),
      );

      expect(acpServerRepository.update).toHaveBeenCalledWith(
        'server-disabled',
        expect.objectContaining({
          last_status: AcpServerStatus.DISABLED,
        }),
      );
    });
  });

  describe('reloadServer', () => {
    it('reloads a single server and registers tools', async () => {
      const server = createServer({ id: 'server-1', name: 'Test Server' });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockResolvedValue([
        { name: 'agent-1', description: 'First agent' } as AcpAgentManifest,
        { name: 'agent-2', description: 'Second agent' } as AcpAgentManifest,
      ]);

      toolRegistryRepository.findByNamePrefix = vi.fn().mockResolvedValue([]);
      acpDiscoveredAgentRepository.upsertByServerAndAgentName = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await service.reloadServer('server-1');

      expect(result.ok).toBe(true);
      expect(result.discovered_agent_count).toBe(2);
      expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledTimes(
        2,
      );
    });

    it('throws NotFoundException when server does not exist', async () => {
      acpServerRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.reloadServer('unknown-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('continues registering remaining agents when one agent upsert throws', async () => {
      const server = createServer({ id: 'server-1', name: 'Test Server' });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockResolvedValue([
        { name: 'agent-1', description: 'First' } as AcpAgentManifest,
        { name: 'agent-2', description: 'Second' } as AcpAgentManifest,
        { name: 'agent-3', description: 'Third' } as AcpAgentManifest,
      ]);

      toolRegistryRepository.findByNamePrefix = vi.fn().mockResolvedValue([]);
      acpDiscoveredAgentRepository.upsertByServerAndAgentName = vi
        .fn()
        .mockResolvedValue(undefined);

      capabilityRegistrar.registerToolProjection = vi
        .fn()
        .mockImplementation((request: { tool: { name: string } }) => {
          if (request.tool.name.includes('agent-2')) {
            return Promise.reject(new Error('duplicate key violation'));
          }
          return Promise.resolve();
        });

      const result = await service.reloadServer('server-1');

      expect(result.ok).toBe(true);
      expect(result.discovered_agent_count).toBe(3);
      expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledTimes(
        3,
      );

      const lastCall = vi
        .mocked(capabilityRegistrar.registerToolProjection)
        .mock.calls.at(-1)?.[0] as { tool: { name: string } };
      expect(lastCall.tool.name).toContain('agent');
    });
  });

  describe('testServer', () => {
    it('returns discovered agents on successful connection', async () => {
      const server = createServer({ id: 'server-1' });
      const agents: AcpAgentManifest[] = [
        { name: 'agent-1', description: 'Test agent' },
      ];

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockResolvedValue(
        agents,
      );

      const result = await service.testServer('server-1');

      expect(result.ok).toBe(true);
      expect(result.discovered_agents).toHaveLength(1);
      expect(result.discovered_agents[0].agent_name).toBe('agent-1');
      expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('returns error on failed connection', async () => {
      const server = createServer({ id: 'server-1' });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await service.testServer('server-1');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection refused');
      expect(result.discovered_agents).toHaveLength(0);
    });
  });

  describe('invokeAgent', () => {
    it('calls the HTTP client and returns results', async () => {
      const server = createServer({
        id: 'server-1',
        name: 'Test Server',
        default_run_mode: AcpRunMode.ASYNC,
      });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'executeRun').mockResolvedValue({
        run_id: 'run-123',
        status: AcpRunStatus.COMPLETED,
        messages: [
          { role: 'agent', content_type: 'text/plain', content: 'result' },
        ],
      });

      const result = await service.invokeAgent('server-1', 'agent-1', {
        param: 'value',
      });

      expect(result.server_id).toBe('server-1');
      expect(result.agent_name).toBe('agent-1');
      expect(result.run_id).toBe('run-123');
    });

    it('throws BadRequestException when server is disabled', async () => {
      const disabledServer = createServer({ id: 'server-1', enabled: false });

      acpServerRepository.findById = vi.fn().mockResolvedValue(disabledServer);

      await expect(
        service.invokeAgent('server-1', 'agent-1', {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('uses run mode override when provided', async () => {
      const server = createServer({
        id: 'server-1',
        default_run_mode: AcpRunMode.ASYNC,
      });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'executeRun').mockResolvedValue({
        run_id: 'run-456',
        status: AcpRunStatus.IN_PROGRESS,
      });

      await service.invokeAgent('server-1', 'agent-1', {}, AcpRunMode.SYNC);

      expect((service as any).executeRun).toHaveBeenCalledWith(
        server,
        'agent-1',
        {},
        AcpRunMode.SYNC,
      );
    });
  });

  describe('removeAgentsForServer', () => {
    it('deletes all tools and agents for a server', async () => {
      const existingTools = [
        { id: 'tool-1', name: 'acp:server-1/agent-1' },
        { id: 'tool-2', name: 'acp:server-1/agent-2' },
      ];

      toolRegistryRepository.findByNamePrefix = vi
        .fn()
        .mockResolvedValue(existingTools);
      toolRegistryService.deleteTool = vi.fn().mockResolvedValue(undefined);
      acpDiscoveredAgentRepository.deleteByServerId = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await service.removeAgentsForServer('server-1');

      expect(result).toBe(2);
      expect(toolRegistryService.deleteTool).toHaveBeenCalledTimes(2);
      expect(
        acpDiscoveredAgentRepository.deleteByServerId,
      ).toHaveBeenCalledWith('server-1');
    });
  });

  describe('server disabled case', () => {
    it('disables server and prunes agents when enabled is false via reloadAllServers', async () => {
      const server = createServer({ id: 'server-1', enabled: false });

      acpServerRepository.findAll = vi.fn().mockResolvedValue([server]);
      toolRegistryRepository.findByNamePrefix = vi
        .fn()
        .mockResolvedValue([{ id: 'tool-1', name: 'acp:server-1/agent-1' }]);
      acpDiscoveredAgentRepository.deleteByServerId = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await service.reloadAllServers();

      expect(result.results[0]).toEqual(
        expect.objectContaining({
          ok: true,
          discovered_agent_count: 0,
          removed_agent_count: 1,
        }),
      );

      expect(acpServerRepository.update).toHaveBeenCalledWith(
        'server-1',
        expect.objectContaining({
          last_status: AcpServerStatus.DISABLED,
        }),
      );
    });
  });

  describe('include/exclude filtering', () => {
    it('passes include/exclude filters to discoverItemsWithRetry', async () => {
      const server = createServer({
        id: 'server-1',
        include_agents: ['agent-1', 'agent-2'],
        exclude_agents: ['agent-excluded'],
      });

      acpServerRepository.findById = vi.fn().mockResolvedValue(server);

      vi.spyOn(service as any, 'discoverItemsWithRetry').mockResolvedValue([]);

      await service.testServer('server-1');

      expect((service as any).discoverItemsWithRetry).toHaveBeenCalledWith(
        server,
      );
    });
  });
});
