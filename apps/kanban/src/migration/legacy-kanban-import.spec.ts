import { describe, expect, it } from "vitest";
import {
  diffLegacyKanbanRows,
  mapLegacyGoalRow,
  mapLegacyGoalWorklogRow,
  mapLegacySubtaskRow,
  mapLegacyWorkItemDependencyRow,
  mapLegacyProjectRow,
  mapLegacyWorkItemRow,
  runLegacyKanbanImport,
} from "./legacy-kanban-import";

describe("legacy kanban import helpers", () => {
  it("maps legacy API project rows to kanban source-of-truth rows", () => {
    expect(
      mapLegacyProjectRow({
        id: "project-1",
        name: "Legacy",
        repositoryUrl: "https://github.com/org/repo",
        basePath: "/repo",
        githubSecretId: "secret-1",
        description: "legacy project",
        sourceType: "import_remote",
        copyToWorkspace: false,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "project-1",
      name: "Legacy",
      goals: null,
      repository_url: "https://github.com/org/repo",
      base_path: "/repo",
      github_secret_id: "secret-1",
      description: "legacy project",
      source_type: "import_remote",
      copy_to_workspace: false,
      created_at: new Date("2026-04-01T00:00:00.000Z"),
      updated_at: new Date("2026-04-02T00:00:00.000Z"),
    });
  });

  it("maps legacy API work-item rows to kanban source-of-truth rows", () => {
    expect(
      mapLegacyWorkItemRow({
        id: "work-item-1",
        project_id: "project-1",
        title: "Legacy task",
        description: "task details",
        status: "in-progress",
        priority: "p1",
        scope: "large",
        currentExecutionId: "run-1",
        executionConfig: { baseBranch: "main" },
        metadata: { repositoryPath: "apps/kanban" },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        id: "work-item-1",
        project_id: "project-1",
        title: "Legacy task",
        description: "task details",
        status: "in-progress",
        priority: "p1",
        scope: "large",
        current_execution_id: "run-1",
        execution_config: { baseBranch: "main" },
        metadata: { repositoryPath: "apps/kanban" },
      }),
    );
  });

  it("maps legacy goals, worklogs, dependencies, and subtasks", () => {
    expect(
      mapLegacyGoalRow({
        id: "goal-1",
        project_id: "project-1",
        title: "Ship",
        description: "Ship it",
        status: "todo",
        moscow: "must",
        priority: "p0",
        sortOrder: 1,
        targetDate: "2026-05-01",
        completedAt: null,
        ownerAgentProfileId: "agent-1",
        metadata: { source: "legacy" },
        isArchived: false,
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        id: "goal-1",
        project_id: "project-1",
        title: "Ship",
        owner_agent_profile_id: "agent-1",
        metadata: { source: "legacy" },
      }),
    );

    expect(
      mapLegacyGoalWorklogRow({
        id: "log-1",
        goalId: "goal-1",
        project_id: "project-1",
        workItemId: "work-item-1",
        entryType: "note",
        authorType: "agent",
        authorId: "agent-1",
        authorName: "Planner",
        note: "Updated",
        linkedRunId: "run-1",
        metadata: { confidence: "high" },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        goal_id: "goal-1",
        work_item_id: "work-item-1",
        linked_run_id: "run-1",
      }),
    );

    expect(
      mapLegacyWorkItemDependencyRow({
        id: "dep-link-1",
        workItemId: "work-item-2",
        dependsOnWorkItemId: "work-item-1",
      }),
    ).toEqual({
      id: "dep-link-1",
      work_item_id: "work-item-2",
      depends_on_work_item_id: "work-item-1",
    });

    expect(
      mapLegacySubtaskRow({
        id: "subtask-row-1",
        project_id: "project-1",
        workItemId: "work-item-1",
        subtaskId: "subtask-1",
        title: "Do it",
        status: "todo",
        orderIndex: 0,
        dependsOnSubtaskIds: ["subtask-0"],
        sourcePath: "docs/plan.md",
        sourceHash: "abc123",
        sourceLastSyncedAt: null,
        isArchived: false,
        metadata: { section: 1 },
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        updatedAt: new Date("2026-04-02T00:00:00.000Z"),
      }),
    ).toEqual(
      expect.objectContaining({
        project_id: "project-1",
        work_item_id: "work-item-1",
        subtask_id: "subtask-1",
        depends_on_subtask_ids: ["subtask-0"],
      }),
    );
  });

  it("reports missing and changed migrated rows", () => {
    expect(
      diffLegacyKanbanRows(
        [
          { id: "a", updated_at: "2026-04-01T00:00:00.000Z", name: "same" },
          { id: "b", updated_at: "2026-04-02T00:00:00.000Z", name: "missing" },
          { id: "c", updated_at: "2026-04-02T00:00:00.000Z", name: "changed" },
        ],
        [
          { id: "a", updated_at: "2026-04-01T00:00:00.000Z", name: "same" },
          {
            id: "c",
            updated_at: "2026-04-02T00:00:00.000Z",
            name: "different",
          },
          { id: "d", updated_at: "2026-04-02T00:00:00.000Z", name: "extra" },
        ],
      ),
    ).toEqual({
      missingIds: ["b"],
      changedIds: ["c"],
      extraIds: ["d"],
    });
  });

  it("imports full legacy kanban rows in dependency-safe order and reconciles written rows", async () => {
    const writes: string[] = [];
    const store = {
      projects: [] as Array<{ id: string } & Record<string, unknown>>,
      workItems: [] as Array<{ id: string } & Record<string, unknown>>,
      goals: [] as Array<{ id: string } & Record<string, unknown>>,
      goalWorklogs: [] as Array<{ id: string } & Record<string, unknown>>,
      dependencies: [] as Array<{ id: string } & Record<string, unknown>>,
      subtasks: [] as Array<{ id: string } & Record<string, unknown>>,
    };
    const writer = {
      upsertProjects: (rows: typeof store.projects) => {
        writes.push("projects");
        store.projects = rows;
        return Promise.resolve();
      },
      upsertWorkItems: (rows: typeof store.workItems) => {
        writes.push("workItems");
        store.workItems = rows;
        return Promise.resolve();
      },
      upsertGoals: (rows: typeof store.goals) => {
        writes.push("goals");
        store.goals = rows;
        return Promise.resolve();
      },
      upsertWorkItemDependencies: (rows: typeof store.dependencies) => {
        writes.push("dependencies");
        store.dependencies = rows;
        return Promise.resolve();
      },
      upsertWorkItemSubtasks: (rows: typeof store.subtasks) => {
        writes.push("subtasks");
        store.subtasks = rows;
        return Promise.resolve();
      },
      upsertGoalWorklogs: (rows: typeof store.goalWorklogs) => {
        writes.push("goalWorklogs");
        store.goalWorklogs = rows;
        return Promise.resolve();
      },
      readProjects: () => Promise.resolve(store.projects),
      readWorkItems: () => Promise.resolve(store.workItems),
      readGoals: () => Promise.resolve(store.goals),
      readGoalWorklogs: () => Promise.resolve(store.goalWorklogs),
      readWorkItemDependencies: () => Promise.resolve(store.dependencies),
      readWorkItemSubtasks: () => Promise.resolve(store.subtasks),
    };

    const result = await runLegacyKanbanImport(
      {
        projects: [
          {
            id: "project-1",
            name: "Legacy",
            repositoryUrl: "https://github.com/org/repo",
            basePath: "/repo",
            githubSecretId: "secret-1",
            description: "legacy project",
            sourceType: "import_remote",
            copyToWorkspace: false,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ],
        workItems: [
          {
            id: "work-item-1",
            project_id: "project-1",
            title: "Legacy task",
            status: "todo",
            executionConfig: { baseBranch: "main" },
            metadata: { repositoryPath: "apps/kanban" },
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
          {
            id: "work-item-2",
            project_id: "project-1",
            title: "Dependent task",
            status: "todo",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ],
        goals: [
          {
            id: "goal-1",
            project_id: "project-1",
            title: "Ship",
            status: "todo",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ],
        dependencies: [
          {
            id: "dep-link-1",
            workItemId: "work-item-2",
            dependsOnWorkItemId: "work-item-1",
          },
        ],
        subtasks: [
          {
            id: "subtask-row-1",
            project_id: "project-1",
            workItemId: "work-item-1",
            subtaskId: "subtask-1",
            title: "Do it",
            status: "todo",
            orderIndex: 0,
            sourcePath: "docs/plan.md",
            sourceHash: "abc123",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ],
        goalWorklogs: [
          {
            id: "log-1",
            goalId: "goal-1",
            project_id: "project-1",
            workItemId: "work-item-1",
            note: "Updated",
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: new Date("2026-04-02T00:00:00.000Z"),
          },
        ],
      },
      writer,
    );

    expect(writes).toEqual([
      "projects",
      "workItems",
      "goals",
      "dependencies",
      "subtasks",
      "goalWorklogs",
    ]);
    expect(store.workItems[0]).toEqual(
      expect.objectContaining({
        execution_config: { baseBranch: "main" },
        metadata: { repositoryPath: "apps/kanban" },
      }),
    );
    expect(result.reconciliation.workItems).toEqual({
      missingIds: [],
      changedIds: [],
      extraIds: [],
    });
    expect(result.writtenCounts).toEqual({
      projects: 1,
      workItems: 2,
      goals: 1,
      dependencies: 1,
      subtasks: 1,
      goalWorklogs: 1,
    });
  });
});
