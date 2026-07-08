import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { KanbanExternalConnectionRepository } from "../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../database/repositories/kanban-sync-operation-log.repository.js";
import { ProviderRegistryService } from "./providers/provider-registry.service.js";
import { SyncCoordinatorService } from "./sync-engine/sync-coordinator.service.js";
import { OutboundSyncService } from "./sync-engine/outbound-sync.service.js";
import type {
  ConnectionStatus,
  ExternalConnectionCreateInput,
  ExternalConnectionRecord,
  ExternalConnectionUpdateInput,
  SyncMode,
  SyncOperationRecord,
  SyncRunResult,
  SyncTransport,
  TestConnectionResult,
} from "./external-sync.types.js";

const VALID_SYNC_MODES = new Set<string>([
  "inbound",
  "outbound",
  "bidirectional",
]);
const VALID_SYNC_TRANSPORTS = new Set<string>([
  "manual",
  "webhook",
  "polling",
  "both",
]);
const VALID_STATUSES = new Set<string>(["active", "paused", "error"]);

@Injectable()
export class ExternalSyncService {
  constructor(
    private readonly connectionRepo: KanbanExternalConnectionRepository,
    private readonly operationLogRepo: KanbanSyncOperationLogRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly syncCoordinator: SyncCoordinatorService,
    private readonly outboundSync: OutboundSyncService,
  ) {}

  async create(
    projectId: string,
    input: ExternalConnectionCreateInput,
  ): Promise<ExternalConnectionRecord> {
    this.validateCreateInput(input);

    const provider = this.providerRegistry.resolve(input.provider_type);
    const configValid = await provider.validateConfig(input.config ?? {});
    if (!configValid) {
      throw new BadRequestException(
        `Invalid config for provider type: ${input.provider_type}`,
      );
    }

    const entity = await this.connectionRepo.create({
      project_id: projectId,
      provider_type: input.provider_type,
      name: input.name,
      sync_mode: input.sync_mode,
      sync_transport: input.sync_transport,
      config: input.config ?? {},
      field_mapping: input.field_mapping ?? {},
      webhook_secret_ref: input.webhook_secret_ref ?? null,
      poll_interval_seconds: input.poll_interval_seconds ?? null,
    });

    return this.toRecord(entity);
  }

  async listByProject(projectId: string): Promise<ExternalConnectionRecord[]> {
    const entities = await this.connectionRepo.listByProject(projectId);
    return entities.map((e) => this.toRecord(e));
  }

  async getByProjectAndId(
    projectId: string,
    id: string,
  ): Promise<ExternalConnectionRecord> {
    const entity = await this.connectionRepo.findByProjectAndId(projectId, id);
    if (!entity) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }
    return this.toRecord(entity);
  }

  async updateByProjectAndId(
    projectId: string,
    id: string,
    input: ExternalConnectionUpdateInput,
  ): Promise<ExternalConnectionRecord> {
    const existing = await this.connectionRepo.findByProjectAndId(
      projectId,
      id,
    );
    if (!existing) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    this.validateUpdateInput(input);

    if (input.config) {
      const provider = this.providerRegistry.resolve(existing.provider_type);
      const configValid = await provider.validateConfig(input.config);
      if (!configValid) {
        throw new BadRequestException(
          `Invalid config for provider type: ${existing.provider_type}`,
        );
      }
    }

    const updated = await this.connectionRepo.updateByProjectAndId(
      projectId,
      id,
      input,
    );

    if (!updated) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    return this.toRecord(updated);
  }

  async deleteByProjectAndId(projectId: string, id: string): Promise<null> {
    const deleted = await this.connectionRepo.deleteByProjectAndId(
      projectId,
      id,
    );
    if (!deleted) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }
    return null;
  }

  async test(projectId: string, id: string): Promise<TestConnectionResult> {
    const entity = await this.connectionRepo.findByProjectAndId(projectId, id);
    if (!entity) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    const provider = this.providerRegistry.resolve(entity.provider_type);
    const valid = await provider.validateConfig(entity.config);

    if (!valid) {
      throw new BadRequestException(
        `Connection config is invalid for provider type: ${entity.provider_type}`,
      );
    }

    return { provider_type: entity.provider_type, valid: true };
  }

  async pause(
    projectId: string,
    id: string,
  ): Promise<ExternalConnectionRecord> {
    const existing = await this.connectionRepo.findByProjectAndId(
      projectId,
      id,
    );
    if (!existing) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    const updatedPause = await this.connectionRepo.updateByProjectAndId(
      projectId,
      id,
      { status: "paused" },
    );

    if (!updatedPause) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    return this.toRecord(updatedPause);
  }

  async resume(
    projectId: string,
    id: string,
  ): Promise<ExternalConnectionRecord> {
    const existing = await this.connectionRepo.findByProjectAndId(
      projectId,
      id,
    );
    if (!existing) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    const updatedResume = await this.connectionRepo.updateByProjectAndId(
      projectId,
      id,
      { status: "active" },
    );

    if (!updatedResume) {
      throw new NotFoundException(
        `External connection ${id} not found in project ${projectId}`,
      );
    }

    return this.toRecord(updatedResume);
  }

  async listOperations(
    projectId: string,
    connectionId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<SyncOperationRecord[]> {
    const existing = await this.connectionRepo.findByProjectAndId(
      projectId,
      connectionId,
    );
    if (!existing) {
      throw new NotFoundException(
        `External connection ${connectionId} not found in project ${projectId}`,
      );
    }

    const entities = await this.operationLogRepo.listByConnection(
      connectionId,
      limit,
      offset,
    );

    return entities.map((e) => ({
      id: e.id,
      connection_id: e.connection_id,
      project_id: e.project_id,
      work_item_id: e.work_item_id,
      external_id: e.external_id,
      direction: e.direction,
      operation: e.operation,
      status: e.status,
      message: e.message,
      details: e.details,
      started_at:
        e.started_at instanceof Date
          ? e.started_at.toISOString()
          : String(e.started_at),
      completed_at:
        e.completed_at instanceof Date
          ? e.completed_at.toISOString()
          : e.completed_at
            ? String(e.completed_at)
            : null,
      created_at:
        e.created_at instanceof Date
          ? e.created_at.toISOString()
          : String(e.created_at),
      updated_at:
        e.updated_at instanceof Date
          ? e.updated_at.toISOString()
          : String(e.updated_at),
    }));
  }

  sync(projectId: string, connectionId: string): Promise<SyncRunResult> {
    return this.syncCoordinator.sync(projectId, connectionId);
  }

  import(projectId: string, connectionId: string): Promise<SyncRunResult> {
    return this.syncCoordinator.importTickets(projectId, connectionId);
  }

  exportWorkItems(
    projectId: string,
    connectionId: string,
  ): Promise<SyncRunResult> {
    return this.outboundSync.exportWorkItems(projectId, connectionId);
  }

  private validateCreateInput(input: ExternalConnectionCreateInput): void {
    if (!input.provider_type || input.provider_type.trim().length === 0) {
      throw new BadRequestException("provider_type is required");
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new BadRequestException("name is required");
    }
    if (input.sync_mode && !VALID_SYNC_MODES.has(input.sync_mode)) {
      throw new BadRequestException(
        `Invalid sync_mode: ${input.sync_mode}. Must be one of: ${[...VALID_SYNC_MODES].join(", ")}`,
      );
    }
    if (
      input.sync_transport &&
      !VALID_SYNC_TRANSPORTS.has(input.sync_transport)
    ) {
      throw new BadRequestException(
        `Invalid sync_transport: ${input.sync_transport}. Must be one of: ${[...VALID_SYNC_TRANSPORTS].join(", ")}`,
      );
    }
  }

  private validateUpdateInput(input: ExternalConnectionUpdateInput): void {
    if (input.sync_mode && !VALID_SYNC_MODES.has(input.sync_mode)) {
      throw new BadRequestException(
        `Invalid sync_mode: ${input.sync_mode}. Must be one of: ${[...VALID_SYNC_MODES].join(", ")}`,
      );
    }
    if (
      input.sync_transport &&
      !VALID_SYNC_TRANSPORTS.has(input.sync_transport)
    ) {
      throw new BadRequestException(
        `Invalid sync_transport: ${input.sync_transport}. Must be one of: ${[...VALID_SYNC_TRANSPORTS].join(", ")}`,
      );
    }
    if (input.status && !VALID_STATUSES.has(input.status)) {
      throw new BadRequestException(
        `Invalid status: ${input.status}. Must be one of: ${[...VALID_STATUSES].join(", ")}`,
      );
    }
  }

  private toRecord(entity: {
    id: string;
    project_id: string;
    provider_type: string;
    name: string;
    status: string;
    sync_mode: string;
    sync_transport: string;
    config: Record<string, unknown>;
    field_mapping: Record<string, unknown>;
    webhook_secret_ref: string | null;
    poll_interval_seconds: number | null;
    last_sync_at: Date | null;
    last_sync_error: string | null;
    created_at: Date;
    updated_at: Date;
  }): ExternalConnectionRecord {
    return {
      id: entity.id,
      project_id: entity.project_id,
      provider_type: entity.provider_type,
      name: entity.name,
      status: entity.status as ConnectionStatus,
      sync_mode: entity.sync_mode as SyncMode,
      sync_transport: entity.sync_transport as SyncTransport,
      config: entity.config,
      field_mapping: entity.field_mapping,
      webhook_secret_ref: entity.webhook_secret_ref,
      poll_interval_seconds: entity.poll_interval_seconds,
      last_sync_at: entity.last_sync_at?.toISOString() ?? null,
      last_sync_error: entity.last_sync_error,
      created_at: entity.created_at.toISOString(),
      updated_at: entity.updated_at.toISOString(),
    };
  }
}
