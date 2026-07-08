import { describe, expect, it } from "vitest";
import { filterWorkItems } from "./useWorkItemFilters";
import { WorkItem } from "@/lib/api/work-items.types";

const items = [
  {
    id: "1",
    title: "Build login",
    priority: "p1",
    type: "story",
  },
  { id: "2", title: "Fix logout", priority: "p2", type: "bug" },
  {
    id: "3",
    title: "Track spike",
    priority: "p2",
    type: "spike",
  },
] as unknown as WorkItem[];

describe("filterWorkItems", () => {
  it("returns all items when no filter is active", () => {
    expect(filterWorkItems(items, {})).toHaveLength(3);
  });

  it("filters by case-insensitive title search", () => {
    const result = filterWorkItems(items, { search: "LOGIN" });
    expect(result.map((i) => i.id)).toEqual(["1"]);
  });

  it("filters by priority", () => {
    expect(filterWorkItems(items, { priority: "p2" }).map((i) => i.id)).toEqual(
      ["2", "3"],
    );
  });

  it("filters by type", () => {
    expect(filterWorkItems(items, { type: "bug" }).map((i) => i.id)).toEqual([
      "2",
    ]);
    expect(filterWorkItems(items, { type: "spike" }).map((i) => i.id)).toEqual([
      "3",
    ]);
  });
});
