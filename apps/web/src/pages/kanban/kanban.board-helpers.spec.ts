import { describe, expect, it } from "vitest";
import {
  createDroppableId,
  getInitialCollapsedColumns,
  parseStatusFromDroppableId,
} from "./kanban.board-helpers";

describe("kanban.board-helpers", () => {
  it("includes refinement in collapsed column defaults", () => {
    const columns = getInitialCollapsedColumns();
    expect(columns.refinement).toBe(false);
  });

  it("parses refinement from droppable id", () => {
    const droppableId = createDroppableId("flat", "refinement");
    expect(parseStatusFromDroppableId(droppableId)).toBe("refinement");
  });
});
