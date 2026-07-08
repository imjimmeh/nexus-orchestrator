import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { registeredMigrations } from '../../database/migrations/registered-migrations';
import { WORKFLOW_DEFINITION_REPOSITORY_PORT } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowDefinitionRepository } from '../../workflow/kernel/interfaces/workflow-kernel.ports';
import { WorkflowBootstrapValidatorService } from '../../workflow/workflow-bootstrap-validator.service';
import type { DoctorCheck } from './doctor-check.types';
import {
  type DoctorCheckResult,
  type DoctorCheckStatus,
} from '../doctor.types';

@Injectable()
export class ContractSchemaMismatchCheckService implements DoctorCheck {
  readonly checkId = 'contract_schema_version_mismatch_check';

  constructor(
    private readonly dataSource: DataSource,
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository: IWorkflowDefinitionRepository,
    private readonly workflowBootstrapValidator: WorkflowBootstrapValidatorService,
  ) {}

  async run(): Promise<DoctorCheckResult> {
    const migrationDrift = await this.inspectMigrationDrift();
    const contractValidation = await this.inspectCriticalContracts();

    const status = this.resolveStatus({
      missingMigrations: migrationDrift.missing_migrations.length,
      contractErrors: contractValidation.errors.length,
      appliedUnexpectedMigrations:
        migrationDrift.applied_unexpected_migrations.length,
      migrationReadError: migrationDrift.read_error,
    });

    const summary = this.buildSummary({
      missingMigrations: migrationDrift.missing_migrations.length,
      contractErrors: contractValidation.errors.length,
      appliedUnexpectedMigrations:
        migrationDrift.applied_unexpected_migrations.length,
      migrationReadError: migrationDrift.read_error,
    });

    return {
      check_id: this.checkId,
      status,
      evidence: {
        summary,
        details: {
          migration_drift: migrationDrift,
          workflow_contract_validation: contractValidation,
        },
      },
    };
  }

  private async inspectMigrationDrift(): Promise<{
    registered_migration_count: number;
    applied_migration_count: number;
    missing_migrations: string[];
    applied_unexpected_migrations: string[];
    read_error: string | null;
  }> {
    try {
      const appliedRows: Array<{ name?: string; timestamp?: number | string }> =
        await this.dataSource.query(
          'SELECT name, timestamp FROM migrations ORDER BY timestamp ASC, name ASC',
        );

      const appliedMigrationNames = new Set(
        appliedRows
          .map((row) => row.name)
          .filter((name): name is string => typeof name === 'string'),
      );
      const registeredMigrationNames = registeredMigrations
        .map((migration) => migration.name)
        .sort((left, right) => left.localeCompare(right));
      const registeredMigrationNameSet = new Set(registeredMigrationNames);

      const missingMigrations = registeredMigrationNames.filter(
        (name) => !appliedMigrationNames.has(name),
      );
      const appliedUnexpectedMigrations = [...appliedMigrationNames]
        .filter((name) => !registeredMigrationNameSet.has(name))
        .sort((left, right) => left.localeCompare(right));

      return {
        registered_migration_count: registeredMigrationNames.length,
        applied_migration_count: appliedRows.length,
        missing_migrations: missingMigrations,
        applied_unexpected_migrations: appliedUnexpectedMigrations,
        read_error: null,
      };
    } catch (error) {
      return {
        registered_migration_count: registeredMigrations.length,
        applied_migration_count: 0,
        missing_migrations: [],
        applied_unexpected_migrations: [],
        read_error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async inspectCriticalContracts(): Promise<{
    ok: boolean;
    errors: string[];
  }> {
    const workflows = await this.workflowRepository.findAll({
      includeInactive: true,
    });

    return this.workflowBootstrapValidator.validateCriticalWorkflows(workflows);
  }

  private resolveStatus(params: {
    missingMigrations: number;
    contractErrors: number;
    appliedUnexpectedMigrations: number;
    migrationReadError: string | null;
  }): DoctorCheckStatus {
    if (
      params.migrationReadError ||
      params.missingMigrations > 0 ||
      params.contractErrors > 0
    ) {
      return 'fail';
    }

    if (params.appliedUnexpectedMigrations > 0) {
      return 'warn';
    }

    return 'ok';
  }

  private buildSummary(params: {
    missingMigrations: number;
    contractErrors: number;
    appliedUnexpectedMigrations: number;
    migrationReadError: string | null;
  }): string {
    if (params.migrationReadError) {
      return `Failed to read database migration drift: ${params.migrationReadError}`;
    }

    if (params.missingMigrations > 0) {
      return `Detected ${params.missingMigrations.toString()} unapplied database migration(s).`;
    }

    if (params.contractErrors > 0) {
      return `Detected ${params.contractErrors.toString()} critical workflow contract mismatch(es).`;
    }

    if (params.appliedUnexpectedMigrations > 0) {
      return `Detected ${params.appliedUnexpectedMigrations.toString()} migration(s) not registered in the running build.`;
    }

    return 'Schema and contract drift checks passed.';
  }
}
