import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogRepository } from '../audit/database/repositories/audit-log.repository';
import { PluginAuditService } from './plugin-audit.service';

type MockAuditLogRepository = {
  log: ReturnType<typeof vi.fn>;
};

describe('PluginAuditService', () => {
  let service: PluginAuditService;
  let repository: MockAuditLogRepository;

  beforeEach(async () => {
    repository = {
      log: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module = await Test.createTestingModule({
      providers: [
        PluginAuditService,
        { provide: AuditLogRepository, useValue: repository },
      ],
    }).compile();

    service = module.get(PluginAuditService);
  });

  it('writes plugin lifecycle audit records through the audit repository', async () => {
    await service.recordLifecycleEvent({
      action: 'enable',
      actorId: 'admin-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      fromState: 'scanned',
      toState: 'enabled',
      result: 'success',
      metadata: { reason: 'approved' },
    });

    expect(repository.log).toHaveBeenCalledWith({
      event_type: 'PluginLifecycle',
      actor_id: 'admin-1',
      resource_id: 'com.acme.workflow-tools@1.2.3',
      action: 'enable',
      result: 'success',
      metadata: {
        plugin_id: 'com.acme.workflow-tools',
        version: '1.2.3',
        from_state: 'scanned',
        to_state: 'enabled',
        details: { reason: 'approved' },
      },
    });
  });

  it('keeps caller metadata from overriding canonical lifecycle fields', async () => {
    await service.recordLifecycleEvent({
      action: 'quarantine',
      actorId: 'admin-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      fromState: 'enabled',
      toState: 'quarantined',
      result: 'success',
      metadata: {
        plugin_id: 'attacker.plugin',
        version: '9.9.9',
        from_state: 'installed',
        to_state: 'enabled',
      },
    });

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          plugin_id: 'com.acme.workflow-tools',
          version: '1.2.3',
          from_state: 'enabled',
          to_state: 'quarantined',
          details: {
            plugin_id: 'attacker.plugin',
            version: '9.9.9',
            from_state: 'installed',
            to_state: 'enabled',
          },
        },
      }),
    );
  });

  it('writes runtime audit records without raw plugin payloads or secrets', async () => {
    await service.recordRuntimeEvent({
      action: 'runtime.invoke.success',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      operation: 'invoke',
      contributionId: 'summarize',
      result: 'success',
      metadata: {
        input: { token: 'secret-token' },
        output: { body: 'raw plugin response' },
        requestBytes: 512,
      },
    });

    expect(repository.log).toHaveBeenCalledWith({
      event_type: 'PluginRuntime',
      actor_id: 'operator-1',
      resource_id: 'com.acme.workflow-tools@1.2.3',
      action: 'runtime.invoke.success',
      result: 'success',
      metadata: {
        plugin_id: 'com.acme.workflow-tools',
        version: '1.2.3',
        isolation_mode: 'worker_process',
        operation: 'invoke',
        contribution_id: 'summarize',
        details: { requestBytes: 512 },
      },
    });
    expect(JSON.stringify(repository.log.mock.calls)).not.toContain(
      'secret-token',
    );
    expect(JSON.stringify(repository.log.mock.calls)).not.toContain(
      'raw plugin response',
    );
  });

  it('drops obvious runtime secret, env, path, and raw error metadata scalars', async () => {
    await service.recordRuntimeEvent({
      action: 'runtime.invoke.failure',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      operation: 'invoke',
      result: 'failure',
      metadata: {
        token: 'secret-token',
        apiKey: 'secret-api-key',
        DATABASE_URL: 'postgres://user:password@db/plugin',
        path: 'C:/sensitive/plugin.log',
        env: 'DATABASE_URL=postgres://user:password@db/plugin',
        raw_error: 'stack trace token=secret-token',
        reasonCode: 'permission_not_granted',
        timeoutMs: 1,
        errorCode: 'runtime_timeout',
      },
    });

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          details: {
            reasonCode: 'permission_not_granted',
            timeoutMs: 1,
            errorCode: 'runtime_timeout',
          },
        }),
      }),
    );
    const persistedAuditPayload = JSON.stringify(repository.log.mock.calls);
    expect(persistedAuditPayload).not.toContain('secret-token');
    expect(persistedAuditPayload).not.toContain('secret-api-key');
    expect(persistedAuditPayload).not.toContain('DATABASE_URL');
    expect(persistedAuditPayload).not.toContain('C:/sensitive/plugin.log');
    expect(persistedAuditPayload).not.toContain('raw_error');
  });

  it('drops unsafe runtime identifiers and allowed metadata scalars', async () => {
    await service.recordRuntimeEvent({
      action: 'runtime.policy.denied',
      actorId: 'operator-1',
      pluginId: 'com.acme.workflow-tools',
      version: '1.2.3',
      mode: 'worker_process',
      operation: 'invoke DATABASE_URL=postgres://secret C:/payload.json',
      contributionId:
        'summarize token=secret-token /workspace/raw-payload.json',
      result: 'denied',
      metadata: {
        reasonCode: 'permission_not_granted',
        message: 'Denied token=secret-token DATABASE_URL=postgres://secret',
        reason: 'shutdown because /workspace/raw-payload.json leaked',
        topic: 'workflow.completed token=secret-token',
      },
    });

    expect(repository.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          plugin_id: 'com.acme.workflow-tools',
          version: '1.2.3',
          isolation_mode: 'worker_process',
          operation: 'runtime',
          details: { reasonCode: 'permission_not_granted' },
        },
      }),
    );
    const persistedAuditPayload = JSON.stringify(repository.log.mock.calls);
    expect(persistedAuditPayload).not.toContain('secret-token');
    expect(persistedAuditPayload).not.toContain('DATABASE_URL');
    expect(persistedAuditPayload).not.toContain('/workspace/raw-payload.json');
    expect(persistedAuditPayload).not.toContain('C:/payload.json');
    expect(persistedAuditPayload).not.toContain('shutdown because');
  });

  it('builds runtime audit payloads for denials, timeouts, crashes, shutdowns, and quarantine triggers', () => {
    const payloads = [
      service.buildRuntimeEventPayload({
        action: 'runtime.policy.denied',
        actorId: 'operator-1',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
        operation: 'invoke',
        result: 'denied',
        metadata: { reasonCode: 'permission_not_granted' },
      }),
      service.buildRuntimeEventPayload({
        action: 'runtime.invoke.timeout',
        actorId: 'operator-1',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
        operation: 'invoke',
        result: 'failure',
        metadata: { timeoutMs: 1, payload: { secret: 'hidden' } },
      }),
      service.buildRuntimeEventPayload({
        action: 'runtime.crash',
        actorId: 'plugin-runtime-supervisor',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'container',
        operation: 'crash',
        result: 'failure',
        metadata: { errorCode: 'container_crashed' },
      }),
      service.buildRuntimeEventPayload({
        action: 'runtime.shutdown.success',
        actorId: 'operator-1',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'worker_process',
        operation: 'shutdown',
        result: 'success',
        metadata: { reason: 'operator-request' },
      }),
      service.buildRuntimeEventPayload({
        action: 'runtime.quarantine.triggered',
        actorId: 'plugin-runtime-supervisor',
        pluginId: 'com.acme.workflow-tools',
        version: '1.2.3',
        mode: 'container',
        operation: 'quarantine',
        result: 'success',
        metadata: { crashCount: 3, quarantined: true },
      }),
    ];

    expect(payloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'runtime.policy.denied',
          result: 'denied',
        }),
        expect.objectContaining({
          action: 'runtime.invoke.timeout',
          result: 'failure',
        }),
        expect.objectContaining({ action: 'runtime.crash', result: 'failure' }),
        expect.objectContaining({
          action: 'runtime.shutdown.success',
          result: 'success',
        }),
        expect.objectContaining({
          action: 'runtime.quarantine.triggered',
          result: 'success',
        }),
      ]),
    );
    expect(JSON.stringify(payloads)).not.toContain('hidden');
  });
});
