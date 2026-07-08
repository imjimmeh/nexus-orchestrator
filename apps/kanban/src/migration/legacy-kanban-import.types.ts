export type LegacyProjectRow = {
  id: string;
  name: string;
  repositoryUrl?: string | null;
  basePath?: string | null;
  githubSecretId?: string | null;
  description?: string | null;
  sourceType?: string | null;
  copyToWorkspace?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyWorkItemRow = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string;
  scope?: "standard" | "large";
  assignedAgentId?: string | null;
  tokenSpend?: number;
  currentExecutionId?: string | null;
  waitingForInput?: boolean;
  executionConfig?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyGoalRow = {
  id: string;
  project_id: string;
  title: string;
  description?: string | null;
  status: string;
  moscow?: string | null;
  priority?: string | null;
  sortOrder?: number;
  targetDate?: string | null;
  completedAt?: Date | null;
  ownerAgentProfileId?: string | null;
  metadata?: Record<string, unknown> | null;
  isArchived?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyGoalWorklogRow = {
  id: string;
  goalId: string;
  project_id: string;
  workItemId?: string | null;
  entryType?: string;
  authorType?: string;
  authorId?: string | null;
  authorName?: string | null;
  note: string;
  linkedRunId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyWorkItemDependencyRow = {
  id: string;
  workItemId: string;
  dependsOnWorkItemId: string;
};

export type LegacySubtaskRow = {
  id: string;
  project_id: string;
  workItemId: string;
  subtaskId: string;
  title: string;
  status: string;
  orderIndex: number;
  dependsOnSubtaskIds?: string[] | null;
  sourcePath: string;
  sourceHash: string;
  sourceLastSyncedAt?: Date | null;
  isArchived?: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KanbanRow = { id: string } & Record<string, unknown>;

export type LegacyKanbanImportSource = {
  projects?: LegacyProjectRow[];
  workItems?: LegacyWorkItemRow[];
  goals?: LegacyGoalRow[];
  goalWorklogs?: LegacyGoalWorklogRow[];
  dependencies?: LegacyWorkItemDependencyRow[];
  subtasks?: LegacySubtaskRow[];
};

export type LegacyKanbanImportWriter = {
  upsertProjects(rows: KanbanRow[]): Promise<void>;
  upsertWorkItems(rows: KanbanRow[]): Promise<void>;
  upsertGoals(rows: KanbanRow[]): Promise<void>;
  upsertWorkItemDependencies(rows: KanbanRow[]): Promise<void>;
  upsertWorkItemSubtasks(rows: KanbanRow[]): Promise<void>;
  upsertGoalWorklogs(rows: KanbanRow[]): Promise<void>;
  readProjects(): Promise<KanbanRow[]>;
  readWorkItems(): Promise<KanbanRow[]>;
  readGoals(): Promise<KanbanRow[]>;
  readWorkItemDependencies(): Promise<KanbanRow[]>;
  readWorkItemSubtasks(): Promise<KanbanRow[]>;
  readGoalWorklogs(): Promise<KanbanRow[]>;
};

export type LegacyKanbanTableDiff = {
  missingIds: string[];
  changedIds: string[];
  extraIds: string[];
};

export type LegacyKanbanImportResult = {
  writtenCounts: {
    projects: number;
    workItems: number;
    goals: number;
    dependencies: number;
    subtasks: number;
    goalWorklogs: number;
  };
  reconciliation: {
    projects: LegacyKanbanTableDiff;
    workItems: LegacyKanbanTableDiff;
    goals: LegacyKanbanTableDiff;
    dependencies: LegacyKanbanTableDiff;
    subtasks: LegacyKanbanTableDiff;
    goalWorklogs: LegacyKanbanTableDiff;
  };
};
