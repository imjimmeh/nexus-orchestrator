import { describe, expect, it } from "vitest";
import { WorkItem } from "@/lib/api/work-items.types";
import {
  getEligibleParentCandidates,
  validateWorkItemTypeFields,
} from "./work-item-type-form.helpers";

describe("validateWorkItemTypeFields", () => {
  it("rejects story points on an epic", () => {
    const errors = validateWorkItemTypeFields({
      type: "epic",
      storyPoints: 5,
    });
    expect(errors.storyPoints).toBeTruthy();
  });

  it("allows story points on a non-epic type", () => {
    const errors = validateWorkItemTypeFields({
      type: "story",
      storyPoints: 5,
    });
    expect(errors.storyPoints).toBeUndefined();
  });

  it("rejects a parent on an epic regardless of the parent's type", () => {
    const errors = validateWorkItemTypeFields({
      type: "epic",
      parentType: "epic",
    });
    expect(errors.parentWorkItemId).toBeTruthy();
  });

  it("rejects an illegal parent/child pairing", () => {
    const errors = validateWorkItemTypeFields({
      type: "bug",
      parentType: "task",
    });
    expect(errors.parentWorkItemId).toBeTruthy();
  });

  it("allows a legal parent/child pairing", () => {
    const errors = validateWorkItemTypeFields({
      type: "task",
      parentType: "epic",
    });
    expect(errors.parentWorkItemId).toBeUndefined();
  });

  it("returns no errors when neither parent nor points are set", () => {
    expect(validateWorkItemTypeFields({ type: "epic" })).toEqual({});
  });
});

describe("getEligibleParentCandidates", () => {
  const items = [
    { id: "1", title: "Epic A", type: "epic" },
    { id: "2", title: "Story B", type: "story" },
    { id: "3", title: "Task C", type: "task" },
    { id: "4", title: "Bug D", type: "bug" },
  ] as unknown as WorkItem[];

  it("only offers items whose type can parent the target type", () => {
    const candidates = getEligibleParentCandidates(items, "task");
    expect(candidates.map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("returns no candidates for an epic (epics can never have a parent)", () => {
    expect(getEligibleParentCandidates(items, "epic")).toEqual([]);
  });

  it("excludes the item being edited from its own candidate list", () => {
    const candidates = getEligibleParentCandidates(items, "task", "1");
    expect(candidates.map((c) => c.id)).toEqual(["2"]);
  });
});
