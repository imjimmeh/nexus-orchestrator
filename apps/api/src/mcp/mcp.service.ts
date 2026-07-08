import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  IMcpInvokeToolResult,
  IMcpReloadResult,
  IMcpReloadServerResult,
  IMcpServerTestResult,
} from '@nexus/core';
import { McpTransportType } from '@nexus/core';
import { McpServer } from './database/entities/mcp-server.entity';
import { McpServerRepository } from './database/repositories/mcp-server.repository';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import type {
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
} from '@nexus/core';
import {
  assignDirectValues,
  assignIfDefined,
  normalizeEnv,
  normalizeHeaders,
  normalizeNullableString,
  normalizeStringArray,
} from '../common/utils/server-payload.utils';
import { McpRuntimeManagerService } from './mcp-runtime-manager.service';
import { buildMcpToolPrefix } from './mcp-tool-name.utils';
import type { McpRuntimeContext } from './mcp.types';
import { SecretReferenceResolver } from '../security/secret-reference-resolver.service';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly mcpServerRepository: McpServerRepository,
    private readonly toolRegistryRepository: ToolRegistryRepository,
    private readonly runtimeManager: McpRuntimeManagerService,
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async listServers(): Promise<McpServer[]> {
    const servers = await this.mcpServerRepository.findAll();
    return servers.map((server) =>
      this.secretReferenceResolver.redactServer(server),
    );
  }

  async createServer(dto: CreateMcpServerRequest): Promise<McpServer> {
    const payload = this.buildCreatePayload(dto);
    this.validateServerConfig(payload);

    await this.secretReferenceResolver.assertSecretExists(
      payload.headers_secret_id,
      'headers',
    );
    await this.secretReferenceResolver.assertSecretExists(
      payload.env_secret_id,
      'env',
    );

    const server = await this.mcpServerRepository.create(payload);
    await this.syncServerBestEffort(server);
    return this.secretReferenceResolver.redactServer(server);
  }

  async updateServer(
    id: string,
    dto: UpdateMcpServerRequest,
  ): Promise<McpServer> {
    const existing = await this.requireServer(id);
    const patch = this.buildUpdatePayload(dto);
    const merged = Object.assign({}, existing, patch) as Partial<McpServer>;

    this.validateServerConfig(merged);

    await this.secretReferenceResolver.assertSecretExists(
      patch.headers_secret_id,
      'headers',
    );
    await this.secretReferenceResolver.assertSecretExists(
      patch.env_secret_id,
      'env',
    );

    const updated = await this.mcpServerRepository.update(existing.id, patch);
    if (!updated) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }

    await this.syncServerBestEffort(updated);
    return this.secretReferenceResolver.redactServer(updated);
  }

  async deleteServer(id: string): Promise<{ id: string }> {
    const server = await this.requireServer(id);
    await this.runtimeManager.removeToolsForServer(server.id);
    await this.mcpServerRepository.remove(server.id);
    return { id: server.id };
  }

  async testServer(id: string): Promise<IMcpServerTestResult> {
    return this.runtimeManager.testServer(id);
  }

  async listServerTools(id: string): Promise<
    Array<{
      id: string;
      name: string;
      mcp_server_id: string | null;
      updated_at: Date;
    }>
  > {
    const server = await this.requireServer(id);
    const tools = await this.toolRegistryRepository.findByNamePrefix(
      buildMcpToolPrefix(server.id),
    );

    return tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      mcp_server_id: tool.mcp_server_id ?? null,
      updated_at: tool.updated_at,
    }));
  }

  async reloadAllServers(): Promise<IMcpReloadResult> {
    return this.runtimeManager.reloadAllServers();
  }

  async reloadServer(id: string): Promise<IMcpReloadServerResult> {
    return this.runtimeManager.reloadServer(id);
  }

  async invokeTool(
    id: string,
    toolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<IMcpInvokeToolResult> {
    return this.runtimeManager.invokeTool(id, toolName, params, runtimeContext);
  }

  /**
   * Resolve the headers map that should actually be sent to the MCP server.
   *
   * The `*_secret_id` column takes precedence over the plaintext
   * `headers` column. Used by the transport client to avoid persisting
   * the resolved values on the entity.
   */
  async resolveHeadersForServer(
    server: McpServer,
  ): Promise<Record<string, string> | null> {
    return this.secretReferenceResolver.resolveMap({
      secretId: server.headers_secret_id,
      plaintext: server.headers,
      purpose: 'headers',
      serverName: server.name,
    });
  }

  /**
   * Resolve the env map that should be merged onto the spawned stdio
   * child process's environment.
   *
   * The `env_secret_id` column takes precedence over the plaintext
   * `env` column. Used by the stdio transport client to avoid persisting
   * the resolved values on the entity.
   */
  async resolveEnvForServer(
    server: McpServer,
  ): Promise<Record<string, string> | null> {
    return this.secretReferenceResolver.resolveMap({
      secretId: server.env_secret_id,
      plaintext: server.env,
      purpose: 'env',
      serverName: server.name,
    });
  }

  private buildCreatePayload(dto: CreateMcpServerRequest): Partial<McpServer> {
    return {
      name: dto.name.trim(),
      enabled: dto.enabled ?? true,
      transport_type: dto.transport_type,
      command: normalizeNullableString(dto.command),
      args: normalizeStringArray(dto.args),
      url: normalizeNullableString(dto.url),
      headers: normalizeHeaders(dto.headers),
      headers_secret_id: dto.headers_secret_id ?? null,
      env: normalizeEnv(dto.env),
      env_secret_id: dto.env_secret_id ?? null,
      include_tools: normalizeStringArray(dto.include_tools),
      exclude_tools: normalizeStringArray(dto.exclude_tools),
      timeout_ms: dto.timeout_ms ?? 30000,
      connect_timeout_ms: dto.connect_timeout_ms ?? 10000,
      max_retries: dto.max_retries ?? 2,
      retry_backoff_ms: dto.retry_backoff_ms ?? 1000,
    };
  }

  private buildUpdatePayload(dto: UpdateMcpServerRequest): Partial<McpServer> {
    const payload: Partial<McpServer> = {};

    const directValues: Partial<McpServer> = {
      enabled: dto.enabled,
      transport_type: dto.transport_type,
      timeout_ms: dto.timeout_ms,
      connect_timeout_ms: dto.connect_timeout_ms,
      max_retries: dto.max_retries,
      retry_backoff_ms: dto.retry_backoff_ms,
    };

    assignIfDefined(payload, 'name', dto.name?.trim());
    assignDirectValues(payload, directValues);

    if (dto.command !== undefined) {
      payload.command = normalizeNullableString(dto.command);
    }
    if (dto.args !== undefined) {
      payload.args = normalizeStringArray(dto.args);
    }
    if (dto.url !== undefined) {
      payload.url = normalizeNullableString(dto.url);
    }
    if (dto.headers !== undefined) {
      payload.headers = normalizeHeaders(dto.headers);
    }
    if (dto.headers_secret_id !== undefined) {
      payload.headers_secret_id = dto.headers_secret_id;
    }
    if (dto.env !== undefined) {
      payload.env = normalizeEnv(dto.env);
    }
    if (dto.env_secret_id !== undefined) {
      payload.env_secret_id = dto.env_secret_id;
    }
    if (dto.include_tools !== undefined) {
      payload.include_tools = normalizeStringArray(dto.include_tools);
    }
    if (dto.exclude_tools !== undefined) {
      payload.exclude_tools = normalizeStringArray(dto.exclude_tools);
    }

    return payload;
  }

  private validateServerConfig(server: Partial<McpServer>): void {
    if (!server.name || server.name.trim().length === 0) {
      throw new BadRequestException('MCP server name is required');
    }

    if (!server.transport_type) {
      throw new BadRequestException('MCP server transport_type is required');
    }

    if (
      server.transport_type === McpTransportType.STDIO &&
      (!server.command || server.command.trim().length === 0)
    ) {
      throw new BadRequestException(
        'MCP stdio server requires a non-empty command',
      );
    }

    if (
      server.transport_type === McpTransportType.HTTP &&
      (!server.url || server.url.trim().length === 0)
    ) {
      throw new BadRequestException('MCP HTTP server requires a non-empty url');
    }

    if (
      server.transport_type !== McpTransportType.STDIO &&
      server.env_secret_id
    ) {
      throw new BadRequestException(
        'MCP env_secret_id is only valid for stdio transport',
      );
    }
  }

  private async syncServerBestEffort(server: McpServer): Promise<void> {
    if (!server.enabled) {
      await this.runtimeManager.removeToolsForServer(server.id);
      return;
    }

    const result = await this.runtimeManager.reloadServer(server.id);
    if (!result.ok) {
      this.logger.warn(
        `MCP server ${server.name} saved but runtime reload failed: ${result.error ?? 'unknown error'}`,
      );
    }
  }

  private async requireServer(id: string): Promise<McpServer> {
    const server = UUID_PATTERN.test(id)
      ? await this.mcpServerRepository.findById(id)
      : await this.mcpServerRepository.findByName(id);
    if (!server) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }

    return server;
  }
}
