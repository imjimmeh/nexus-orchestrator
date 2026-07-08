import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditLog } from '../audit/database/entities/audit-log.entity';
import { AuditLogRepository } from '../audit/database/repositories/audit-log.repository';
import type {
  PluginLifecycleAuditEvent,
  PluginRuntimeAuditEvent,
} from './plugin-audit.types';

const PLUGIN_LIFECYCLE_EVENT_TYPE = 'PluginLifecycle';
const PLUGIN_RUNTIME_EVENT_TYPE = 'PluginRuntime';
const RUNTIME_SAFE_METADATA_KEYS = new Set([
  'crashCount',
  'errorCode',
  'quarantined',
  'reasonCode',
  'requestBytes',
  'timeoutMs',
]);
const RUNTIME_SAFE_OPERATIONS = new Set([
  'crash',
  'event',
  'health',
  'invoke',
  'quarantine',
  'runtime',
  'shutdown',
  'start',
]);
const SAFE_RUNTIME_IDENTIFIER_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

@Injectable()
export class PluginAuditService {
  constructor(private readonly auditLogRepository: AuditLogRepository) {}

  async recordLifecycleEvent(
    event: PluginLifecycleAuditEvent,
    manager?: EntityManager,
  ): Promise<AuditLog> {
    const payload = this.buildLifecycleEventPayload(event);

    if (manager) {
      const repository = manager.getRepository(AuditLog);
      return repository.save(repository.create(payload));
    }

    return this.auditLogRepository.log(payload);
  }

  async recordRuntimeEvent(event: PluginRuntimeAuditEvent): Promise<AuditLog> {
    return this.auditLogRepository.log(this.buildRuntimeEventPayload(event));
  }

  buildLifecycleEventPayload(
    event: PluginLifecycleAuditEvent,
  ): Partial<AuditLog> {
    return {
      event_type: PLUGIN_LIFECYCLE_EVENT_TYPE,
      actor_id: event.actorId,
      resource_id: `${event.pluginId}@${event.version}`,
      action: event.action,
      result: event.result,
      metadata: {
        plugin_id: event.pluginId,
        version: event.version,
        ...(event.fromState ? { from_state: event.fromState } : {}),
        ...(event.toState ? { to_state: event.toState } : {}),
        ...(event.metadata ? { details: event.metadata } : {}),
      },
    };
  }

  buildRuntimeEventPayload(event: PluginRuntimeAuditEvent): Partial<AuditLog> {
    const safeMetadata = this.runtimeSafeMetadata(event.metadata);
    const safeContributionId = this.safeRuntimeIdentifier(event.contributionId);

    return {
      event_type: PLUGIN_RUNTIME_EVENT_TYPE,
      actor_id: event.actorId,
      resource_id: `${event.pluginId}@${event.version}`,
      action: event.action,
      result: event.result,
      metadata: {
        plugin_id: event.pluginId,
        version: event.version,
        isolation_mode: event.mode,
        operation: this.safeRuntimeOperation(event.operation),
        ...(safeContributionId ? { contribution_id: safeContributionId } : {}),
        ...(Object.keys(safeMetadata).length > 0
          ? { details: safeMetadata }
          : {}),
      },
    };
  }

  private runtimeSafeMetadata(
    metadata: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!metadata) return {};

    return Object.fromEntries(
      Object.entries(metadata).filter(
        ([key, value]) =>
          RUNTIME_SAFE_METADATA_KEYS.has(key) && this.isSafeScalar(value),
      ),
    );
  }

  private safeRuntimeOperation(operation: string): string {
    return RUNTIME_SAFE_OPERATIONS.has(operation) ? operation : 'runtime';
  }

  private safeRuntimeIdentifier(
    identifier: string | undefined,
  ): string | undefined {
    if (!identifier) return undefined;

    return SAFE_RUNTIME_IDENTIFIER_PATTERN.test(identifier)
      ? identifier
      : undefined;
  }

  private isSafeScalar(value: unknown): boolean {
    return (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    );
  }
}
