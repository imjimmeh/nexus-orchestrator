import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import type { ExecutionEntity } from '../../execution-lifecycle/database/entities/execution.entity';
import type { ExecutionState } from '../../execution-lifecycle/execution-lifecycle.contracts';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { SubagentDetails } from '../database/entities/subagent-details.entity';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';

const SUBAGENT_EXECUTION_KIND = 'subagent';

type LegacySubagentStatus = SubagentExecutionView['status'];

type SatelliteFields = Pick<
  SubagentExecutionView,
  | 'parent_container_id'
  | 'delegation_contract_id'
  | 'lineage_trace_id'
  | 'lineage_parent_trace_id'
  | 'parent_session_tree_id'
  | 'depth'
  | 'result'
  | 'assigned_files'
  | 'role'
>;

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * Projects an `executions` row's lifecycle state onto the legacy
 * `subagent_executions.status` enum so existing read sites keep their exact
 * semantics while reading from the consolidated `executions` table.
 *
 * The legacy projection wrote `Spawning` at create-time (execution `pending` /
 * `provisioning`), flipped to `Running` once the container was provisioned
 * (`running` and beyond), `Completed` on success, and `Failed` for every
 * terminal failure path (`failed` / `reaped` / `cancelled`).
 */
export function projectSubagentStatusFromState(
  state: ExecutionState,
): LegacySubagentStatus {
  switch (state) {
    case 'completed':
      return 'Completed';
    // Intentional parity: legacy code wrote status='Failed' on cancel; the precise cause is in failure_reason.
    case 'failed':
    case 'reaped':
    case 'cancelled':
      return 'Failed';
    case 'pending':
    case 'provisioning':
      return 'Spawning';
    default:
      return 'Running';
  }
}

/**
 * Assembles a `SubagentExecutionView`-shaped read projection from the consolidated
 * `executions` row plus the `subagent_details` satellite, so subagent read
 * sites no longer query the legacy `subagent_executions` table.
 *
 * Identity/lifecycle fields (`status`, `child_container_id`,
 * `subagent_chat_session_id`, timestamps) come from `executions`; the satellite
 * fields (`parent_container_id`, lineage, delegation, depth, `assigned_files`,
 * `parent_session_tree_id`, `result`) come from `subagent_details`.
 */
@Injectable()
export class SubagentExecutionReadModel {
  private readonly logger = new Logger(SubagentExecutionReadModel.name);

  constructor(
    private readonly executionRepo: ExecutionRepository,
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
  ) {}

  async findById(id: string): Promise<SubagentExecutionView | null> {
    const execution = await this.executionRepo.findById(id);
    if (!execution || execution.kind !== SUBAGENT_EXECUTION_KIND) {
      return null;
    }
    const details = await this.subagentDetailsRepo.findByExecutionId(id);
    return this.assemble(execution, details);
  }

  async findByParentContainerId(
    parentContainerId: string,
  ): Promise<SubagentExecutionView[]> {
    const details =
      await this.subagentDetailsRepo.findByParentContainerId(parentContainerId);
    if (details.length === 0) {
      return [];
    }
    const executions = await this.executionRepo.findManyByIds(
      details.map((detail) => detail.execution_id),
    );
    const detailsById = new Map(
      details.map((detail) => [detail.execution_id, detail]),
    );
    return executions
      .filter((execution) => execution.kind === SUBAGENT_EXECUTION_KIND)
      .map((execution) =>
        this.assemble(execution, detailsById.get(execution.id) ?? null),
      );
  }

  async findByChildContainerId(
    childContainerId: string,
  ): Promise<SubagentExecutionView | null> {
    const execution = await this.executionRepo.findByContainerId(
      childContainerId,
      SUBAGENT_EXECUTION_KIND,
    );
    if (!execution) {
      return null;
    }
    const details = await this.subagentDetailsRepo.findByExecutionId(
      execution.id,
    );
    return this.assemble(execution, details);
  }

  private assemble(
    execution: ExecutionEntity,
    details: SubagentDetails | null,
  ): SubagentExecutionView {
    const satellite = this.normalizeSatelliteFields(details, execution.id);
    return {
      id: execution.id,
      child_container_id: execution.container_id ?? undefined,
      status: projectSubagentStatusFromState(execution.state),
      subagent_chat_session_id: execution.chat_session_id ?? null,
      created_at: execution.created_at,
      completed_at: execution.terminal_at ?? undefined,
      ...satellite,
    };
  }

  /**
   * Maps the satellite row's nullable columns onto the legacy
   * `subagent_executions` field shape (which uses `undefined` rather than
   * `null` for absent values), defaulting to the legacy create-time values when
   * no satellite row exists.
   */
  private normalizeSatelliteFields(
    details: SubagentDetails | null,
    executionId: string,
  ): SatelliteFields {
    if (!details) {
      this.logger.warn(
        `Execution ${executionId} has no subagent_details row — returning defaults (data-consistency anomaly)`,
      );
      return { parent_container_id: '', depth: 0 };
    }
    return {
      parent_container_id: details.parent_container_id,
      delegation_contract_id: nullToUndefined(details.delegation_contract_id),
      lineage_trace_id: nullToUndefined(details.lineage_trace_id),
      lineage_parent_trace_id: nullToUndefined(details.lineage_parent_trace_id),
      parent_session_tree_id: nullToUndefined(details.parent_session_tree_id),
      depth: details.depth,
      result: nullToUndefined(details.result),
      assigned_files: nullToUndefined(details.assigned_files),
      role: nullToUndefined(details.role),
    };
  }
}
