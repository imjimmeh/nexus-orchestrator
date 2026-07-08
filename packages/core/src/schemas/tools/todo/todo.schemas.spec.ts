import { describe, it, expect } from "vitest";
import {
  TodoStatusSchema,
  TodoItemSchema,
  ManageTodoListSchema,
  GetTodoListSchema,
  TodoStateUpdatePayloadSchema,
} from "./todo.schemas";

describe("TodoStatusSchema", () => {
  it("accepts valid statuses", () => {
    expect(TodoStatusSchema.parse("not-started")).toBe("not-started");
    expect(TodoStatusSchema.parse("in-progress")).toBe("in-progress");
    expect(TodoStatusSchema.parse("completed")).toBe("completed");
  });

  it("rejects unknown status", () => {
    expect(() => TodoStatusSchema.parse("pending")).toThrow();
  });
});

describe("TodoItemSchema", () => {
  it("accepts a valid todo item", () => {
    const item = TodoItemSchema.parse({
      id: 1,
      text: "Write tests",
      status: "not-started",
    });
    expect(item.id).toBe(1);
    expect(item.text).toBe("Write tests");
  });

  it("rejects non-positive id", () => {
    expect(() =>
      TodoItemSchema.parse({ id: 0, text: "x", status: "not-started" }),
    ).toThrow();
  });

  it("rejects non-integer id", () => {
    expect(() =>
      TodoItemSchema.parse({ id: 1.5, text: "x", status: "not-started" }),
    ).toThrow();
  });
});

describe("ManageTodoListSchema", () => {
  it("accepts add action with text", () => {
    const result = ManageTodoListSchema.parse({
      action: "manage_todo_list",
      todo_action: "add",
      text: "New task",
    });
    expect(result.todo_action).toBe("add");
    expect(result.text).toBe("New task");
  });

  it("accepts start action with id", () => {
    const result = ManageTodoListSchema.parse({
      action: "manage_todo_list",
      todo_action: "start",
      id: 1,
    });
    expect(result.id).toBe(1);
  });

  it("accepts list action without text or id", () => {
    const result = ManageTodoListSchema.parse({
      action: "manage_todo_list",
      todo_action: "list",
    });
    expect(result.todo_action).toBe("list");
  });

  it("accepts clear action", () => {
    const result = ManageTodoListSchema.parse({
      action: "manage_todo_list",
      todo_action: "clear",
    });
    expect(result.todo_action).toBe("clear");
  });

  it("rejects unknown todo_action", () => {
    expect(() =>
      ManageTodoListSchema.parse({
        action: "manage_todo_list",
        todo_action: "delete",
      }),
    ).toThrow();
  });

  it("rejects unknown extra fields", () => {
    expect(() =>
      ManageTodoListSchema.parse({
        action: "manage_todo_list",
        todo_action: "list",
        unknown: true,
      }),
    ).toThrow();
  });
});

describe("GetTodoListSchema", () => {
  it("accepts empty payload", () => {
    const result = GetTodoListSchema.parse({ action: "get_todo_list" });
    expect(result.action).toBe("get_todo_list");
  });
});

describe("TodoStateUpdatePayloadSchema", () => {
  it("accepts empty todo array", () => {
    const result = TodoStateUpdatePayloadSchema.parse({ todos: [] });
    expect(result.todos).toHaveLength(0);
  });

  it("accepts populated todo array", () => {
    const result = TodoStateUpdatePayloadSchema.parse({
      todos: [
        { id: 1, text: "Task A", status: "in-progress" },
        { id: 2, text: "Task B", status: "completed" },
      ],
    });
    expect(result.todos).toHaveLength(2);
  });
});
