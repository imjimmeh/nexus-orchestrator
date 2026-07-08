import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AcpRunMode,
  type IAcpInvokeAgentResult,
  type IAcpReloadResult,
  type IAcpReloadServerResult,
  type IAcpServerTestResult,
} from '@nexus/core';
import { AcpServer } from './database/entities/acp-server.entity';
import { AcpDiscoveredAgent } from './database/entities/acp-discovered-agent.entity';
import { AcpServerRepository } from './database/repositories/acp-server.repository';
import { AcpDiscoveredAgentRepository } from './database/repositories/acp-discovered-agent.repository';
import type {
  CreateAcpServerRequest,
  UpdateAcpServerRequest,
} from '@nexus/core';
import {
  assignDirectValues,
  assignIfDefined,
  normalizeHeaders,
  normalizeNullableString,
  normalizeStringArray,
} from '../common/utils/server-payload.utils';
import { AcpRuntimeManagerService } from './acp-runtime-manager.service';
import { SecretReferenceResolver } from '../security/secret-reference-resolver.service';

@Injectable()
export class AcpService {
  private readonly logger = new Logger(AcpService.name);

  constructor(
    private readonly acpServerRepository: AcpServerRepository,
    private readonly acpDiscoveredAgentRepository: AcpDiscoveredAgentRepository,
    private readonly runtimeManager: AcpRuntimeManagerService,
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async listServers(): Promise<AcpServer[]> {
    const servers = await this.acpServerRepository.findAll();
    return servers.map((server) =>
      this.secretReferenceResolver.redactServer(server),
    );
  }

  async createServer(dto: CreateAcpServerRequest): Promise<AcpServer> {
    const payload = this.buildCreatePayload(dto);
    this.validateServerConfig(payload);

    await this.secretReferenceResolver.assertSecretExists(
      payload.auth_secret_id,
      'auth',
    );
    await this.secretReferenceResolver.assertSecretExists(
      payload.headers_secret_id,
      'headers',
    );

    const server = await this.acpServerRepository.create(payload);
    await this.syncServerBestEffort(server);
    return this.secretReferenceResolver.redactServer(server);
  }

  async updateServer(
    id: string,
    dto: UpdateAcpServerRequest,
  ): Promise<AcpServer> {
    const existing = await this.requireServer(id);
    const patch = this.buildUpdatePayload(dto);
    const merged = Object.assign({}, existing, patch) as Partial<AcpServer>;

    this.validateServerConfig(merged);

    await this.secretReferenceResolver.assertSecretExists(
      patch.auth_secret_id,
      'auth',
    );
    await this.secretReferenceResolver.assertSecretExists(
      patch.headers_secret_id,
      'headers',
    );

    const updated = await this.acpServerRepository.update(id, patch);
    if (!updated) {
      throw new NotFoundException(`ACP server ${id} not found`);
    }

    await this.syncServerBestEffort(updated);
    return this.secretReferenceResolver.redactServer(updated);
  }

  async deleteServer(id: string): Promise<void> {
    await this.requireServer(id);
    await this.runtimeManager.removeAgentsForServer(id);
    await this.acpServerRepository.remove(id);
  }

  async testServer(id: string): Promise<IAcpServerTestResult> {
    return this.runtimeManager.testServer(id);
  }

  async reloadServer(id: string): Promise<IAcpReloadServerResult> {
    return this.runtimeManager.reloadServer(id);
  }

  async reloadAllServers(): Promise<IAcpReloadResult> {
    return this.runtimeManager.reloadAllServers();
  }

  async listDiscoveredAgents(serverId: string): Promise<AcpDiscoveredAgent[]> {
    await this.requireServer(serverId);
    return this.acpDiscoveredAgentRepository.findByServerId(serverId);
  }

  async getAgentManifest(
    serverId: string,
    agentName: string,
  ): Promise<AcpDiscoveredAgent> {
    await this.requireServer(serverId);
    const agents =
      await this.acpDiscoveredAgentRepository.findByServerId(serverId);
    const found = agents.find((a) => a.agent_name === agentName);
    if (!found) {
      throw new NotFoundException(
        `Agent ${agentName} not found on ACP server ${serverId}`,
      );
    }
    return found;
  }

  async invokeAgent(
    serverId: string,
    agentName: string,
    params: Record<string, unknown>,
    runModeOverride?: AcpRunMode,
  ): Promise<IAcpInvokeAgentResult> {
    return this.runtimeManager.invokeAgent(
      serverId,
      agentName,
      params,
      runModeOverride,
    );
  }

  /**
   * Resolve the auth_token that should actually be sent to the ACP server.
   *
   * The `auth_secret_id` column takes precedence over the plaintext
   * `auth_token` column. Used by the runtime manager to avoid persisting
   * the resolved value on the entity.
   */
  async resolveAuthTokenForServer(server: AcpServer): Promise<string | null> {
    return this.secretReferenceResolver.resolveString({
      secretId: server.auth_secret_id,
      plaintext: server.auth_token,
      purpose: 'auth',
      serverName: server.name,
      allowEmptySecret: true,
    });
  }

  /**
   * Resolve the headers map that should actually be sent to the ACP server.
   *
   * The `headers_secret_id` column takes precedence over the plaintext
   * `headers` column. Used by the runtime manager to avoid persisting
   * the resolved values on the entity.
   */
  async resolveHeadersForServer(
    server: AcpServer,
  ): Promise<Record<string, string> | null> {
    return this.secretReferenceResolver.resolveMap({
      secretId: server.headers_secret_id,
      plaintext: server.headers,
      purpose: 'headers',
      serverName: server.name,
    });
  }

  private buildCreatePayload(dto: CreateAcpServerRequest): Partial<AcpServer> {
    return {
      name: dto.name.trim(),
      enabled: dto.enabled ?? true,
      url: dto.url.trim(),
      auth_type: dto.auth_type,
      auth_token: normalizeNullableString(dto.auth_token),
      auth_secret_id: dto.auth_secret_id ?? null,
      headers: normalizeHeaders(dto.headers),
      headers_secret_id: dto.headers_secret_id ?? null,
      timeout_ms: dto.timeout_ms ?? 30000,
      connect_timeout_ms: dto.connect_timeout_ms ?? 10000,
      max_retries: dto.max_retries ?? 2,
      retry_backoff_ms: dto.retry_backoff_ms ?? 1000,
      default_run_mode: dto.default_run_mode,
      await_policy: dto.await_policy,
      include_agents: normalizeStringArray(dto.include_agents),
      exclude_agents: normalizeStringArray(dto.exclude_agents),
    };
  }

  private buildUpdatePayload(dto: UpdateAcpServerRequest): Partial<AcpServer> {
    const payload: Partial<AcpServer> = {};

    const directValues: Partial<AcpServer> = {
      enabled: dto.enabled,
      timeout_ms: dto.timeout_ms,
      connect_timeout_ms: dto.connect_timeout_ms,
      max_retries: dto.max_retries,
      retry_backoff_ms: dto.retry_backoff_ms,
      default_run_mode: dto.default_run_mode,
      await_policy: dto.await_policy,
    };

    assignIfDefined(payload, 'name', dto.name?.trim());
    assignDirectValues(payload, directValues);

    if (dto.url !== undefined) {
      payload.url = dto.url.trim();
    }
    if (dto.auth_type !== undefined) {
      payload.auth_type = dto.auth_type;
    }
    if (dto.auth_token !== undefined) {
      payload.auth_token = normalizeNullableString(dto.auth_token);
    }
    if (dto.auth_secret_id !== undefined) {
      payload.auth_secret_id = dto.auth_secret_id;
    }
    if (dto.headers !== undefined) {
      payload.headers = normalizeHeaders(dto.headers);
    }
    if (dto.headers_secret_id !== undefined) {
      payload.headers_secret_id = dto.headers_secret_id;
    }
    if (dto.include_agents !== undefined) {
      payload.include_agents = normalizeStringArray(dto.include_agents);
    }
    if (dto.exclude_agents !== undefined) {
      payload.exclude_agents = normalizeStringArray(dto.exclude_agents);
    }

    return payload;
  }

  private validateServerConfig(server: Partial<AcpServer>): void {
    if (!server.name || server.name.trim().length === 0) {
      throw new BadRequestException('ACP server name is required');
    }

    if (!server.url || server.url.trim().length === 0) {
      throw new BadRequestException('ACP server url is required');
    }
  }

  private async syncServerBestEffort(server: AcpServer): Promise<void> {
    if (!server.enabled) {
      await this.runtimeManager.removeAgentsForServer(server.id);
      return;
    }

    const result = await this.runtimeManager.reloadServer(server.id);
    if (!result.ok) {
      this.logger.warn(
        `ACP server ${server.name} saved but runtime reload failed: ${result.error ?? 'unknown error'}`,
      );
    }
  }

  private async requireServer(id: string): Promise<AcpServer> {
    const server = await this.acpServerRepository.findById(id);
    if (!server) {
      throw new NotFoundException(`ACP server ${id} not found`);
    }

    return server;
  }
}
