export interface WorkflowFileTrigger {
  readonly phase: string;
  readonly hook: "before" | "after";
  readonly blocking: boolean;
}

export interface WorkflowFileItem {
  path: string;
  size: number;
  trigger: WorkflowFileTrigger | null;
}

export interface FileListResponse {
  files: WorkflowFileItem[];
  error?: string;
}

export interface FileReadResponse {
  content: string;
}

export interface CommitPathsResult {
  committed: boolean;
  status: string;
  changed_files: Array<{ path: string; status: string }>;
  commit_sha: string | null;
}
