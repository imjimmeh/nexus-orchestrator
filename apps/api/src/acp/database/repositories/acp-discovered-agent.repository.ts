import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AcpDiscoveredAgent } from '../entities/acp-discovered-agent.entity';

@Injectable()
export class AcpDiscoveredAgentRepository {
  constructor(
    @InjectRepository(AcpDiscoveredAgent)
    private readonly repository: Repository<AcpDiscoveredAgent>,
  ) {}

  async findByServerId(serverId: string): Promise<AcpDiscoveredAgent[]> {
    return this.repository.find({
      where: { server_id: serverId },
      order: { agent_name: 'ASC' },
    });
  }

  async findByRegistryToolName(
    registryToolName: string,
  ): Promise<AcpDiscoveredAgent | null> {
    return this.repository.findOne({
      where: { registry_tool_name: registryToolName },
    });
  }

  async findRegisteredByServerId(
    serverId: string,
  ): Promise<AcpDiscoveredAgent[]> {
    return this.repository.find({
      where: { server_id: serverId, is_registered: true },
      order: { agent_name: 'ASC' },
    });
  }

  async create(data: Partial<AcpDiscoveredAgent>): Promise<AcpDiscoveredAgent> {
    const agent = this.repository.create(data);
    return this.repository.save(agent);
  }

  async upsertByServerAndAgentName(
    serverId: string,
    agentName: string,
    data: QueryDeepPartialEntity<AcpDiscoveredAgent>,
  ): Promise<AcpDiscoveredAgent> {
    const existing = await this.repository.findOne({
      where: { server_id: serverId, agent_name: agentName },
    });
    if (existing) {
      await this.repository.update(existing.id, data);
      const updated = await this.findById(existing.id);
      if (!updated) {
        throw new Error(
          `Updated discovered agent not found for id ${existing.id}`,
        );
      }
      return updated;
    }
    return this.create({
      server_id: serverId,
      agent_name: agentName,
      ...data,
    } as AcpDiscoveredAgent);
  }

  async findById(id: string): Promise<AcpDiscoveredAgent | null> {
    return this.repository.findOne({ where: { id } });
  }

  async deleteByServerId(serverId: string): Promise<void> {
    await this.repository.delete({ server_id: serverId });
  }

  async updateRegistrationStatus(
    id: string,
    isRegistered: boolean,
    registryToolName?: string,
  ): Promise<void> {
    await this.repository.update(id, {
      is_registered: isRegistered,
      registry_tool_name: registryToolName ?? null,
    });
  }
}
