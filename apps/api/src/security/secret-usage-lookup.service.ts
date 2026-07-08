import { Injectable } from '@nestjs/common';
import { LlmProviderRepository } from '../ai-config/database/repositories/llm-provider.repository';
import { AcpServerRepository } from '../acp/database/repositories/acp-server.repository';
import { McpServerRepository } from '../mcp/database/repositories/mcp-server.repository';
import type { SecretUsageReference } from './secret-usage-lookup.types';

@Injectable()
export class SecretUsageLookupService {
  constructor(
    private readonly providerRepository: LlmProviderRepository,
    private readonly mcpServerRepository: McpServerRepository,
    private readonly acpServerRepository: AcpServerRepository,
  ) {}

  async findUsages(secretId: string): Promise<SecretUsageReference[]> {
    const [providers, mcpServers, acpServers] = await Promise.all([
      this.providerRepository.findAll(),
      this.mcpServerRepository.findAll(),
      this.acpServerRepository.findAll(),
    ]);

    return [
      ...providers
        .filter((provider) => provider.secret_id === secretId)
        .map((provider) => ({
          type: 'llm_provider' as const,
          id: provider.id,
          name: provider.name,
          field: 'secret_id',
        })),
      ...mcpServers.flatMap((server) =>
        [
          { field: 'headers_secret_id', value: server.headers_secret_id },
          { field: 'env_secret_id', value: server.env_secret_id },
        ]
          .filter((reference) => reference.value === secretId)
          .map((reference) => ({
            type: 'mcp_server' as const,
            id: server.id,
            name: server.name,
            field: reference.field,
          })),
      ),
      ...acpServers.flatMap((server) =>
        [
          { field: 'auth_secret_id', value: server.auth_secret_id },
          { field: 'headers_secret_id', value: server.headers_secret_id },
        ]
          .filter((reference) => reference.value === secretId)
          .map((reference) => ({
            type: 'acp_server' as const,
            id: server.id,
            name: server.name,
            field: reference.field,
          })),
      ),
    ];
  }
}
