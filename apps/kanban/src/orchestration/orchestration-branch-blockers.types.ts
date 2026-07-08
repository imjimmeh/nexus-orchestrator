export type BranchBlockerWorkItem = {
  id: string;
  title?: string | null;
  status?: string | null;
  type?: string | null;
  parent_work_item_id?: string | null;
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  execution_config?: Record<string, unknown> | null;
  executionConfig?: Record<string, unknown> | null;
};

export type TargetBranchBlocker = {
  item: BranchBlockerWorkItem;
  branch: string;
  owners: BranchBlockerWorkItem[];
};
