import { Injectable } from '@nestjs/common';
import { DoctorRepairHistoryRepository } from '../runtime/database/repositories/doctor-repair-history.repository';
import { McpServerRepository } from '../mcp/database/repositories/mcp-server.repository';
import { McpRuntimeManagerService } from '../mcp/mcp-runtime-manager.service';
import { DOCTOR_REPAIR_ACTION_DESCRIPTIONS } from './doctor-repair.constants';
import {
  mapDoctorRepairExecutionResult,
  mapDoctorRepairHistoryItem,
} from './doctor-repair-executor.mapper';
import type { RepairOutcome } from './doctor-repair-executor.types';
import {
  type DoctorRepairExecutionInput,
  type DoctorRepairExecutionResult,
  type DoctorRepairHistoryItem,
  type DoctorRepairOutcomeStatus,
} from './doctor.types';
import { DoctorWorkflowRepairService } from './doctor-workflow-repair.service';
import { RuntimeArtifactsInspectorService } from './runtime-artifacts-inspector.service';
import { SystemRecoveryRepairService } from './system-recovery-repair.service';

@Injectable()
export class DoctorRepairExecutorService {
  constructor(
    private readonly historyRepository: DoctorRepairHistoryRepository,
    private readonly workflowRepair: DoctorWorkflowRepairService,
    private readonly runtimeArtifactsInspector: RuntimeArtifactsInspectorService,
    private readonly mcpServerRepository: McpServerRepository,
    private readonly mcpRuntimeManager: McpRuntimeManagerService,
    private readonly systemRecoveryRepair: SystemRecoveryRepairService,
  ) {}

  async execute(
    input: DoctorRepairExecutionInput,
  ): Promise<DoctorRepairExecutionResult> {
    const actionDescription =
      DOCTOR_REPAIR_ACTION_DESCRIPTIONS[input.action_id];
    const attempt = await this.historyRepository.createAttempt({
      action_id: input.action_id,
      dry_run: input.dry_run,
      requested_by: input.requested_by ?? null,
      input_json: {
        action_id: input.action_id,
        dry_run: input.dry_run,
        arguments: input.arguments,
      },
    });

    try {
      const outcome = await this.executeAction(input);
      const updated = await this.historyRepository.completeAttempt(attempt.id, {
        status: outcome.status,
        result_json: {
          message: outcome.message,
          changes: outcome.changes,
        },
        evidence_json: outcome.evidence,
      });

      if (!updated) {
        throw new Error('Repair history record disappeared before completion');
      }

      return mapDoctorRepairExecutionResult({
        history: mapDoctorRepairHistoryItem(updated),
        outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const updated = await this.historyRepository.completeAttempt(attempt.id, {
        status: 'failed',
        result_json: {
          message,
          changes: {},
        },
        evidence_json: { action_description: actionDescription },
        error_message: message,
      });

      const fallback: DoctorRepairHistoryItem = {
        id: attempt.id,
        action_id: input.action_id,
        status: 'failed',
        dry_run: input.dry_run,
        requested_by: input.requested_by ?? null,
        input_json: {
          action_id: input.action_id,
          dry_run: input.dry_run,
          arguments: input.arguments,
        },
        result_json: {
          message,
          changes: {},
        },
        evidence_json: { action_description: actionDescription },
        error_message: message,
        started_at: attempt.started_at.toISOString(),
        finished_at: new Date().toISOString(),
        created_at: attempt.created_at.toISOString(),
      };

      return mapDoctorRepairExecutionResult({
        history: updated ? mapDoctorRepairHistoryItem(updated) : fallback,
        outcome: {
          status: 'failed',
          message,
          changes: {},
          evidence: { action_description: actionDescription },
        },
      });
    }
  }

  private async executeAction(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    switch (input.action_id) {
      case 'clear_stale_polling_markers':
        return this.workflowRepair.clearStalePollingMarkers(input);
      case 'requeue_recoverable_workflow_runs':
        return this.workflowRepair.requeueRecoverableWorkflowRuns(input);
      case 'prune_orphaned_runtime_artifacts':
        return this.pruneOrphanedRuntimeArtifacts(input);
      case 'refresh_mcp_plugin_catalogs':
        return this.refreshMcpPluginCatalogs(input);
      case 'clean_git_worktrees':
        return this.cleanGitWorktrees(input);
      case 'recover_api_fetch_failures':
        return this.recoverApiFetchFailures(input);
      case 'redispatch_producer_job_with_feedback':
        return this.workflowRepair.redispatchProducerJobWithFeedback(input);
      default:
        throw new Error(`Unsupported doctor repair action: ${input.action_id}`);
    }
  }

  private async cleanGitWorktrees(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    return this.systemRecoveryRepair.cleanGitWorktrees(input);
  }

  private async recoverApiFetchFailures(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    return this.systemRecoveryRepair.recoverApiFetchFailures(input);
  }

  private async pruneOrphanedRuntimeArtifacts(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    const inspection = await this.runtimeArtifactsInspector.inspect();
    const containerIds = [
      ...inspection.orphaned_container_ids,
      ...inspection.stale_container_ids,
    ];

    if (
      containerIds.length === 0 &&
      inspection.stale_mount_directories.length === 0 &&
      inspection.stale_host_share_mounts.length > 0
    ) {
      return {
        status: 'succeeded',
        message:
          'Stale host-share mount diagnostics found, but no removable runtime artifacts were detected.',
        changes: {
          removed_containers: 0,
          removed_directories: 0,
        },
        evidence: {
          inspection,
        },
      };
    }

    if (
      containerIds.length === 0 &&
      inspection.stale_mount_directories.length === 0
    ) {
      return {
        status: 'succeeded',
        message: 'No orphaned runtime artifacts were found.',
        changes: {
          removed_containers: 0,
          removed_directories: 0,
        },
        evidence: {
          inspection,
        },
      };
    }

    const pruneResult = await this.runtimeArtifactsInspector.pruneArtifacts({
      container_ids: containerIds,
      mount_directories: inspection.stale_mount_directories,
      dry_run: input.dry_run,
    });

    let status: DoctorRepairOutcomeStatus = 'failed';
    if (pruneResult.errors.length === 0) {
      status = 'succeeded';
    } else if (
      pruneResult.removed_containers.length > 0 ||
      pruneResult.removed_directories.length > 0
    ) {
      status = 'partial';
    }

    return {
      status,
      message: input.dry_run
        ? 'Dry run complete. Runtime artifacts identified for pruning.'
        : `Pruned ${pruneResult.removed_containers.length.toString()} container(s) and ${pruneResult.removed_directories.length.toString()} directory(ies).`,
      changes: {
        targeted_containers: containerIds.length,
        targeted_directories: inspection.stale_mount_directories.length,
        removed_containers: pruneResult.removed_containers.length,
        removed_directories: pruneResult.removed_directories.length,
        error_count: pruneResult.errors.length,
      },
      evidence: {
        inspection,
        removed_containers: pruneResult.removed_containers,
        removed_directories: pruneResult.removed_directories,
        errors: pruneResult.errors,
      },
    };
  }

  private async refreshMcpPluginCatalogs(
    input: DoctorRepairExecutionInput,
  ): Promise<RepairOutcome> {
    if (input.dry_run) {
      const servers = await this.mcpServerRepository.findAll();
      return {
        status: 'succeeded',
        message:
          'Dry run complete. MCP/plugin catalog refresh was validated but not executed.',
        changes: {
          total_servers: servers.length,
          refreshed_servers: 0,
        },
        evidence: {
          server_ids: servers.map((server) => server.id),
        },
      };
    }

    const reloadResult = await this.mcpRuntimeManager.reloadAllServers();
    let status: DoctorRepairOutcomeStatus = 'failed';
    if (reloadResult.failed_servers === 0) {
      status = 'succeeded';
    } else if (reloadResult.succeeded_servers > 0) {
      status = 'partial';
    }

    return {
      status,
      message:
        status === 'succeeded'
          ? 'MCP/plugin catalogs refreshed successfully.'
          : `MCP/plugin catalog refresh completed with ${reloadResult.failed_servers.toString()} failed server(s).`,
      changes: {
        total_servers: reloadResult.total_servers,
        succeeded_servers: reloadResult.succeeded_servers,
        failed_servers: reloadResult.failed_servers,
      },
      evidence: {
        reload_result: {
          ...reloadResult,
          started_at: reloadResult.started_at.toISOString(),
          completed_at: reloadResult.completed_at.toISOString(),
        },
      },
    };
  }
}
