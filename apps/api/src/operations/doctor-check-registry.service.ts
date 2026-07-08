import { Injectable } from '@nestjs/common';
import type { DoctorCheck } from './checks/doctor-check.types';
import { WorkflowStuckStateCheckService } from './checks/workflow-stuck-state.check';
import { QueueLagDeadLetterCheckService } from './checks/queue-lag-dead-letter.check';
import { SplitServiceHealthCheckService } from './checks/split-service-health.check';
import { ContainerRuntimeIntegrityCheckService } from './checks/container-runtime-integrity.check';
import { ContractSchemaMismatchCheckService } from './checks/contract-schema-mismatch.check';
import { ToolPluginRegistryIntegrityCheckService } from './checks/tool-plugin-registry-integrity.check';
import { GitWorktreeIntegrityCheckService } from './checks/git-worktree-integrity.check';
import { ApiConnectivityCheckService } from './checks/api-connectivity.check';
import type { DoctorCheckResult } from './doctor.types';

@Injectable()
export class DoctorCheckRegistryService {
  constructor(
    private readonly workflowStuckStateCheck: WorkflowStuckStateCheckService,
    private readonly queueLagDeadLetterCheck: QueueLagDeadLetterCheckService,
    private readonly splitServiceHealthCheck: SplitServiceHealthCheckService,
    private readonly containerRuntimeIntegrityCheck: ContainerRuntimeIntegrityCheckService,
    private readonly contractSchemaMismatchCheck: ContractSchemaMismatchCheckService,
    private readonly toolPluginRegistryIntegrityCheck: ToolPluginRegistryIntegrityCheckService,
    private readonly gitWorktreeIntegrityCheck: GitWorktreeIntegrityCheckService,
    private readonly apiConnectivityCheck: ApiConnectivityCheckService,
  ) {}

  listChecks(): DoctorCheck[] {
    return [
      this.workflowStuckStateCheck,
      this.queueLagDeadLetterCheck,
      this.splitServiceHealthCheck,
      this.containerRuntimeIntegrityCheck,
      this.contractSchemaMismatchCheck,
      this.toolPluginRegistryIntegrityCheck,
      this.gitWorktreeIntegrityCheck,
      this.apiConnectivityCheck,
    ];
  }

  async runAll(): Promise<DoctorCheckResult[]> {
    const checks = this.listChecks();
    return Promise.all(checks.map((check) => check.run()));
  }
}
