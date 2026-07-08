import { describe, expect, it } from "vitest";
import { filterDispatchableTodo } from "./work-item-dispatchable.helper";

const item = (o: Partial<Record<string, unknown>>) => ({
  id: "x",
  status: "todo",
  type: "story",
  parent_work_item_id: null,
  ...o,
});

describe("filterDispatchableTodo", () => {
  it("keeps childless todo stories, drops epics and parents", () => {
    const epic = item({ id: "e", type: "epic" });
    const parent = item({ id: "p", type: "story" });
    const child = item({ id: "c", type: "task", parent_work_item_id: "p" });
    const lone = item({ id: "l", type: "task" });
    const notTodo = item({ id: "n", type: "story", status: "in-progress" });

    const kept = filterDispatchableTodo([
      epic,
      parent,
      child,
      lone,
      notTodo,
    ]).map((i) => i.id);
    expect(kept.sort()).toEqual(["c", "l"]);
  });
});
