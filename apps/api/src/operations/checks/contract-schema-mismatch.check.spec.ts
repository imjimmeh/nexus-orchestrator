import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { IWorkflowDefinitionRepository } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import type { WorkflowBootstrapValidatorService } from '../../workflow/workflow-bootstrap-validator.service';
import { ContractSchemaMismatchCheckService } from './contract-schema-mismatch.check';

vi.mock('../../database/migrations/registered-migrations', () => ({
  registeredMigrations: [
    { name: 'ApiPostCutoverBaseline20260517000000' },
    { name: 'CreateRuntimeFeedbackSignalGroups20260517100000' },
    { name: 'AddRuntimeFeedbackWindowState20260517110000' },
    { name: 'CreatePluginRegistryEntries20260517120000' },
    { name: 'CreatePluginEventDeliveries20260518120000' },
  ],
}));

function createService(
  appliedRows: Array<{ name: string; timestamp: number }>,
) {
  const query = vi.fn().mockResolvedValue(appliedRows);
  const dataSource = {
    query,
  } as unknown as DataSource;
  const workflowRepository = {
    findAll: vi.fn().mockResolvedValue([]),
  } as unknown as IWorkflowDefinitionRepository;
  const workflowBootstrapValidator = {
    validateCriticalWorkflows: vi
      .fn()
      .mockReturnValue({ ok: true, errors: [] }),
  } as unknown as WorkflowBootstrapValidatorService;

  const service = new ContractSchemaMismatchCheckService(
    dataSource,
    workflowRepository,
    workflowBootstrapValidator,
  );

  return { query, service };
}

const registeredAppliedMigrationRows = [
  {
    name: 'ApiPostCutoverBaseline20260517000000',
    timestamp: 20260517000000,
  },
  {
    name: 'CreateRuntimeFeedbackSignalGroups20260517100000',
    timestamp: 20260517100000,
  },
  {
    name: 'AddRuntimeFeedbackWindowState20260517110000',
    timestamp: 20260517110000,
  },
  {
    name: 'CreatePluginRegistryEntries20260517120000',
    timestamp: 20260517120000,
  },
  {
    name: 'CreatePluginEventDeliveries20260518120000',
    timestamp: 20260518120000,
  },
];

function createServiceWithMigrationReadError(error: Error) {
  const query = vi.fn().mockRejectedValue(error);
  const dataSource = {
    query,
  } as unknown as DataSource;
  const workflowRepository = {
    findAll: vi.fn().mockResolvedValue([]),
  } as unknown as IWorkflowDefinitionRepository;
  const workflowBootstrapValidator = {
    validateCriticalWorkflows: vi
      .fn()
      .mockReturnValue({ ok: true, errors: [] }),
  } as unknown as WorkflowBootstrapValidatorService;

  const service = new ContractSchemaMismatchCheckService(
    dataSource,
    workflowRepository,
    workflowBootstrapValidator,
  );

  return { query, service };
}

describe('ContractSchemaMismatchCheckService', () => {
  it('reports archived pre-cutover migration rows as actionable drift', async () => {
    const { service } = createService([
      {
        name: 'AddSessionArchivalColumns20260405010000',
        timestamp: 20260405010000,
      },
      ...registeredAppliedMigrationRows,
    ]);

    const result = await service.run();
    const details = result.evidence.details as {
      migration_drift: { applied_unexpected_migrations: string[] };
    };

    expect(result.status).toBe('warn');
    expect(details.migration_drift.applied_unexpected_migrations).toEqual([
      'AddSessionArchivalColumns20260405010000',
    ]);
  });

  it('reports an unexpected migration that reuses an archived timestamp', async () => {
    const { service } = createService([
      {
        name: 'UnexpectedArchivedTimestamp20260405010000',
        timestamp: 20260405010000,
      },
      ...registeredAppliedMigrationRows,
    ]);

    const result = await service.run();
    const details = result.evidence.details as {
      migration_drift: { applied_unexpected_migrations: string[] };
    };

    expect(result.status).toBe('warn');
    expect(details.migration_drift.applied_unexpected_migrations).toEqual([
      'UnexpectedArchivedTimestamp20260405010000',
    ]);
  });

  it('uses stable migration ordering and sorted drift output', async () => {
    const { query, service } = createService([
      { name: 'ZetaUnexpected20260517000000', timestamp: 20260517000000 },
      { name: 'AlphaUnexpected20260517000000', timestamp: 20260517000000 },
      ...registeredAppliedMigrationRows,
    ]);

    const result = await service.run();
    const details = result.evidence.details as {
      migration_drift: { applied_unexpected_migrations: string[] };
    };

    expect(query).toHaveBeenCalledWith(
      'SELECT name, timestamp FROM migrations ORDER BY timestamp ASC, name ASC',
    );
    expect(details.migration_drift.applied_unexpected_migrations).toEqual([
      'AlphaUnexpected20260517000000',
      'ZetaUnexpected20260517000000',
    ]);
  });

  it('fails when migration drift cannot be read', async () => {
    const { service } = createServiceWithMigrationReadError(
      new Error('relation "migrations" does not exist'),
    );

    const result = await service.run();
    const details = result.evidence.details as {
      migration_drift: { read_error: string | null };
    };

    expect(result.status).toBe('fail');
    expect(result.evidence.summary).toBe(
      'Failed to read database migration drift: relation "migrations" does not exist',
    );
    expect(details.migration_drift.read_error).toBe(
      'relation "migrations" does not exist',
    );
  });
});
