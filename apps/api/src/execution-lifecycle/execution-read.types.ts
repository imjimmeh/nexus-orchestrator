import type { ExecutionEntity } from './database/entities/execution.entity';

export interface ExecutionReadModel {
  id: string;
  kind: string;
  state: string;
  provider: string | null;
  model: string | null;
  harnessId: string | null;
  agentProfileName: string | null;
  providerSource: string | null;
  workflowRunId: string | null;
  chatSessionId: string | null;
  contextId: string | null;
  createdAt: string;
  terminalAt: string | null;
}

export function toExecutionReadModel(row: ExecutionEntity): ExecutionReadModel {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    provider: row.provider ?? null,
    model: row.model ?? null,
    harnessId: row.harness_id ?? null,
    agentProfileName: row.agent_profile_name ?? null,
    providerSource: row.provider_source ?? null,
    workflowRunId: row.workflow_run_id ?? null,
    chatSessionId: row.chat_session_id ?? null,
    contextId: row.context_id ?? null,
    createdAt: row.created_at.toISOString(),
    terminalAt: row.terminal_at ? row.terminal_at.toISOString() : null,
  };
}
