import { BadRequestException } from '@nestjs/common';
import { McpServerStatus, McpTransportType } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from './database/entities/mcp-server.entity';
import type { McpServerRepository } from './database/repositories/mcp-server.repository';
import type { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type { CapabilityRegistrarService } from '../tool-registry/capability-registrar.service';
import type { ToolRegistryService } from '../tool-registry/tool-registry.service';
import {
  buildMcpRegistryToolName,
  buildMcpToolPrefix,
} from './mcp-tool-name.utils';
import { McpRuntimeManagerService } from './mcp-runtime-manager.service';
import type { McpTransportFactory } from './mcp-transport.factory';

describe('McpRuntimeManagerService', () => {
  const server: McpServer = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Git MCP',
    enabled: true,
    transport_type: McpTransportType.HTTP,
    command: null,
    args: null,
    url: 'http://localhost:4000/mcp',
    headers: null,
    include_tools: null,
    exclude_tools: null,
    timeout_ms: 30000,
    connect_timeout_ms: 10000,
    max_retries: 1,
    retry_backoff_ms: 1,
    last_status: McpServerStatus.UNKNOWN,
    last_error: null,
    last_connected_at: null,
    last_discovered_at: null,
    last_discovered_tool_count: null,
    created_at: new Date('2026-04-12T00:00:00.000Z'),
    updated_at: new Date('2026-04-12T00:00:00.000Z'),
  };

  const mcpServerRepository = {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as McpServerRepository;

  const toolRegistryRepository = {
    findByNamePrefix: vi.fn(),
    findByMcpServerId: vi.fn(),
  } as unknown as ToolRegistryRepository;

  const capabilityRegistrar = {
    registerToolProjection: vi.fn(),
  } as unknown as CapabilityRegistrarService;

  const toolRegistryService = {
    deleteTool: vi.fn(),
  } as unknown as ToolRegistryService;

  const transportFactory = {
    listTools: vi.fn(),
    callTool: vi.fn(),
  } as unknown as McpTransportFactory;

  const eventLedger = {
    emitBestEffort: vi.fn(),
  } as unknown as EventLedgerService;

  let service: McpRuntimeManagerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mcpServerRepository.findAll = vi.fn();
    mcpServerRepository.findById = vi.fn();
    mcpServerRepository.findByName = vi.fn();
    mcpServerRepository.create = vi.fn();
    mcpServerRepository.update = vi.fn();
    toolRegistryRepository.findByNamePrefix = vi.fn();
    toolRegistryRepository.findByMcpServerId = vi.fn().mockResolvedValue([]);
    transportFactory.listTools = vi.fn();
    transportFactory.callTool = vi.fn();
    process.env.MCP_RECONCILIATION_ENABLED = 'false';

    service = new McpRuntimeManagerService(
      mcpServerRepository,
      toolRegistryRepository,
      capabilityRegistrar,
      toolRegistryService,
      transportFactory,
      eventLedger,
    );
  });

  it('reloads enabled servers and reconciles stale tools', async () => {
    const discovered = [
      { name: 'git/status', description: 'Get git status', inputSchema: {} },
      { name: 'git/diff', description: 'Get git diff', inputSchema: {} },
    ];

    mcpServerRepository.findAll = vi.fn().mockResolvedValue([server]);
    transportFactory.listTools = vi
      .fn()
      .mockResolvedValue({ tools: discovered });

    const expectedToolName = buildMcpRegistryToolName(server.id, 'git/status');
    const stalePrefix = buildMcpToolPrefix(server.id);
    toolRegistryRepository.findByMcpServerId = vi.fn().mockResolvedValue([
      { id: 'tool-1', name: expectedToolName },
      { id: 'tool-stale', name: `${stalePrefix}stale_aaaaaaaa` },
    ]);

    const result = await service.reloadAllServers();

    expect(result.total_servers).toBe(1);
    expect(result.succeeded_servers).toBe(1);
    expect(result.failed_servers).toBe(0);

    // Two tools × two registrations each (hashed name + remote name)
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledTimes(4);
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'external_mcp',
      }),
    );
    expect(toolRegistryService.deleteTool).toHaveBeenCalledWith('tool-stale');

    expect(mcpServerRepository.update).toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({
        last_status: McpServerStatus.CONNECTED,
        last_error: null,
        last_discovered_tool_count: 2,
      }),
    );
  });

  it('calls reloadAllServers on application bootstrap', async () => {
    mcpServerRepository.findAll = vi.fn().mockResolvedValue([]);

    await service.onApplicationBootstrap();
    service.onModuleDestroy();

    expect(mcpServerRepository.findAll).toHaveBeenCalled();
  });

  it('registers each discovered tool under both its hashed registry name and its remote name', async () => {
    const externalServer = {
      ...server,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'external-mcp',
      url: 'http://external:3012/api/mcp',
      headers: { authorization: 'Bearer external-token' },
    } as McpServer;
    mcpServerRepository.findAll = vi.fn().mockResolvedValue([externalServer]);
    transportFactory.listTools = vi.fn().mockResolvedValue({
      tools: [
        {
          name: 'external.scope_state',
          description: 'Project state',
          inputSchema: { type: 'object' },
        },
        {
          name: 'external.orchestration_timeline',
          description: 'Orchestration timeline',
          inputSchema: { type: 'object' },
        },
        {
          name: 'external.publish_specs',
          description: 'Publish specs',
          inputSchema: { type: 'object' },
        },
        {
          name: 'external.orchestration_complete',
          description: 'Complete orchestration',
          inputSchema: { type: 'object' },
        },
        {
          name: 'external.write_probe_result',
          description: 'Write probe result',
          inputSchema: { type: 'object' },
        },
      ],
    });
    await service.reloadAllServers();

    // 5 tools × 2 registrations each (hashed name + remote name) = 10 calls
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledTimes(
      10,
    );

    // Hashed-name registration for external.scope_state
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'external_mcp',
        sourceMetadata: expect.objectContaining({
          server_id: externalServer.id,
          remote_tool_name: 'external.scope_state',
        }),
        tool: expect.objectContaining({
          mcp_server_id: externalServer.id,
          name: buildMcpRegistryToolName(
            externalServer.id,
            'external.scope_state',
          ),
          api_callback: expect.objectContaining({
            method: 'POST',
            body_mapping: { params: '__tool_params__' },
            path_template: expect.stringContaining(
              '/tools/external.scope_state/invoke',
            ),
          }),
        }),
      }),
    );

    // Remote-name registration for external.scope_state (directly callable)
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'external_mcp',
        sourceMetadata: expect.objectContaining({
          remote_tool_name: 'external.scope_state',
        }),
        tool: expect.objectContaining({
          name: 'external.scope_state',
          api_callback: expect.objectContaining({
            method: 'POST',
            body_mapping: { params: '__tool_params__' },
            path_template: expect.stringContaining(
              '/tools/external.scope_state/invoke',
            ),
          }),
        }),
      }),
    );

    // Remote-name registrations for remaining tools
    for (const remoteName of [
      'external.orchestration_timeline',
      'external.publish_specs',
      'external.orchestration_complete',
      'external.write_probe_result',
    ]) {
      expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: expect.objectContaining({ name: remoteName }),
        }),
      );
    }

    // Remote-name projection for external.write_probe_result (full detail)
    expect(capabilityRegistrar.registerToolProjection).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'external_mcp',
        sourceMetadata: expect.objectContaining({
          remote_tool_name: 'external.write_probe_result',
        }),
        tool: expect.objectContaining({
          name: 'external.write_probe_result',
          api_callback: expect.objectContaining({
            path_template: expect.stringContaining(
              '/tools/external.write_probe_result/invoke',
            ),
          }),
        }),
      }),
    );
  });

  it('marks disabled servers and prunes all managed tools', async () => {
    mcpServerRepository.findAll = vi.fn().mockResolvedValue([
      {
        ...server,
        enabled: false,
      },
    ]);
    toolRegistryRepository.findByNamePrefix = vi
      .fn()
      .mockResolvedValue([{ id: 'tool-1', name: 'stale' }]);

    const result = await service.reloadAllServers();

    expect(result.results[0]).toEqual(
      expect.objectContaining({
        ok: true,
        discovered_tool_count: 0,
        removed_tool_count: 1,
      }),
    );

    expect(mcpServerRepository.update).toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({
        last_status: McpServerStatus.DISABLED,
      }),
    );
  });

  it('invokes a remote MCP tool with runtime context and maps response payload', async () => {
    mcpServerRepository.findById = vi.fn().mockResolvedValue(server);
    transportFactory.callTool = vi.fn().mockResolvedValue({
      result: {
        ok: true,
        content: [{ type: 'text', text: 'status clean' }],
      },
    });

    const result = await service.invokeTool(
      server.id,
      'git/status',
      {
        path: '.',
      },
      {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
      },
    );

    expect(transportFactory.callTool).toHaveBeenCalledWith(
      server,
      'git/status',
      { path: '.' },
      {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
      },
    );
    expect(result.server_id).toBe(server.id);
    expect(result.remote_tool_name).toBe('git/status');
    expect(result.result.ok).toBe(true);
  });

  it('resolves MCP servers by stable name for invocation', async () => {
    mcpServerRepository.findByName = vi.fn().mockResolvedValue(server);
    transportFactory.callTool = vi.fn().mockResolvedValue({
      result: { ok: true },
    });

    const result = await service.invokeTool('Git MCP', 'git/status', {});

    expect(mcpServerRepository.findById).not.toHaveBeenCalled();
    expect(mcpServerRepository.findByName).toHaveBeenCalledWith('Git MCP');
    expect(result.server_id).toBe(server.id);
  });

  it('rejects invoke when server is disabled', async () => {
    mcpServerRepository.findById = vi.fn().mockResolvedValue({
      ...server,
      enabled: false,
    });

    await expect(
      service.invokeTool(server.id, 'git/status', {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('continues registering remaining tools when one tool registration throws', async () => {
    const discovered = [
      { name: 'git/status', description: 'Get git status', inputSchema: {} },
      { name: 'git/diff', description: 'Get git diff', inputSchema: {} },
      { name: 'git/log', description: 'Get git log', inputSchema: {} },
    ];

    mcpServerRepository.findAll = vi.fn().mockResolvedValue([server]);
    transportFactory.listTools = vi
      .fn()
      .mockResolvedValue({ tools: discovered });
    toolRegistryRepository.findByMcpServerId = vi.fn().mockResolvedValue([]);

    capabilityRegistrar.registerToolProjection = vi
      .fn()
      .mockImplementation((request: { tool: { name: string } }) => {
        if (request.tool.name === 'git/diff') {
          return Promise.reject(new Error('duplicate key violation'));
        }
        return Promise.resolve();
      });

    const result = await service.reloadAllServers();

    expect(result.succeeded_servers).toBe(1);
    expect(result.failed_servers).toBe(0);

    const calledNames = vi
      .mocked(capabilityRegistrar.registerToolProjection)
      .mock.calls.map(
        (call) => (call[0] as { tool: { name: string } }).tool.name,
      );
    expect(calledNames).toContain('git/status');
    expect(calledNames).toContain('git/log');

    expect(mcpServerRepository.update).toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({ last_status: McpServerStatus.CONNECTED }),
    );
  });
});
