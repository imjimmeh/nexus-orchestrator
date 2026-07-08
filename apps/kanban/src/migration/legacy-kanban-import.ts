import type {
  KanbanRow,
  LegacyGoalRow,
  LegacyGoalWorklogRow,
  LegacyKanbanImportResult,
  LegacyKanbanImportSource,
  LegacyKanbanImportWriter,
  LegacyProjectRow,
  LegacySubtaskRow,
  LegacyWorkItemDependencyRow,
  LegacyWorkItemRow,
} from "./legacy-kanban-import.types";

export function mapLegacyProjectRow(row: LegacyProjectRow) {
  return {
    id: row.id,
    name: row.name,
    goals: null,
    repository_url: row.repositoryUrl ?? null,
    base_path: row.basePath ?? null,
    github_secret_id: row.githubSecretId ?? null,
    description: row.description ?? null,
    source_type: row.sourceType ?? null,
    copy_to_workspace: row.copyToWorkspace ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function mapLegacyWorkItemRow(row: LegacyWorkItemRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    priority: row.priority ?? "p2",
    scope: row.scope ?? "standard",
    assigned_agent_id: row.assignedAgentId ?? null,
    token_spend: row.tokenSpend ?? 0,
    current_execution_id: row.currentExecutionId ?? null,
    waiting_for_input: row.waitingForInput ?? false,
    execution_config: row.executionConfig ?? null,
    metadata: row.metadata ?? null,
    linked_run_id: row.currentExecutionId ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function mapLegacyGoalRow(row: LegacyGoalRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    moscow: row.moscow ?? null,
    priority: row.priority ?? null,
    sort_order: row.sortOrder ?? 0,
    target_date: row.targetDate ?? null,
    completed_at: row.completedAt ?? null,
    owner_agent_profile_id: row.ownerAgentProfileId ?? null,
    metadata: row.metadata ?? null,
    is_archived: row.isArchived ?? false,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function mapLegacyGoalWorklogRow(row: LegacyGoalWorklogRow) {
  return {
    id: row.id,
    goal_id: row.goalId,
    project_id: row.project_id,
    work_item_id: row.workItemId ?? null,
    entry_type: row.entryType ?? "note",
    author_type: row.authorType ?? "user",
    author_id: row.authorId ?? null,
    author_name: row.authorName ?? null,
    note: row.note,
    linked_run_id: row.linkedRunId ?? null,
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export function mapLegacyWorkItemDependencyRow(
  row: LegacyWorkItemDependencyRow,
) {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    depends_on_work_item_id: row.dependsOnWorkItemId,
  };
}

export function mapLegacySubtaskRow(row: LegacySubtaskRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    work_item_id: row.workItemId,
    subtask_id: row.subtaskId,
    title: row.title,
    status: row.status,
    order_index: row.orderIndex,
    depends_on_subtask_ids: row.dependsOnSubtaskIds ?? [],
    source_path: row.sourcePath,
    source_hash: row.sourceHash,
    source_last_synced_at: row.sourceLastSyncedAt ?? null,
    is_archived: row.isArchived ?? false,
    metadata: row.metadata ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

export async function runLegacyKanbanImport(
  source: LegacyKanbanImportSource,
  writer: LegacyKanbanImportWriter,
): Promise<LegacyKanbanImportResult> {
  const projects = (source.projects ?? []).map(mapLegacyProjectRow);
  const workItems = (source.workItems ?? []).map(mapLegacyWorkItemRow);
  const goals = (source.goals ?? []).map(mapLegacyGoalRow);
  const dependencies = (source.dependencies ?? []).map(
    mapLegacyWorkItemDependencyRow,
  );
  const subtasks = (source.subtasks ?? []).map(mapLegacySubtaskRow);
  const goalWorklogs = (source.goalWorklogs ?? []).map(mapLegacyGoalWorklogRow);

  await writer.upsertProjects(projects);
  await writer.upsertWorkItems(workItems);
  await writer.upsertGoals(goals);
  await writer.upsertWorkItemDependencies(dependencies);
  await writer.upsertWorkItemSubtasks(subtasks);
  await writer.upsertGoalWorklogs(goalWorklogs);

  return {
    writtenCounts: {
      projects: projects.length,
      workItems: workItems.length,
      goals: goals.length,
      dependencies: dependencies.length,
      subtasks: subtasks.length,
      goalWorklogs: goalWorklogs.length,
    },
    reconciliation: {
      projects: diffLegacyKanbanRows(projects, await writer.readProjects()),
      workItems: diffLegacyKanbanRows(workItems, await writer.readWorkItems()),
      goals: diffLegacyKanbanRows(goals, await writer.readGoals()),
      dependencies: diffLegacyKanbanRows(
        dependencies,
        await writer.readWorkItemDependencies(),
      ),
      subtasks: diffLegacyKanbanRows(
        subtasks,
        await writer.readWorkItemSubtasks(),
      ),
      goalWorklogs: diffLegacyKanbanRows(
        goalWorklogs,
        await writer.readGoalWorklogs(),
      ),
    },
  };
}

export function diffLegacyKanbanRows(
  legacyRows: KanbanRow[],
  kanbanRows: KanbanRow[],
): { missingIds: string[]; changedIds: string[]; extraIds: string[] } {
  const kanbanById = new Map(kanbanRows.map((row) => [row.id, row]));
  const legacyIds = new Set(legacyRows.map((row) => row.id));
  const missingIds: string[] = [];
  const changedIds: string[] = [];

  for (const legacyRow of legacyRows) {
    const kanbanRow = kanbanById.get(legacyRow.id);
    if (!kanbanRow) {
      missingIds.push(legacyRow.id);
      continue;
    }
    if (stableStringify(kanbanRow) !== stableStringify(legacyRow)) {
      changedIds.push(legacyRow.id);
    }
  }

  const extraIds = kanbanRows
    .filter((row) => !legacyIds.has(row.id))
    .map((row) => row.id);

  return { missingIds, changedIds, extraIds };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}
