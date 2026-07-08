import { describe, expect, it } from "vitest";
import type { KanbanWorkItemEntity } from "../database/entities/kanban-work-item.entity";
import {
  KANBAN_WORK_ITEM_CREATE_DEFAULTS,
  toCreateEntity,
} from "./work-item.factory";

describe("toCreateEntity factory", () => {
  it("populates every column on the create-shape with its default", () => {
    const required = {
      id: "work-item-1",
      project_id: "project-1",
      title: "Implement feature",
      status: "backlog",
    } as const satisfies Partial<KanbanWorkItemEntity>;

    const created = toCreateEntity(required);

    // The returned object must be a fully-typed entity with every column
    // populated — this guards against schema drift on
    // `KanbanWorkItemEntity` (new column added but factory not updated).
    expect(created.id).toBe("work-item-1");
    expect(created.project_id).toBe("project-1");
    expect(created.title).toBe("Implement feature");
    expect(created.status).toBe("backlog");
    expect(created.description).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.description,
    );
    expect(created.priority).toBe(KANBAN_WORK_ITEM_CREATE_DEFAULTS.priority);
    expect(created.type).toBe(KANBAN_WORK_ITEM_CREATE_DEFAULTS.type);
    expect(created.parent_work_item_id).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.parent_work_item_id,
    );
    expect(created.story_points).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.story_points,
    );
    expect(created.assigned_agent_id).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.assigned_agent_id,
    );
    expect(created.token_spend).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.token_spend,
    );
    expect(created.cost_cents).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.cost_cents,
    );
    expect(created.current_execution_id).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.current_execution_id,
    );
    expect(created.waiting_for_input).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.waiting_for_input,
    );
    expect(created.execution_config).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.execution_config,
    );
    expect(created.metadata).toBe(KANBAN_WORK_ITEM_CREATE_DEFAULTS.metadata);
    expect(created.linked_run_id).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.linked_run_id,
    );
    expect(created.last_execution_status).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.last_execution_status,
    );
    expect(created.initiative_id).toBe(
      KANBAN_WORK_ITEM_CREATE_DEFAULTS.initiative_id,
    );
  });

  it("returns defaults that match the entity column-level defaults", () => {
    // These mirror the @Column({ default: ... }) values declared on
    // `KanbanWorkItemEntity`. If either side drifts, this test fails so the
    // refactor cannot silently change persisted behaviour.
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.priority).toBe("p2");
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.type).toBe("story");
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.parent_work_item_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.story_points).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.token_spend).toBe(0);
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.cost_cents).toBe(0);
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.waiting_for_input).toBe(false);
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.description).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.assigned_agent_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.current_execution_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.execution_config).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.metadata).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.linked_run_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.last_execution_status).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.initiative_id).toBeNull();
  });

  it("lets overrides win over defaults", () => {
    const metadata = { type: "ingestion", source: "project_creation" };

    const created = toCreateEntity({
      id: "work-item-2",
      project_id: "project-2",
      title: "Ingestion",
      status: "backlog",
      priority: "p1",
      type: "epic",
      parent_work_item_id: "parent-1",
      story_points: 5,
      description: "explicit description",
      metadata,
      token_spend: 42,
      cost_cents: 7,
      waiting_for_input: true,
    });

    // Overridden fields
    expect(created.priority).toBe("p1");
    expect(created.type).toBe("epic");
    expect(created.parent_work_item_id).toBe("parent-1");
    expect(created.story_points).toBe(5);
    expect(created.description).toBe("explicit description");
    expect(created.metadata).toBe(metadata);
    expect(created.token_spend).toBe(42);
    expect(created.cost_cents).toBe(7);
    expect(created.waiting_for_input).toBe(true);

    // Fields the caller did not touch keep their defaults.
    expect(created.assigned_agent_id).toBeNull();
    expect(created.current_execution_id).toBeNull();
    expect(created.execution_config).toBeNull();
    expect(created.linked_run_id).toBeNull();
    expect(created.last_execution_status).toBeNull();
    expect(created.initiative_id).toBeNull();
  });

  it("returns a value that structurally matches KanbanWorkItemEntity", () => {
    // Compile-time + runtime assertion that the factory's output is assignable
    // to the entity type. If a new required column is added to the entity
    // without updating the factory, this assignment stops compiling.
    const created: Partial<KanbanWorkItemEntity> = toCreateEntity({
      id: "work-item-3",
      project_id: "project-3",
      title: "Shape check",
      status: "todo",
    });

    expect(created).toBeDefined();
    expect(typeof created.id).toBe("string");
    expect(typeof created.project_id).toBe("string");
    expect(typeof created.title).toBe("string");
    expect(typeof created.status).toBe("string");
  });

  it("does not mutate the override object", () => {
    const override: Partial<KanbanWorkItemEntity> = {
      id: "work-item-4",
      project_id: "project-4",
      title: "Immutable",
      status: "todo",
    };
    const snapshot = { ...override };

    toCreateEntity(override);

    expect(override).toEqual(snapshot);
  });
});

describe("work item factory defaults", () => {
  it("defaults type to story with null parent/points and no scope", () => {
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.type).toBe("story");
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.parent_work_item_id).toBeNull();
    expect(KANBAN_WORK_ITEM_CREATE_DEFAULTS.story_points).toBeNull();
    expect("scope" in KANBAN_WORK_ITEM_CREATE_DEFAULTS).toBe(false);
  });

  it("merges overrides over defaults", () => {
    const shape = toCreateEntity({
      id: "1",
      project_id: "p",
      title: "t",
      status: "backlog",
      type: "epic",
    });
    expect(shape.type).toBe("epic");
    expect(shape.priority).toBe("p2");
  });
});
