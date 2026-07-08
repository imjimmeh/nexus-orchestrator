import type { KanbanWorkItemEntity } from "../database/entities/kanban-work-item.entity";

/**
 * Default values used when constructing a new {@link KanbanWorkItemEntity}.
 *
 * Centralized here so the create-path (service + project-service ingestion
 * bootstrap) cannot drift apart when the entity gains a new column or a
 * default changes. Keeping the defaults inline (rather than scattered across
 * `service.ts` and `project.service.ts`) prevents one call site from silently
 * adopting a new column while the other keeps the old shape.
 */
export const KANBAN_WORK_ITEM_CREATE_DEFAULTS = {
  description: null,
  priority: "p2",
  type: "story",
  parent_work_item_id: null,
  story_points: null,
  assigned_agent_id: null,
  token_spend: 0,
  cost_cents: 0,
  current_execution_id: null,
  waiting_for_input: false,
  execution_config: null,
  metadata: null,
  linked_run_id: null,
  last_execution_status: null,
  initiative_id: null,
} as const satisfies Partial<KanbanWorkItemEntity>;

/**
 * Builds a fully-typed create-shape for a {@link KanbanWorkItemEntity} that
 * matches the canonical column list of `kanban_work_items`.
 *
 * Callers MUST supply the required identity / business fields via
 * `overrides`:
 *   - `id`
 *   - `project_id`
 *   - `title`
 *   - `status`
 *
 * Everything else falls back to {@link KANBAN_WORK_ITEM_CREATE_DEFAULTS},
 * which mirrors the column-level defaults declared on
 * `KanbanWorkItemEntity` (`description` null, `priority` "p2",
 * `type` "story", `parent_work_item_id` null, `story_points` null,
 * `token_spend` 0, `cost_cents` 0, all nullable link columns null, etc.).
 *
 * The factory is deterministic: it does not call `Date.now()` or any random
 * source. Callers that need a specific `created_at` / `updated_at` must
 * supply them via overrides (or via TypeORM's `@CreateDateColumn` /
 * `@UpdateDateColumn` runtime, which fills them in on `save()`).
 *
 * @example
 *   toCreateEntity({
 *     id: randomUUID(),
 *     project_id,
 *     title: "Design Ingestion: Project",
 *     status: "backlog",
 *     priority: "p1",
 *     type: "epic",
 *     metadata: { type: "ingestion", source: "project_creation" },
 *   });
 */
export function toCreateEntity(
  overrides: Partial<KanbanWorkItemEntity>,
): Partial<KanbanWorkItemEntity> {
  return {
    ...KANBAN_WORK_ITEM_CREATE_DEFAULTS,
    ...overrides,
  };
}
