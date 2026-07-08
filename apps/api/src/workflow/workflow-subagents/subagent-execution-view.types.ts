/**
 * In-memory projection of a subagent execution assembled from the consolidated
 * `executions` row and its `subagent_details` satellite.
 *
 * Replaces the deleted `SubagentExecution` TypeORM entity: the legacy
 * `subagent_executions` table no longer exists, so this view is the shape every
 * subagent read site and spawn-time in-memory record shares. Lifecycle/identity
 * fields originate from `executions`; the remaining fields originate from
 * `subagent_details`.
 */
export interface SubagentExecutionView {
  id: string;
  status: 'Spawning' | 'Running' | 'Completed' | 'Failed';
  child_container_id?: string;
  subagent_chat_session_id?: string | null;
  parent_container_id: string;
  delegation_contract_id?: string;
  lineage_trace_id?: string;
  lineage_parent_trace_id?: string;
  depth: number;
  assigned_files?: string[];
  parent_session_tree_id?: string;
  result?: Record<string, unknown>;
  /** Step role that spawned this subagent — used to enforce at-most-one-active-per-role. */
  role?: string;
  created_at: Date;
  completed_at?: Date;
}
