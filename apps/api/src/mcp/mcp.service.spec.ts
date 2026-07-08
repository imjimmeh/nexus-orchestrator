import { BadRequestException, NotFoundException } from '@nestjs/common';
import { McpServerStatus, McpTransportType } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from './database/entities/mcp-server.entity';
import type { McpServerRepository } from './database/repositories/mcp-server.repository';
import type { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import type { McpRuntimeManagerService } from './mcp-runtime-manager.service';
import type { SecretReferenceResolver } from '../security/secret-reference-resolver.service';
import { McpService } from './mcp.service';
import { buildMcpToolPrefix } from './mcp-tool-name.utils';

describe('McpService', () => {
  const baseServer: McpServer = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Git MCP',
    enabled: true,
    transport_type: McpTransportType.HTTP,
    command: null,
    args: null,
    url: 'http://localhost:4000/mcp',
    headers: null,
    headers_secret_id: null,
    include_tools: null,
    exclude_tools: null,
    timeout_ms: 30000,
    connect_timeout_ms: 10000,
    max_retries: 2,
    retry_backoff_ms: 1000,
    last_status: McpServerStatus.UNKNOWN,
    last_error: null,
    last_connected_at: null,
    last_discovered_at: null,
    last_discovered_tool_count: null,
    created_at: new Date('2026-04-12T00:00:00.000Z'),
    updated_at: new Date('2026-04-12T00:00:00.000Z'),
  };

  const repository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  } as unknown as McpServerRepository;

  const runtimeManager = {
    removeToolsForServer: vi.fn(),
    reloadServer: vi.fn(),
    reloadAllServers: vi.fn(),
    testServer: vi.fn(),
    invokeTool: vi.fn(),
  } as unknown as McpRuntimeManagerService;

  const toolRegistryRepository = {
    findByNamePrefix: vi.fn(),
  } as unknown as ToolRegistryRepository;

  const secretReferenceResolver = {
    resolveString: vi.fn(),
    resolveMap: vi.fn(),
    assertSecretExists: vi.fn().mockResolvedValue(undefined),
    redactServer: vi.fn((server: McpServer) => server) as any,
  } as unknown as SecretReferenceResolver;

  let service: McpService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.findAll = vi.fn();
    repository.findById = vi.fn();
    repository.findByName = vi.fn();
    repository.create = vi.fn();
    repository.update = vi.fn();
    repository.remove = vi.fn();
    runtimeManager.removeToolsForServer = vi.fn();
    runtimeManager.reloadServer = vi.fn();
    runtimeManager.reloadAllServers = vi.fn();
    runtimeManager.testServer = vi.fn();
    runtimeManager.invokeTool = vi.fn();
    toolRegistryRepository.findByNamePrefix = vi.fn();
    secretReferenceResolver.assertSecretExists = vi
      .fn()
      .mockResolvedValue(undefined);
    (secretReferenceResolver as any).redactServer = vi.fn(
      (server: McpServer) => server,
    );
    service = new McpService(
      repository,
      toolRegistryRepository,
      runtimeManager,
      secretReferenceResolver,
    );
  });

  it('creates an HTTP MCP server and triggers runtime reload', async () => {
    repository.create = vi.fn().mockResolvedValue(baseServer);
    runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

    const result = await service.createServer({
      name: ' Git MCP ',
      enabled: true,
      transport_type: McpTransportType.HTTP,
      url: 'http://localhost:4000/mcp',
      enabled: true,
    });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Git MCP',
        transport_type: McpTransportType.HTTP,
      }),
    );
    expect(runtimeManager.reloadServer).toHaveBeenCalledWith(baseServer.id);
    expect(result).toEqual(baseServer);
  });

  it('rejects stdio server creation when command is missing', async () => {
    await expect(
      service.createServer({
        name: 'Broken Stdio MCP',
        enabled: true,
        transport_type: McpTransportType.STDIO,
        enabled: true,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates an existing server and reloads it', async () => {
    repository.findById = vi.fn().mockResolvedValue(baseServer);
    repository.update = vi.fn().mockResolvedValue({
      ...baseServer,
      max_retries: 5,
    });
    runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

    const result = await service.updateServer(baseServer.id, {
      max_retries: 5,
    });

    expect(repository.update).toHaveBeenCalledWith(
      baseServer.id,
      expect.objectContaining({ max_retries: 5 }),
    );
    expect(runtimeManager.reloadServer).toHaveBeenCalledWith(baseServer.id);
    expect(result.max_retries).toBe(5);
  });

  it('updates an existing server addressed by stable name', async () => {
    repository.findByName = vi.fn().mockResolvedValue(baseServer);
    repository.update = vi.fn().mockResolvedValue({
      ...baseServer,
      max_retries: 3,
    });
    runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

    const result = await service.updateServer('Git MCP', {
      max_retries: 3,
    });

    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      baseServer.id,
      expect.objectContaining({ max_retries: 3 }),
    );
    expect(runtimeManager.reloadServer).toHaveBeenCalledWith(baseServer.id);
    expect(result.max_retries).toBe(3);
  });

  it('throws NotFoundException when updating unknown server', async () => {
    repository.findById = vi.fn().mockResolvedValue(null);

    await expect(service.updateServer('missing-id', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('deletes a server and removes synced MCP tools', async () => {
    repository.findById = vi.fn().mockResolvedValue(baseServer);

    const result = await service.deleteServer(baseServer.id);

    expect(runtimeManager.removeToolsForServer).toHaveBeenCalledWith(
      baseServer.id,
    );
    expect(repository.remove).toHaveBeenCalledWith(baseServer.id);
    expect(result).toEqual({ id: baseServer.id });
  });

  it('lists registry tools linked to an MCP server', async () => {
    repository.findById = vi.fn().mockResolvedValue(baseServer);
    toolRegistryRepository.findByNamePrefix = vi.fn().mockResolvedValue([
      {
        id: 'tool-1',
        name: 'mcp_server_1_git_status',
        mcp_server_id: baseServer.id,
        updated_at: baseServer.updated_at,
      },
    ]);

    const result = await service.listServerTools(baseServer.id);

    expect(toolRegistryRepository.findByNamePrefix).toHaveBeenCalledWith(
      buildMcpToolPrefix(baseServer.id),
    );
    expect(result).toEqual([
      {
        id: 'tool-1',
        name: 'mcp_server_1_git_status',
        mcp_server_id: baseServer.id,
        updated_at: baseServer.updated_at,
      },
    ]);
  });

  it('lists registry tools for a server addressed by stable name', async () => {
    repository.findByName = vi.fn().mockResolvedValue(baseServer);
    toolRegistryRepository.findByNamePrefix = vi.fn().mockResolvedValue([]);

    await service.listServerTools('Git MCP');

    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.findByName).toHaveBeenCalledWith('Git MCP');
    expect(toolRegistryRepository.findByNamePrefix).toHaveBeenCalledWith(
      buildMcpToolPrefix(baseServer.id),
    );
  });

  describe('resolveHeadersForServer', () => {
    it('delegates to the SecretReferenceResolver with the server credentials', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      const server = {
        ...baseServer,
        headers_secret_id: secretId,
      };
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

  describe('resolveEnvForServer', () => {
    it('delegates to the SecretReferenceResolver with the stdio env credentials', async () => {
      const secretId = '77777777-7777-4777-8777-777777777777';
      const server = {
        ...baseServer,
        transport_type: McpTransportType.STDIO,
        env_secret_id: secretId,
      };
      const resolved = { LOG_LEVEL: 'debug' };
      secretReferenceResolver.resolveMap = vi.fn().mockResolvedValue(resolved);

      const result = await service.resolveEnvForServer(server);

      expect(secretReferenceResolver.resolveMap).toHaveBeenCalledWith({
        secretId,
        plaintext: server.env,
        purpose: 'env',
        serverName: server.name,
      });
      expect(result).toBe(resolved);
    });
  });

  describe('createServer / updateServer secret validation', () => {
    it('rejects creation when the headers_secret_id does not reference an existing secret', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      secretReferenceResolver.assertSecretExists = vi
        .fn()
        .mockRejectedValue(
          new BadRequestException(
            `headers_secret_id does not reference an existing secret (${secretId})`,
          ),
        );

      await expect(
        service.createServer({
          name: 'External MCP',
          enabled: true,
          transport_type: McpTransportType.HTTP,
          url: 'https://example.com/mcp',
          headers_secret_id: secretId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects creation when env_secret_id is set on a non-stdio server', async () => {
      const secretId = '77777777-7777-4777-8777-777777777777';

      await expect(
        service.createServer({
          name: 'External MCP',
          enabled: true,
          transport_type: McpTransportType.HTTP,
          url: 'https://example.com/mcp',
          env_secret_id: secretId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('accepts creation with env_secret_id on a stdio server when secret exists', async () => {
      const secretId = '77777777-7777-4777-8777-777777777777';
      const createdServer = {
        ...baseServer,
        transport_type: McpTransportType.STDIO,
        env_secret_id: secretId,
      };
      repository.create = vi.fn().mockResolvedValue(createdServer);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });

      const result = await service.createServer({
        name: 'Local MCP',
        enabled: true,
        transport_type: McpTransportType.STDIO,
        command: 'npx',
        env_secret_id: secretId,
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          transport_type: McpTransportType.STDIO,
          env_secret_id: secretId,
        }),
      );
      expect(result.env_secret_id).toBe(secretId);
    });

    it('rejects creation when env_secret_id does not reference an existing secret', async () => {
      const secretId = '77777777-7777-4777-8777-777777777777';
      const assertMock = vi
        .fn()
        .mockImplementation(async (candidate: string | null | undefined) => {
          if (candidate === secretId) {
            throw new BadRequestException(
              `env_secret_id does not reference an existing secret (${secretId})`,
            );
          }
        });
      secretReferenceResolver.assertSecretExists = assertMock;

      await expect(
        service.createServer({
          name: 'Local MCP',
          enabled: true,
          transport_type: McpTransportType.STDIO,
          command: 'npx',
          env_secret_id: secretId,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(assertMock).toHaveBeenCalledWith(secretId, 'env');
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('redacts server responses to drop plaintext when the secret FK is set', async () => {
      const secretId = '99999999-9999-4999-8999-999999999999';
      const createdServer = {
        ...baseServer,
        headers_secret_id: secretId,
        headers: { authorization: 'Bearer plaintext' },
      };
      const redacted = { ...createdServer, headers: null };
      repository.create = vi.fn().mockResolvedValue(createdServer);
      runtimeManager.reloadServer = vi.fn().mockResolvedValue({ ok: true });
      secretReferenceResolver.redactServer = vi.fn().mockReturnValue(redacted);

      const result = await service.createServer({
        name: 'External MCP',
        enabled: true,
        transport_type: McpTransportType.HTTP,
        url: 'https://example.com/mcp',
        headers_secret_id: secretId,
      });

      expect(secretReferenceResolver.redactServer).toHaveBeenCalledWith(
        createdServer,
      );
      expect(result.headers).toBeNull();
    });
  });
});
