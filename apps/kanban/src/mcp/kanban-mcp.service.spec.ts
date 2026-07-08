import { BadRequestException, NotFoundException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { z } from "zod";
import { KanbanMcpAuditService } from "./kanban-mcp-audit.service";
import { KanbanMcpService } from "./kanban-mcp.service";
import { PublishSpecsTool } from "./tools/publish-specs/publish-specs.tool";
import {
  ProjectIdSchema,
  WorkItemIdSchema,
  ReviewDecisionSchema,
  StatusSchema,
  PublishSpecsSchema,
  WorkItemUpdateSchema,
  WorkItemPatchMetadataSchema,
  WorkItemAppendMetadataArraySchema,
  WorkItemPatchExecutionConfigSchema,
  WorkItemCreateSchema,
  WorkItemSubtaskValidateBlueprintSchema,
  WorkItemSubtaskUpsertSchema,
  OrchestrationClearCycleDecisionSchema,
} from "./tools/shared/schemas";

// KanbanMcpService wires a real PublishSpecsTool (see beforeEach below) whose
// only I/O is `readdir`/`readFile`, plus its collaborator
// `validateSourceSpecTracking`, which shells out to `git`. Both are faked
// here so the publish_specs tests below do zero real filesystem or process
// I/O (mirrors publish-specs.tool.spec.ts and
// project/managed-project-clone.service.spec.ts).
vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

type FakeDirEntry = { name: string; isFile: () => boolean };
type ReaddirImpl = (
  dirPath: string,
  options: { withFileTypes: true },
) => Promise<FakeDirEntry[]>;
type ReadFileImpl = (filePath: string, encoding: string) => Promise<string>;
type ExecFileCallback = (
  error: Error | null,
  result?: { stdout: string; stderr: string },
) => void;
type ExecFileImpl = (
  file: string,
  args: string[],
  options: unknown,
  callback: ExecFileCallback,
) => void;

const readdirMock = readdir as unknown as ReturnType<typeof vi.fn<ReaddirImpl>>;
const readFileMock = readFile as unknown as ReturnType<
  typeof vi.fn<ReadFileImpl>
>;
const execFileMock = execFile as unknown as ReturnType<
  typeof vi.fn<ExecFileImpl>
>;

// In-memory fixture "filesystem": directory path -> filenames it contains,
// and full file path -> file contents.
const virtualDirFiles = new Map<string, string[]>();
const virtualFileContents = new Map<string, string>();

function registerSpecDir(dirPath: string, files: Record<string, string>): void {
  const normalizedDir = path.normalize(dirPath);
  virtualDirFiles.set(normalizedDir, Object.keys(files));
  for (const [fileName, content] of Object.entries(files)) {
    virtualFileContents.set(
      path.normalize(path.join(normalizedDir, fileName)),
      content,
    );
  }
}

function enoentError(message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

readdirMock.mockImplementation((dirPath) => {
  const names = virtualDirFiles.get(path.normalize(dirPath));
  if (!names) {
    return Promise.reject(
      enoentError(`ENOENT: no such directory, scandir '${dirPath}'`),
    );
  }
  return Promise.resolve(names.map((name) => ({ name, isFile: () => true })));
});

readFileMock.mockImplementation((filePath) => {
  const content = virtualFileContents.get(path.normalize(filePath));
  if (content === undefined) {
    return Promise.reject(
      enoentError(`ENOENT: no such file, open '${filePath}'`),
    );
  }
  return Promise.resolve(content);
});

// No simulated git repo: matches every test here running outside a real git
// working tree, so `resolveGitRoot` fails and source-spec tracking is a
// no-op — the same behavior the real `git` binary produced before this fix.
execFileMock.mockImplementation((_file, _args, _options, callback) => {
  callback(new Error("fatal: not a git repository"));
});

describe("KanbanMcpService", () => {
  let projects: { get: Mock };
  let workItems: {
    listWorkItems: Mock;
    listAllWorkItems: Mock;
    updateWorkItem: Mock;
    updateStatus: Mock;
    createWorkItem: Mock;
  };
  let goals: {
    listGoals: Mock;
    createGoal: Mock;
    updateGoal: Mock;
    updateStatus: Mock;
    createWorklog: Mock;
  };
  let orchestration: {
    get: Mock;
    getDiagnostics: Mock;
    getActivitySummary: Mock;
    complete: Mock;
    clearCycleDecision: Mock;
  };
  let review: { recordDecision: Mock };
  let audit: KanbanMcpAuditService;
  let service: KanbanMcpService;

  beforeEach(() => {
    virtualDirFiles.clear();
    virtualFileContents.clear();
    readdirMock.mockClear();
    readFileMock.mockClear();
    execFileMock.mockClear();

    projects = { get: vi.fn() };
    workItems = {
      listWorkItems: vi.fn(),
      listAllWorkItems: vi.fn(),
      updateWorkItem: vi.fn(),
      updateStatus: vi.fn(),
      createWorkItem: vi.fn(),
    };
    goals = {
      listGoals: vi.fn(),
      createGoal: vi.fn(),
      updateGoal: vi.fn(),
      updateStatus: vi.fn(),
      createWorklog: vi.fn(),
    };
    orchestration = {
      get: vi.fn(),
      getDiagnostics: vi.fn(),
      getActivitySummary: vi.fn(),
      complete: vi.fn(),
      clearCycleDecision: vi.fn(),
    };
    review = { recordDecision: vi.fn() };
    audit = new KanbanMcpAuditService();

    const projectStateTool = {
      getName: () => "kanban.project_state",
      getDefinition: () => ({
        name: "kanban.project_state",
        description:
          "Read kanban project, work items, goals, and orchestration diagnostics.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        const parsed = ProjectIdSchema.safeParse(params);
        if (!parsed.success) {
          throw new BadRequestException("project_id is required");
        }
        const memorySummary = {
          entity_type: "kanban.project",
          entity_id: parsed.data.project_id,
          totalCount: 0,
          byType: { preference: 0, fact: 0, history: 0 },
          retrievalTool: "query_memory",
        };
        const [
          project,
          workItemsList,
          goalsList,
          orchestrationDiag,
          recentActivity,
        ] = await Promise.all([
          projects.get(parsed.data.project_id),
          workItems.listWorkItems(parsed.data.project_id),
          goals.listGoals(parsed.data.project_id),
          (async () => {
            try {
              return await orchestration.getDiagnostics(parsed.data.project_id);
            } catch (error: unknown) {
              if (error instanceof NotFoundException) {
                return null;
              }
              throw error;
            }
          })(),
          (async () => {
            try {
              return await orchestration.getActivitySummary(
                parsed.data.project_id,
                { limit: 5 },
              );
            } catch (error: unknown) {
              if (error instanceof NotFoundException) {
                return { totalActionCount: 0, recent: [] };
              }
              throw error;
            }
          })(),
        ]);
        return {
          project,
          workItems: workItemsList,
          goals: goalsList,
          orchestration: orchestrationDiag,
          memorySummary,
          recentActivity,
        };
      },
    };

    const projectBriefTool = {
      getName: () => "kanban.project_brief",
      getDefinition: () => ({
        name: "kanban.project_brief",
        description: "Read a kanban project brief.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        return projects.get(params.project_id);
      },
    };

    const workItemsTool = {
      getName: () => "kanban.work_items",
      getDefinition: () => ({
        name: "kanban.work_items",
        description:
          "List kanban work items for a project, or all work items when project_id is omitted.",
        inputSchema: z.object({ project_id: z.string().min(1).optional() }),
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id?: string },
      ) => {
        if (params.project_id) {
          return workItems.listWorkItems(params.project_id);
        }
        return workItems.listAllWorkItems();
      },
    };

    const workItemTool = {
      getName: () => "kanban.work_item",
      getDefinition: () => ({
        name: "kanban.work_item",
        description: "Read one kanban work item.",
        inputSchema: WorkItemIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: { project_id: string; workItemId: string },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        const item = items.find(
          (c: Record<string, unknown>) => c.id === params.workItemId,
        );
        if (!item) {
          throw new NotFoundException(
            `Work item ${params.workItemId} not found for project ${params.project_id}`,
          );
        }
        return item;
      },
    };

    const goalsTool = {
      getName: () => "kanban.goals",
      getDefinition: () => ({
        name: "kanban.goals",
        description: "List kanban project goals.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        return goals.listGoals(params.project_id);
      },
    };

    const todoListTool = {
      getName: () => "kanban.todo_list",
      getDefinition: () => ({
        name: "kanban.todo_list",
        description: "List todo status work items for a kanban project.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        return items.filter(
          (item: Record<string, unknown>) => item.status === "todo",
        );
      },
    };

    const orchestrationTimelineTool = {
      getName: () => "kanban.orchestration_timeline",
      getDefinition: () => ({
        name: "kanban.orchestration_timeline",
        description:
          "Read kanban orchestration state and diagnostics for a project.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        const [state, diagnostics] = await Promise.all([
          orchestration.get(params.project_id),
          orchestration.getDiagnostics(params.project_id),
        ]);
        return { state, diagnostics };
      },
    };

    const orchestrationCompleteTool = {
      getName: () => "kanban.orchestration_complete",
      getDefinition: () => ({
        name: "kanban.orchestration_complete",
        description: "Mark kanban project orchestration complete.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string },
      ) => {
        return orchestration.complete(params.project_id);
      },
    };

    const orchestrationClearCycleDecisionTool = {
      getName: () => "kanban.orchestration_clear_cycle_decision",
      getDefinition: () => ({
        name: "kanban.orchestration_clear_cycle_decision",
        description: "Clear a persisted orchestration cycle decision.",
        inputSchema: OrchestrationClearCycleDecisionSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: { project_id: string; reason: string },
      ) => {
        await orchestration.clearCycleDecision(params.project_id, {
          reason: params.reason,
        });
        return { ok: true, project_id: params.project_id };
      },
    };

    const publishSpecsTool = new PublishSpecsTool(
      workItems as never,
      projects as never,
    );

    const reviewDecisionTool = {
      getName: () => "kanban.review_decision",
      getDefinition: () => ({
        name: "kanban.review_decision",
        description: "Submit a kanban work item review decision.",
        inputSchema: ReviewDecisionSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          decision: "approve" | "reject";
          workflowId: string;
          requestedBy?: string;
        },
      ) => {
        await review.recordDecision({
          project_id: params.project_id,
          workItemId: params.workItemId,
          decision: params.decision,
          workflowId: params.workflowId,
          requestedBy: params.requestedBy,
        });
        return { ok: true };
      },
    };

    const workItemUpdateTool = {
      getName: () => "kanban.work_item_update",
      getDefinition: () => ({
        name: "kanban.work_item_update",
        description: "Update kanban-owned work item fields.",
        inputSchema: WorkItemUpdateSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          updates: Record<string, unknown>;
        },
      ) => {
        return workItems.updateWorkItem(
          params.project_id,
          params.workItemId,
          params.updates,
        );
      },
    };

    const workItemPatchMetadataTool = {
      getName: () => "kanban.work_item_patch_metadata",
      getDefinition: () => ({
        name: "kanban.work_item_patch_metadata",
        description: "Deep-merge kanban work item metadata.",
        inputSchema: WorkItemPatchMetadataSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          metadataPatch: Record<string, unknown>;
        },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        const item = items.find(
          (c: Record<string, unknown>) => c.id === params.workItemId,
        );
        const itemRecord = (item as unknown as Record<string, unknown>) ?? {};
        const deepMerge = (
          target: Record<string, unknown>,
          patch: Record<string, unknown>,
        ): Record<string, unknown> => {
          const result = { ...target };
          for (const [key, value] of Object.entries(patch)) {
            const targetValue = result[key];
            result[key] =
              targetValue &&
              typeof targetValue === "object" &&
              value &&
              typeof value === "object"
                ? deepMerge(
                    targetValue as Record<string, unknown>,
                    value as Record<string, unknown>,
                  )
                : value;
          }
          return result;
        };
        const metadata = deepMerge(
          (itemRecord.metadata as Record<string, unknown>) ?? {},
          params.metadataPatch,
        );
        return workItems.updateWorkItem(params.project_id, params.workItemId, {
          metadata,
        });
      },
    };

    const workItemAppendMetadataArrayTool = {
      getName: () => "kanban.work_item_append_metadata_array",
      getDefinition: () => ({
        name: "kanban.work_item_append_metadata_array",
        description:
          "Append a value to a metadata array on a kanban work item.",
        inputSchema: WorkItemAppendMetadataArraySchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          arrayPath: string;
          arrayValue: unknown;
        },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        const item = items.find(
          (c: Record<string, unknown>) => c.id === params.workItemId,
        );
        const itemRecord = (item as unknown as Record<string, unknown>) ?? {};
        const metadata = {
          ...((itemRecord.metadata as Record<string, unknown>) ?? {}),
        };
        const existing = metadata[params.arrayPath];
        if (existing !== undefined && !Array.isArray(existing)) {
          throw new BadRequestException(
            `Metadata path "${params.arrayPath}" must be an array before appending`,
          );
        }
        const existingItems: unknown[] = Array.isArray(existing)
          ? existing
          : [];
        metadata[params.arrayPath] = [...existingItems, params.arrayValue];
        return workItems.updateWorkItem(params.project_id, params.workItemId, {
          metadata,
        });
      },
    };

    const workItemPatchExecutionConfigTool = {
      getName: () => "kanban.work_item_patch_execution_config",
      getDefinition: () => ({
        name: "kanban.work_item_patch_execution_config",
        description: "Deep-merge kanban work item execution config.",
        inputSchema: WorkItemPatchExecutionConfigSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          executionConfigPatch: Record<string, unknown>;
        },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        const item = items.find(
          (c: Record<string, unknown>) => c.id === params.workItemId,
        );
        const itemRecord = (item as unknown as Record<string, unknown>) ?? {};
        const deepMerge = (
          target: Record<string, unknown>,
          patch: Record<string, unknown>,
        ): Record<string, unknown> => {
          const result = { ...target };
          for (const [key, value] of Object.entries(patch)) {
            const targetValue = result[key];
            result[key] =
              targetValue &&
              typeof targetValue === "object" &&
              value &&
              typeof value === "object"
                ? deepMerge(
                    targetValue as Record<string, unknown>,
                    value as Record<string, unknown>,
                  )
                : value;
          }
          return result;
        };
        const executionConfig = deepMerge(
          (itemRecord.executionConfig as Record<string, unknown>) ?? {},
          params.executionConfigPatch,
        );
        return workItems.updateWorkItem(params.project_id, params.workItemId, {
          executionConfig,
        });
      },
    };

    const workItemTransitionStatusTool = {
      getName: () => "kanban.work_item_transition_status",
      getDefinition: () => ({
        name: "kanban.work_item_transition_status",
        description: "Transition a kanban work item status.",
        inputSchema: StatusSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string; workItemId: string; status: string },
      ) => {
        const statusValue = params.status.replaceAll("_", "-");
        return workItems.updateStatus(
          params.project_id,
          params.workItemId,
          statusValue,
        );
      },
    };

    const workItemCreateTool = {
      getName: () => "kanban.work_item_create",
      getDefinition: () => ({
        name: "kanban.work_item_create",
        description: "Create a kanban work item.",
        inputSchema: WorkItemCreateSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          parentWorkItemId?: string;
          workItem: Record<string, unknown>;
        },
      ) => {
        return workItems.createWorkItem(params.project_id, params.workItem);
      },
    };

    const workItemSubtaskValidateBlueprintTool = {
      getName: () => "kanban.work_item_subtask_validate_blueprint",
      getDefinition: () => ({
        name: "kanban.work_item_subtask_validate_blueprint",
        description: "Validate a subtask blueprint for a kanban work item.",
        inputSchema: WorkItemSubtaskValidateBlueprintSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          blueprint: {
            subtask_id: string;
            title: string;
            order_index: number;
            depends_on_subtask_ids: string[];
          }[];
        },
      ) => {
        return Promise.resolve({ ok: true, count: params.blueprint.length });
      },
    };

    const workItemSubtaskUpsertTool = {
      getName: () => "kanban.work_item_subtask_upsert",
      getDefinition: () => ({
        name: "kanban.work_item_subtask_upsert",
        description: "Upsert a subtask on a kanban work item.",
        inputSchema: WorkItemSubtaskUpsertSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: async (
        _context: InternalToolExecutionContext,
        params: {
          project_id: string;
          workItemId: string;
          subtask: Record<string, unknown>;
        },
      ) => {
        const items = await workItems.listWorkItems(params.project_id);
        const item = items.find(
          (c: Record<string, unknown>) => c.id === params.workItemId,
        );
        const itemRecord = (item as Record<string, unknown> | undefined) ?? {};
        const subtasks: unknown[] = Array.isArray(itemRecord.subtasks)
          ? [...itemRecord.subtasks]
          : [];
        const subtaskId =
          (params.subtask.subtask_id as string | undefined) ??
          (params.subtask.subtaskId as string | undefined) ??
          (params.subtask.title as string);
        const title = params.subtask.title as string;
        if (!title) throw new Error("title is required");
        const normalized = {
          subtaskId,
          title,
          status: (params.subtask.status as string | undefined) ?? "todo",
          ...(params.subtask.order_index !== undefined
            ? { orderIndex: Number(params.subtask.order_index) }
            : {}),
          ...(Array.isArray(params.subtask.depends_on_subtask_ids)
            ? { dependsOnSubtaskIds: params.subtask.depends_on_subtask_ids }
            : {}),
          ...(params.subtask.metadata !== undefined
            ? { metadata: params.subtask.metadata }
            : {}),
        };
        const existingIndex = subtasks.findIndex((c) => {
          const record = (c as Record<string, unknown>) ?? {};
          return record.subtaskId === normalized.subtaskId;
        });
        if (existingIndex >= 0) {
          subtasks[existingIndex] = {
            ...(subtasks[existingIndex] ?? {}),
            ...normalized,
          };
        } else {
          subtasks.push(normalized);
        }
        return workItems.updateWorkItem(params.project_id, params.workItemId, {
          subtasks,
        });
      },
    };

    const goalCreateTool = {
      getName: () => "kanban.goal_create",
      getDefinition: () => ({
        name: "kanban.goal_create",
        description: "Create a project goal.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string; title: string },
      ) => {
        return goals.createGoal(params.project_id, { title: params.title });
      },
    };

    const goalUpdateTool = {
      getName: () => "kanban.goal_update",
      getDefinition: () => ({
        name: "kanban.goal_update",
        description: "Update a project goal's fields.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string; goal_id: string },
      ) => {
        return goals.updateGoal(params.project_id, params.goal_id, {});
      },
    };

    const goalUpdateStatusTool = {
      getName: () => "kanban.goal_update_status",
      getDefinition: () => ({
        name: "kanban.goal_update_status",
        description: "Update a project goal's status.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string; goal_id: string; status: string },
      ) => {
        return goals.updateStatus(params.project_id, params.goal_id, {
          status: params.status,
        });
      },
    };

    const goalAddNoteTool = {
      getName: () => "kanban.goal_add_note",
      getDefinition: () => ({
        name: "kanban.goal_add_note",
        description: "Add a note to a project goal's worklog.",
        inputSchema: ProjectIdSchema,
        tierRestriction: 2 as const,
        transport: "runner_local" as const,
        runtimeOwner: "runner" as const,
      }),
      execute: (
        _context: InternalToolExecutionContext,
        params: { project_id: string; goal_id: string; note: string },
      ) => {
        return goals.createWorklog(params.project_id, params.goal_id, {
          note: params.note,
        });
      },
    };

    const tools = [
      projectStateTool,
      projectBriefTool,
      workItemsTool,
      workItemTool,
      goalsTool,
      todoListTool,
      orchestrationTimelineTool,
      orchestrationCompleteTool,
      orchestrationClearCycleDecisionTool,
      publishSpecsTool,
      reviewDecisionTool,
      workItemUpdateTool,
      workItemPatchMetadataTool,
      workItemAppendMetadataArrayTool,
      workItemPatchExecutionConfigTool,
      workItemTransitionStatusTool,
      workItemCreateTool,
      workItemSubtaskValidateBlueprintTool,
      workItemSubtaskUpsertTool,
      goalCreateTool,
      goalUpdateTool,
      goalUpdateStatusTool,
      goalAddNoteTool,
    ];

    service = new KanbanMcpService(tools, audit);
  });

  it("lists kanban MCP tools with JSON schemas", () => {
    const tools = service.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "kanban.project_state",
      "kanban.project_brief",
      "kanban.work_items",
      "kanban.work_item",
      "kanban.goals",
      "kanban.todo_list",
      "kanban.orchestration_timeline",
      "kanban.orchestration_complete",
      "kanban.orchestration_clear_cycle_decision",
      "kanban.publish_specs",
      "kanban.review_decision",
      "kanban.work_item_update",
      "kanban.work_item_patch_metadata",
      "kanban.work_item_append_metadata_array",
      "kanban.work_item_patch_execution_config",
      "kanban.work_item_transition_status",
      "kanban.work_item_create",
      "kanban.work_item_subtask_validate_blueprint",
      "kanban.work_item_subtask_upsert",
      "kanban.goal_create",
      "kanban.goal_update",
      "kanban.goal_update_status",
      "kanban.goal_add_note",
    ]);
    expect(tools[0].inputSchema).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["project_id"],
      }),
    );
  });

  it("validates required tool arguments before calling kanban services", async () => {
    await expect(
      service.callTool("kanban.project_state", {}, { correlationId: "corr-1" }),
    ).rejects.toThrow(BadRequestException);
    expect(projects.get).not.toHaveBeenCalled();
  });

  it("passes workflow job context to internal tool handlers", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const contextAwareService = new KanbanMcpService(
      [
        {
          getName: () => "kanban.context_aware",
          getDefinition: () => ({
            name: "kanban.context_aware",
            description: "Reads execution context.",
            inputSchema: z.object({ project_id: z.string().min(1) }),
            tierRestriction: 2 as const,
            transport: "runner_local" as const,
            runtimeOwner: "runner" as const,
          }),
          execute,
        },
      ],
      audit,
    );

    await contextAwareService.callTool(
      "kanban.context_aware",
      { project_id: "project-1" },
      {
        correlationId: "corr-1",
        workflowRunId: "run-1",
        jobId: "job-1",
        stepId: "step-1",
      },
    );

    expect(execute).toHaveBeenCalledWith(
      {
        workflowRunId: "run-1",
        jobId: "job-1",
        scopeId: "corr-1",
      },
      { project_id: "project-1" },
    );
  });

  it("validates tool schemas before invoking handlers", async () => {
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const validationService = new KanbanMcpService(
      [
        {
          getName: () => "kanban.schema_guarded",
          getDefinition: () => ({
            name: "kanban.schema_guarded",
            description: "Requires a project id.",
            inputSchema: ProjectIdSchema,
            tierRestriction: 2 as const,
            transport: "runner_local" as const,
            runtimeOwner: "runner" as const,
          }),
          execute,
        },
      ],
      audit,
    );

    await expect(
      validationService.callTool(
        "kanban.schema_guarded",
        {},
        { correlationId: "corr-1" },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(execute).not.toHaveBeenCalled();
  });

  it("invokes project state using kanban services and audits correlation metadata", async () => {
    projects.get.mockResolvedValue({ id: "project-1", name: "Project" });
    workItems.listWorkItems.mockResolvedValue([{ id: "wi-1", status: "todo" }]);
    goals.listGoals.mockResolvedValue([{ id: "goal-1", status: "active" }]);
    orchestration.getDiagnostics.mockResolvedValue({ status: "orchestrating" });
    orchestration.getActivitySummary.mockResolvedValue({
      totalActionCount: 5,
      recent: [],
    });

    const result = await service.callTool(
      "kanban.project_state",
      { project_id: "project-1" },
      { correlationId: "corr-1", workflowRunId: "run-1" },
    );

    expect(result).toMatchObject({
      project: { id: "project-1", name: "Project" },
      workItems: [{ id: "wi-1", status: "todo" }],
      goals: [{ id: "goal-1", status: "active" }],
      orchestration: expect.objectContaining({ status: "orchestrating" }),
      memorySummary: expect.objectContaining({
        entity_type: "kanban.project",
      }),
      recentActivity: expect.objectContaining({
        totalActionCount: expect.any(Number),
      }),
    });
    expect(audit.entries).toContainEqual(
      expect.objectContaining({
        eventName: "kanban.mcp.tool.succeeded",
        toolName: "kanban.project_state",
        correlationId: "corr-1",
        workflowRunId: "run-1",
      }),
    );
  });

  it("accepts legacy project_id when reading project state", async () => {
    projects.get.mockResolvedValue({ id: "project-1", name: "Project" });
    workItems.listWorkItems.mockResolvedValue([]);
    goals.listGoals.mockResolvedValue([]);
    orchestration.getDiagnostics.mockResolvedValue({ status: "orchestrating" });

    await service.callTool(
      "kanban.project_state",
      { project_id: "project-1" },
      { correlationId: "corr-1" },
    );

    expect(projects.get).toHaveBeenCalledWith("project-1");
  });

  it("accepts legacy project_id when reading orchestration timeline", async () => {
    orchestration.get.mockResolvedValue({ project_id: "project-1" });
    orchestration.getDiagnostics.mockResolvedValue({ project_id: "project-1" });

    const result = await service.callTool(
      "kanban.orchestration_timeline",
      { project_id: "project-1" },
      { correlationId: "corr-1" },
    );

    expect(orchestration.get).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({
      state: { project_id: "project-1" },
      diagnostics: { project_id: "project-1" },
    });
  });

  it("returns null orchestration state in project_state when no state exists", async () => {
    projects.get.mockResolvedValue({ id: "project-1" });
    workItems.listWorkItems.mockResolvedValue([]);
    goals.listGoals.mockResolvedValue([]);
    orchestration.getDiagnostics.mockRejectedValue(new NotFoundException());

    const result = await service.callTool(
      "kanban.project_state",
      { project_id: "project-1" },
      { correlationId: "corr-1" },
    );

    expect(result).toEqual(expect.objectContaining({ orchestration: null }));
  });

  it("completes orchestration through the kanban MCP mutation tool", async () => {
    orchestration.complete.mockResolvedValue({
      project_id: "project-1",
      status: "completed",
    });

    const result = await service.callTool(
      "kanban.orchestration_complete",
      { project_id: "project-1" },
      { correlationId: "corr-1" },
    );

    expect(orchestration.complete).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({ project_id: "project-1", status: "completed" });
  });

  it("accepts legacy project_id when completing orchestration", async () => {
    orchestration.complete.mockResolvedValue({
      project_id: "project-1",
      status: "completed",
    });

    await service.callTool(
      "kanban.orchestration_complete",
      { project_id: "project-1" },
      { correlationId: "corr-1" },
    );

    expect(orchestration.complete).toHaveBeenCalledWith("project-1");
  });

  it("clears cycle decision through the kanban MCP mutation tool", async () => {
    orchestration.clearCycleDecision.mockResolvedValue(undefined);

    const result = await service.callTool(
      "kanban.orchestration_clear_cycle_decision",
      { project_id: "project-1", reason: "Ready work was restored" },
      { correlationId: "corr-1" },
    );

    expect(orchestration.clearCycleDecision).toHaveBeenCalledWith("project-1", {
      reason: "Ready work was restored",
    });
    expect(result).toEqual({ ok: true, project_id: "project-1" });
  });

  it("publishes markdown specs from the active workflow workspace into kanban work items", async () => {
    const specDir = "/fixtures/kanban-publish-specs-1/docs/work-items";
    registerSpecDir(specDir, {
      "foundation.md": [
        "---",
        "item_id: foundation",
        "title: Build foundation",
        "priority: p1",
        "scope: standard",
        "---",
        "Implement the foundation.",
      ].join("\n"),
      "feature.md": [
        "---",
        "item_id: feature",
        'title: "Build feature"',
        "depends_on_item_ids:",
        "  - foundation",
        "---",
        "Implement the feature.",
      ].join("\n"),
    });

    const created: Array<Record<string, unknown>> = [];
    workItems.listWorkItems.mockResolvedValue(created);
    workItems.createWorkItem.mockImplementation((_project_id, input) => {
      const item = {
        id: `wi-${String(created.length + 1)}`,
        title: input.title,
        metadata: input.metadata,
      };
      created.push(item);
      return Promise.resolve(item);
    });
    workItems.updateWorkItem.mockImplementation(
      (_project_id, workItemId, patch) =>
        Promise.resolve({
          id: workItemId,
          ...(patch as Record<string, unknown>),
        }),
    );

    const result = await service.callTool(
      "kanban.publish_specs",
      { project_id: "project-1", spec_directory: specDir },
      { workflowRunId: "run-1", stepId: "step-1" },
    );

    expect(workItems.createWorkItem).toHaveBeenCalledTimes(2);
    expect(workItems.createWorkItem).toHaveBeenNthCalledWith(
      1,
      "project-1",
      expect.objectContaining({
        title: "Build foundation",
        priority: "p1",
        scope: "standard",
        description: "Implement the foundation.",
        metadata: expect.objectContaining({
          source: "publish_specs",
          sourceId: "foundation",
        }),
      }),
    );
    expect(workItems.createWorkItem).toHaveBeenNthCalledWith(
      2,
      "project-1",
      expect.objectContaining({
        title: "Build feature",
      }),
    );
    expect(workItems.updateWorkItem).toHaveBeenCalledWith("project-1", "wi-2", {
      dependencyIds: ["wi-1"],
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        status: "completed",
        created_count: 2,
        updated_count: 0,
        unchanged_count: 0,
        spec_count: 2,
      }),
    );
  });

  it("resolves publish_specs dependencies to existing published source items", async () => {
    const specDir = "/fixtures/kanban-publish-specs-2/docs/work-items";
    registerSpecDir(specDir, {
      "feature.md": [
        "---",
        "item_id: feature",
        "title: Feature",
        "depends_on_item_ids:",
        "  - foundation",
        "---",
        "Implement the feature.",
      ].join("\n"),
    });
    workItems.listWorkItems.mockResolvedValue([
      { id: "wi-foundation", metadata: { sourceId: "foundation" } },
    ]);
    workItems.createWorkItem.mockResolvedValue({ id: "wi-feature" });
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-feature" });

    await service.callTool(
      "kanban.publish_specs",
      { project_id: "project-1", spec_directory: specDir },
      { workflowRunId: "run-1", stepId: "step-1" },
    );

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-feature",
      { dependencyIds: ["wi-foundation"] },
    );
  });

  it("clears publish_specs dependencies when a republished spec removes them", async () => {
    const specDir = "/fixtures/kanban-publish-specs-3/docs/work-items";
    registerSpecDir(specDir, {
      "feature.md": [
        "---",
        "item_id: feature",
        "title: Feature",
        "---",
        "Implement the feature.",
      ].join("\n"),
    });
    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-feature",
        status: "todo",
        metadata: { sourceId: "feature", sourceHash: "old-hash" },
      },
    ]);
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-feature" });

    await service.callTool(
      "kanban.publish_specs",
      { project_id: "project-1", spec_directory: specDir },
      { workflowRunId: "run-1", stepId: "step-1" },
    );

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-feature",
      expect.objectContaining({ dependencyIds: [] }),
    );
  });

  it("forwards allow_missing_specs to the real PublishSpecsTool", async () => {
    const result = await service.callTool(
      "kanban.publish_specs",
      {
        project_id: "project-1",
        spec_directory: "/nonexistent/path",
        allow_missing_specs: true,
      },
      { workflowRunId: "run-1", stepId: "step-1" },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "noop",
      reason: "missing_spec_directory",
    });
    expect(workItems.listWorkItems).not.toHaveBeenCalled();
  });

  it("does not hide real publish_specs errors when allow_missing_specs is false", async () => {
    await expect(
      service.callTool(
        "kanban.publish_specs",
        { project_id: "project-1", spec_directory: "/nonexistent/path" },
        { workflowRunId: "run-1", stepId: "step-1" },
      ),
    ).rejects.toThrow();
  });

  it("invokes review actions through the review service", async () => {
    review.recordDecision.mockResolvedValue({ runId: "run-2" });

    const result = await service.callTool(
      "kanban.review_decision",
      {
        project_id: "project-1",
        workItemId: "wi-1",
        decision: "approve",
        workflowId: "review_workflow",
        requestedBy: "agent-1",
      },
      { correlationId: "corr-review" },
    );

    expect(review.recordDecision).toHaveBeenCalledWith({
      project_id: "project-1",
      workItemId: "wi-1",
      decision: "approve",
      workflowId: "review_workflow",
      requestedBy: "agent-1",
    });
    expect(result).toEqual({ ok: true });
  });

  it("patches work item metadata through kanban-owned MCP tools", async () => {
    workItems.listWorkItems.mockResolvedValue([
      { id: "wi-1", metadata: { existing: true } },
    ]);
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-1" });

    await service.callTool(
      "kanban.work_item_patch_metadata",
      {
        project_id: "project-1",
        workItemId: "wi-1",
        metadataPatch: { refinement: { lastOutcome: "approved" } },
      },
      { workflowRunId: "run-1" },
    );

    expect(workItems.updateWorkItem).toHaveBeenCalledWith("project-1", "wi-1", {
      metadata: {
        existing: true,
        refinement: { lastOutcome: "approved" },
      },
    });
  });

  it("upserts work item subtasks through kanban-owned MCP tools", async () => {
    workItems.listWorkItems.mockResolvedValue([
      {
        id: "wi-1",
        subtasks: [{ subtaskId: "existing", title: "Existing" }],
      },
    ]);
    workItems.updateWorkItem.mockResolvedValue({ id: "wi-1" });

    await service.callTool(
      "kanban.work_item_subtask_upsert",
      {
        project_id: "project-1",
        workItemId: "wi-1",
        subtask: {
          subtask_id: "new-task",
          title: "New task",
          order_index: 1,
          depends_on_subtask_ids: ["existing"],
        },
      },
      { workflowRunId: "run-1" },
    );

    expect(workItems.updateWorkItem).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        subtasks: [
          { subtaskId: "existing", title: "Existing" },
          {
            subtaskId: "new-task",
            title: "New task",
            orderIndex: 1,
            dependsOnSubtaskIds: ["existing"],
            status: "todo",
          },
        ],
      }),
    );
  });
});
