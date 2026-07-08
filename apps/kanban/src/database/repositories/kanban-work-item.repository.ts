import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository, In } from "typeorm";
import { KanbanWorkItemDependencyEntity } from "../entities/kanban-work-item-dependency.entity";
import { KanbanWorkItemSubtaskEntity } from "../entities/kanban-work-item-subtask.entity";
import { KanbanWorkItemEntity } from "../entities/kanban-work-item.entity";
import {
  WORK_ITEM_SORT_COLUMNS,
  type WorkItemQueryParams,
} from "./kanban-work-item.repository.types";

@Injectable()
export class KanbanWorkItemRepository {
  constructor(
    @InjectRepository(KanbanWorkItemEntity)
    private readonly repository: Repository<KanbanWorkItemEntity>,
    @InjectRepository(KanbanWorkItemDependencyEntity)
    private readonly dependencies: Repository<KanbanWorkItemDependencyEntity>,
    @InjectRepository(KanbanWorkItemSubtaskEntity)
    private readonly subtasks: Repository<KanbanWorkItemSubtaskEntity>,
  ) {}

  save(workItem: Partial<KanbanWorkItemEntity>): Promise<KanbanWorkItemEntity> {
    return this.repository.save(this.repository.create(workItem));
  }

  async clearRunLinksIfMatches(
    project_id: string,
    workItemId: string,
    runId: string,
    lastExecutionStatus: string,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({
        linked_run_id: null,
        current_execution_id: null,
        last_execution_status: lastExecutionStatus,
      })
      .where("id = :workItemId", { workItemId })
      .andWhere("project_id = :project_id", { project_id })
      .andWhere("linked_run_id = :runId", { runId })
      .andWhere(
        "(current_execution_id = :runId OR current_execution_id IS NULL)",
        { runId },
      )
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Persist the latest workflow-run status onto the work item so the board's
   * running indicators reflect live execution state. Keyed on the attached
   * run (`current_execution_id`/`linked_run_id`) so a stale event for a
   * superseded run cannot overwrite the current status. Safe to call on
   * every non-terminal lifecycle event. Returns true when a row was updated.
   */
  async recordExecutionStatus(params: {
    project_id: string;
    workItemId: string;
    runId: string;
    status: string;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({ last_execution_status: params.status })
      .where("id = :workItemId", { workItemId: params.workItemId })
      .andWhere("project_id = :project_id", { project_id: params.project_id })
      .andWhere("(current_execution_id = :runId OR linked_run_id = :runId)", {
        runId: params.runId,
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async linkRunIfUnlinked(params: {
    project_id: string;
    workItemId: string;
    runId: string;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({
        linked_run_id: params.runId,
        current_execution_id: params.runId,
      })
      .where("id = :workItemId", { workItemId: params.workItemId })
      .andWhere("project_id = :project_id", { project_id: params.project_id })
      .andWhere("linked_run_id IS NULL")
      .andWhere("current_execution_id IS NULL")
      .execute();

    return (result.affected ?? 0) > 0;
  }

  /**
   * Atomically adds token usage to a work item's running total. Used to project
   * per-work-item spend from terminal workflow-run lifecycle events. No-op for
   * non-positive amounts. Returns true when a row was updated.
   */
  async addTokenSpend(params: {
    project_id: string;
    workItemId: string;
    amount: number;
  }): Promise<boolean> {
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      return false;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({ token_spend: () => "token_spend + :amount" })
      .where("id = :workItemId", { workItemId: params.workItemId })
      .andWhere("project_id = :project_id", { project_id: params.project_id })
      .setParameter("amount", params.amount)
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async addCostSpend(params: {
    project_id: string;
    workItemId: string;
    amountCents: number;
  }): Promise<boolean> {
    if (!Number.isFinite(params.amountCents) || params.amountCents <= 0) {
      return false;
    }

    const result = await this.repository
      .createQueryBuilder()
      .update(KanbanWorkItemEntity)
      .set({ cost_cents: () => "cost_cents + :amountCents" })
      .where("id = :workItemId", { workItemId: params.workItemId })
      .andWhere("project_id = :project_id", { project_id: params.project_id })
      .setParameter("amountCents", params.amountCents)
      .execute();

    return (result.affected ?? 0) > 0;
  }

  findTopByCostDesc(options: {
    limit: number;
    projectId?: string;
  }): Promise<
    Pick<
      KanbanWorkItemEntity,
      | "id"
      | "project_id"
      | "title"
      | "status"
      | "cost_cents"
      | "token_spend"
      | "type"
      | "story_points"
      | "execution_config"
    >[]
  > {
    const qb = this.repository
      .createQueryBuilder("w")
      .select([
        "w.id",
        "w.project_id",
        "w.title",
        "w.status",
        "w.cost_cents",
        "w.token_spend",
        "w.type",
        "w.story_points",
        "w.execution_config",
      ])
      .where("w.cost_cents > 0")
      .orderBy("w.cost_cents", "DESC")
      .take(options.limit);

    if (options.projectId) {
      qb.andWhere("w.project_id = :projectId", {
        projectId: options.projectId,
      });
    }

    return qb.getMany();
  }

  findByproject_id(
    project_id: string,
    options?: { limit?: number; offset?: number },
  ): Promise<KanbanWorkItemEntity[]> {
    return this.repository.find({
      where: {
        project_id: project_id,
      },
      order: {
        created_at: "ASC",
      },
      ...(options?.limit != null ? { take: options.limit } : {}),
      ...(options?.offset != null ? { skip: options.offset } : {}),
    });
  }

  findAll(options?: {
    limit?: number;
    offset?: number;
  }): Promise<KanbanWorkItemEntity[]> {
    return this.repository.find({
      order: { created_at: "ASC" },
      ...(options?.limit != null ? { take: options.limit } : {}),
      ...(options?.offset != null ? { skip: options.offset } : {}),
    });
  }

  async queryWorkItems(
    params: WorkItemQueryParams,
  ): Promise<{ items: KanbanWorkItemEntity[]; total: number }> {
    const qb = this.repository.createQueryBuilder("item");

    if (params.projectId) {
      qb.andWhere("item.project_id = :projectId", {
        projectId: params.projectId,
      });
    }
    if (params.status && params.status.length > 0) {
      qb.andWhere("item.status IN (:...status)", { status: params.status });
    }
    if (params.priority && params.priority.length > 0) {
      qb.andWhere("item.priority IN (:...priority)", {
        priority: params.priority,
      });
    }
    if (params.scope && params.scope.length > 0) {
      qb.andWhere("item.scope IN (:...scope)", { scope: params.scope });
    }
    if (params.search) {
      qb.andWhere(
        "(item.title ILIKE :search OR item.description ILIKE :search)",
        { search: `%${params.search}%` },
      );
    }

    const column = WORK_ITEM_SORT_COLUMNS[params.sortBy];
    qb.orderBy(column, params.sortDir === "asc" ? "ASC" : "DESC");
    // Stable tiebreaker so rows with equal sort values keep a deterministic
    // order across pages (prevents skipped/duplicated items during pagination).
    qb.addOrderBy("item.id", "ASC");
    qb.skip(params.offset);
    qb.take(params.limit);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  findByProjectAndId(
    project_id: string,
    workItemId: string,
  ): Promise<KanbanWorkItemEntity | null> {
    return this.repository.findOne({
      where: {
        id: workItemId,
        project_id: project_id,
      },
    });
  }

  /**
   * Acquire a `SELECT ... FOR UPDATE` row lock on the work item and return
   * its current state. The lock is only meaningful inside a transaction —
   * the caller must invoke this method with the same `manager` that owns
   * the surrounding `EntityManager.transaction(...)` boundary, or via a
   * repository instance bound to that manager (`manager.getRepository`).
   *
   * Used by `WorkItemService.requestWorkItemRun` to assert the
   * `linked_run_id === current_execution_id === accepted.run_id`
   * invariant immediately after `linkRunIfUnlinked` so the lease-protected
   * write path cannot silently diverge from the persisted projection.
   */
  findByProjectAndIdForUpdate(
    project_id: string,
    workItemId: string,
    manager?: EntityManager,
  ): Promise<KanbanWorkItemEntity | null> {
    const executor = manager
      ? manager.getRepository(KanbanWorkItemEntity)
      : this.repository;
    return executor
      .createQueryBuilder("workItem")
      .where("workItem.id = :workItemId", { workItemId })
      .andWhere("workItem.project_id = :project_id", { project_id })
      .setLock("pessimistic_write")
      .getOne();
  }

  findByExternalSyncRef(
    project_id: string,
    connectionId: string,
    externalId: string,
  ): Promise<KanbanWorkItemEntity | null> {
    return this.repository
      .createQueryBuilder("workItem")
      .where("workItem.project_id = :projectId", { projectId: project_id })
      .andWhere(
        "workItem.metadata->'external_sync'->>'connection_id' = :connectionId",
        { connectionId },
      )
      .andWhere(
        "workItem.metadata->'external_sync'->>'external_id' = :externalId",
        { externalId },
      )
      .getOne();
  }

  async replaceDependencies(
    workItemId: string,
    dependencyIds: string[],
  ): Promise<void> {
    await this.dependencies.delete({ work_item_id: workItemId });
    if (dependencyIds.length === 0) return;

    await this.dependencies.save(
      dependencyIds.map((dependsOnWorkItemId) =>
        this.dependencies.create({
          work_item_id: workItemId,
          depends_on_work_item_id: dependsOnWorkItemId,
        }),
      ),
    );
  }

  findDependenciesByWorkItemIds(
    workItemIds: string[],
  ): Promise<KanbanWorkItemDependencyEntity[]> {
    if (workItemIds.length === 0) return Promise.resolve([]);

    return this.dependencies
      .createQueryBuilder("dependency")
      .where("dependency.work_item_id IN (:...workItemIds)", { workItemIds })
      .getMany();
  }

  async replaceSubtasks(
    project_id: string,
    workItemId: string,
    subtasks: Partial<KanbanWorkItemSubtaskEntity>[],
  ): Promise<KanbanWorkItemSubtaskEntity[]> {
    await this.subtasks.delete({ work_item_id: workItemId });
    if (subtasks.length === 0) return [];

    return this.subtasks.save(
      subtasks.map((subtask, index) =>
        this.subtasks.create({
          project_id: project_id,
          work_item_id: workItemId,
          subtask_id: subtask.subtask_id,
          title: subtask.title,
          status: subtask.status ?? "todo",
          order_index: subtask.order_index ?? index,
          depends_on_subtask_ids: subtask.depends_on_subtask_ids ?? [],
          source_path: subtask.source_path ?? "",
          source_hash: subtask.source_hash ?? "",
          source_last_synced_at: subtask.source_last_synced_at ?? null,
          is_archived: subtask.is_archived ?? false,
          metadata: subtask.metadata ?? null,
        }),
      ),
    );
  }

  findSubtasksByWorkItemIds(
    workItemIds: string[],
  ): Promise<KanbanWorkItemSubtaskEntity[]> {
    if (workItemIds.length === 0) return Promise.resolve([]);

    return this.subtasks
      .createQueryBuilder("subtask")
      .where("subtask.work_item_id IN (:...workItemIds)", { workItemIds })
      .orderBy("subtask.order_index", "ASC")
      .addOrderBy("subtask.created_at", "ASC")
      .getMany();
  }

  async deleteByproject_id(project_id: string): Promise<void> {
    await this.repository.delete({ project_id: project_id });
  }

  async deleteByProjectAndId(
    project_id: string,
    workItemId: string,
  ): Promise<void> {
    await this.subtasks.delete({ work_item_id: workItemId });
    await this.dependencies.delete({ work_item_id: workItemId });
    await this.dependencies.delete({ depends_on_work_item_id: workItemId });
    await this.repository.delete({ id: workItemId, project_id: project_id });
  }

  async findByIds(workItemIds: string[]): Promise<KanbanWorkItemEntity[]> {
    if (workItemIds.length === 0) return [];
    return this.repository.find({
      where: { id: In(workItemIds) },
    });
  }

  /**
   * Returns the subset of `parentIds` that have at least one direct child
   * (i.e. another work item whose `parent_work_item_id` matches). Used to
   * decide whether a work item may be deleted/retyped as a leaf, and to
   * drive rollup-points display in the board.
   */
  async existsChildrenFor(parentIds: string[]): Promise<Set<string>> {
    if (parentIds.length === 0) return new Set();

    const rows = await this.repository
      .createQueryBuilder("wi")
      .select("DISTINCT wi.parent_work_item_id", "parentId")
      .where("wi.parent_work_item_id IN (:...parentIds)", { parentIds })
      .getRawMany<{ parentId: string }>();

    return new Set(rows.map((row) => row.parentId));
  }

  /**
   * Returns the ids of a work item's direct children (one level down).
   */
  async findChildIds(parentId: string): Promise<string[]> {
    const rows = await this.repository
      .createQueryBuilder("wi")
      .select("wi.id", "id")
      .where("wi.parent_work_item_id = :parentId", { parentId })
      .getRawMany<{ id: string }>();

    return rows.map((row) => row.id);
  }

  /**
   * Recursively sums `story_points` across every descendant (children,
   * grandchildren, etc.) of `parentId`. Returns `null` when the subtree has
   * no pointed descendants, matching the "no estimate yet" semantics used
   * for un-pointed work items rather than conflating it with a real `0`.
   */
  async computeRolledUpPoints(parentId: string): Promise<number | null> {
    const rows: Array<{ total: number | null }> = await this.repository.query(
      `
      WITH RECURSIVE descendants AS (
        SELECT id, story_points FROM kanban_work_items
          WHERE parent_work_item_id = $1
        UNION ALL
        SELECT c.id, c.story_points FROM kanban_work_items c
          JOIN descendants d ON c.parent_work_item_id = d.id
      )
      SELECT COALESCE(SUM(story_points), NULL)::int AS total FROM descendants
      `,
      [parentId],
    );

    return rows[0]?.total ?? null;
  }
}
