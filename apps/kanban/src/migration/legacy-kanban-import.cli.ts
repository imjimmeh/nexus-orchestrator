import { DataSource } from "typeorm";
import { runLegacyKanbanImport } from "./legacy-kanban-import";
import type {
  LegacyKanbanImportCliOptions,
  LegacyKanbanImportMode,
} from "./legacy-kanban-import-cli.types";
import type {
  KanbanRow,
  LegacyGoalRow,
  LegacyGoalWorklogRow,
  LegacyKanbanImportSource,
  LegacyKanbanImportWriter,
  LegacyProjectRow,
  LegacySubtaskRow,
  LegacyWorkItemDependencyRow,
  LegacyWorkItemRow,
} from "./legacy-kanban-import.types";

export function parseLegacyKanbanImportCliArgs(
  args: string[],
): LegacyKanbanImportCliOptions {
  const options: LegacyKanbanImportCliOptions = {
    mode: "dry-run",
    apiDatabaseUrl: undefined,
    kanbanDatabaseUrl: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [flag, inlineValue] = arg.split("=", 2);
    const readValue = () => {
      if (inlineValue !== undefined) {
        return inlineValue;
      }
      index += 1;
      const value = args[index];
      if (!value) {
        throw new Error(`Missing value for ${flag}`);
      }
      return value;
    };

    if (flag === "--mode") {
      const mode = readValue();
      if (!isLegacyKanbanImportMode(mode)) {
        throw new Error(`Invalid --mode: ${mode}`);
      }
      options.mode = mode;
      continue;
    }
    if (flag === "--api-database-url") {
      options.apiDatabaseUrl = readValue();
      continue;
    }
    if (flag === "--kanban-database-url") {
      options.kanbanDatabaseUrl = readValue();
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export async function runLegacyKanbanImportCli(
  options: LegacyKanbanImportCliOptions,
): Promise<void> {
  const apiDataSource = createDataSource(
    options.apiDatabaseUrl ??
      process.env.API_DATABASE_URL ??
      process.env.DATABASE_URL,
    "API_DATABASE_URL",
  );
  const kanbanDataSource = createDataSource(
    options.kanbanDatabaseUrl ??
      process.env.KANBAN_DATABASE_URL ??
      process.env.DATABASE_URL,
    "KANBAN_DATABASE_URL",
  );

  await apiDataSource.initialize();
  await kanbanDataSource.initialize();
  try {
    const source = await readLegacyKanbanSource(apiDataSource);
    const writer = createLegacyKanbanWriter(kanbanDataSource, {
      dryRun: options.mode === "dry-run" || options.mode === "reconcile",
    });
    const result = await runLegacyKanbanImport(source, writer);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await kanbanDataSource.destroy();
    await apiDataSource.destroy();
  }
}

export async function readLegacyKanbanSource(
  dataSource: DataSource,
): Promise<LegacyKanbanImportSource> {
  const [projects, workItems, goals, goalWorklogs, dependencies, subtasks]: [
    LegacyProjectRow[],
    LegacyWorkItemRow[],
    LegacyGoalRow[],
    LegacyGoalWorklogRow[],
    LegacyWorkItemDependencyRow[],
    LegacySubtaskRow[],
  ] = await Promise.all([
    dataSource.query<LegacyProjectRow[]>(`
        SELECT id, name, repository_url AS "repositoryUrl", base_path AS "basePath",
          github_secret_id AS "githubSecretId", description, source_type AS "sourceType",
          copy_to_workspace AS "copyToWorkspace", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM projects
      `),
    dataSource.query<LegacyWorkItemRow[]>(`
        SELECT id, project_id AS "project_id", title, description, status, priority, scope,
          assigned_agent_id AS "assignedAgentId", token_spend AS "tokenSpend",
          current_execution_id AS "currentExecutionId", waiting_for_input AS "waitingForInput",
          execution_config AS "executionConfig", metadata, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM work_items
      `),
    dataSource.query<LegacyGoalRow[]>(`
        SELECT id, project_id AS "project_id", title, description, status, moscow, priority,
          sort_order AS "sortOrder", target_date AS "targetDate", completed_at AS "completedAt",
          owner_agent_profile_id AS "ownerAgentProfileId", metadata, is_archived AS "isArchived",
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM project_goals
      `),
    dataSource.query<LegacyGoalWorklogRow[]>(`
        SELECT id, goal_id AS "goalId", project_id AS "project_id", work_item_id AS "workItemId",
          entry_type AS "entryType", author_type AS "authorType", author_id AS "authorId",
          author_name AS "authorName", note, linked_run_id AS "linkedRunId", metadata,
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM project_goal_worklogs
      `),
    dataSource.query<LegacyWorkItemDependencyRow[]>(`
        SELECT id, work_item_id AS "workItemId", depends_on_work_item_id AS "dependsOnWorkItemId"
        FROM work_item_dependencies
      `),
    dataSource.query<LegacySubtaskRow[]>(`
        SELECT id, project_id AS "project_id", work_item_id AS "workItemId", subtask_id AS "subtaskId",
          title, status, order_index AS "orderIndex", depends_on_subtask_ids AS "dependsOnSubtaskIds",
          source_path AS "sourcePath", source_hash AS "sourceHash",
          source_last_synced_at AS "sourceLastSyncedAt", is_archived AS "isArchived", metadata,
          created_at AS "createdAt", updated_at AS "updatedAt"
        FROM work_item_subtasks
      `),
  ]);

  return { projects, workItems, goals, goalWorklogs, dependencies, subtasks };
}

export function createLegacyKanbanWriter(
  dataSource: DataSource,
  options: { dryRun: boolean },
): LegacyKanbanImportWriter {
  return {
    upsertProjects: (rows) =>
      upsertRows(dataSource, options, "kanban_projects", rows),
    upsertWorkItems: (rows) =>
      upsertRows(dataSource, options, "kanban_work_items", rows),
    upsertGoals: (rows) =>
      upsertRows(dataSource, options, "kanban_project_goals", rows),
    upsertWorkItemDependencies: (rows) =>
      upsertRows(dataSource, options, "kanban_work_item_dependencies", rows),
    upsertWorkItemSubtasks: (rows) =>
      upsertRows(dataSource, options, "kanban_work_item_subtasks", rows),
    upsertGoalWorklogs: (rows) =>
      upsertRows(dataSource, options, "kanban_project_goal_worklogs", rows),
    readProjects: () =>
      dataSource.query<KanbanRow[]>(`SELECT * FROM kanban_projects`),
    readWorkItems: () =>
      dataSource.query<KanbanRow[]>(`SELECT * FROM kanban_work_items`),
    readGoals: () =>
      dataSource.query<KanbanRow[]>(`SELECT * FROM kanban_project_goals`),
    readWorkItemDependencies: () =>
      dataSource.query<KanbanRow[]>(
        `SELECT * FROM kanban_work_item_dependencies`,
      ),
    readWorkItemSubtasks: () =>
      dataSource.query<KanbanRow[]>(`SELECT * FROM kanban_work_item_subtasks`),
    readGoalWorklogs: () =>
      dataSource.query<KanbanRow[]>(
        `SELECT * FROM kanban_project_goal_worklogs`,
      ),
  };
}

function isLegacyKanbanImportMode(
  value: string,
): value is LegacyKanbanImportMode {
  return value === "dry-run" || value === "import" || value === "reconcile";
}

function createDataSource(
  url: string | undefined,
  envName: string,
): DataSource {
  if (!url) {
    throw new Error(`${envName} or DATABASE_URL is required`);
  }
  return new DataSource({ type: "postgres", url });
}

async function upsertRows(
  dataSource: DataSource,
  options: { dryRun: boolean },
  table: string,
  rows: Array<{ id: string } & Record<string, unknown>>,
): Promise<void> {
  if (options.dryRun || rows.length === 0) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const updateColumns = columns.filter((column) => column !== "id");
  const valuesSql = rows
    .map(
      (_row, rowIndex) =>
        `(${columns.map((_column, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`,
    )
    .join(", ");
  const params = rows.flatMap((row) => columns.map((column) => row[column]));

  await dataSource.query(
    `INSERT INTO ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})
     VALUES ${valuesSql}
     ON CONFLICT (id) DO UPDATE SET ${updateColumns
       .map(
         (column) =>
           `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`,
       )
       .join(", ")}`,
    params,
  );
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

if (require.main === module) {
  runLegacyKanbanImportCli(
    parseLegacyKanbanImportCliArgs(process.argv.slice(2)),
  ).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
