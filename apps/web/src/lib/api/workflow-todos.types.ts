/**
 * Workflow todo-list types — moved out of `./types.ts` so the rest of the
 * web API client can consume a stable surface while the legacy
 * `./types.ts` is incrementally depopulated by child-7.
 *
 * This family does not depend on `Timestamps`; the wire format uses
 * explicit per-field timestamps so the runtime update boundary can be
 * checked independently.
 */

export type WorkflowRunTodoStatus = "not-started" | "in-progress" | "completed";

export type WorkflowRunTodoSourceKind = "manual" | "context_source";

export interface WorkflowRunTodoItem {
  id: string;
  title: string;
  status: WorkflowRunTodoStatus;
  order_index: number;
  source_kind: WorkflowRunTodoSourceKind;
  source_context_item_id: string | null;
  updated_at: string;
}

export interface WorkflowRunTodoSummary {
  total_count: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
}

export interface WorkflowRunTodoSourceInfo {
  mode: "manual" | "context_source" | "mixed";
  has_drift: boolean;
  stale_count: number;
}

export interface WorkflowRunTodoList {
  workflow_run_id: string;
  scope_id: string | null;
  context_id: string | null;
  todo_list: WorkflowRunTodoItem[];
  summary: WorkflowRunTodoSummary;
  source: WorkflowRunTodoSourceInfo;
  _markdown: string;
}

export interface UpdateWorkflowRunTodoListRequest {
  todo_list?: Array<{
    id?: string;
    title?: string;
    status: WorkflowRunTodoStatus;
    source_context_item_id?: string;
  }>;
  todoList?: Array<{
    id?: string;
    title?: string;
    status: WorkflowRunTodoStatus;
    source_context_item_id?: string;
  }>;
}
