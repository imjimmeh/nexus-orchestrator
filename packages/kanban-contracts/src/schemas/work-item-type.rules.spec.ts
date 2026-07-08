import { describe, expect, it } from "vitest";
import {
  isEpicType,
  canHaveChildren,
  canParent,
  allowsStoryPoints,
  isDispatchable,
} from "./work-item-type.rules";

describe("work-item-type.rules", () => {
  it("epic is the only always-container type", () => {
    expect(isEpicType("epic")).toBe(true);
    expect(isEpicType("story")).toBe(false);
    expect(canHaveChildren("epic")).toBe(true);
    expect(canHaveChildren("story")).toBe(true);
    expect(canHaveChildren("task")).toBe(false);
  });

  it("enforces the parent matrix", () => {
    expect(canParent("epic", "story")).toBe(true);
    expect(canParent("epic", "task")).toBe(true);
    expect(canParent("story", "task")).toBe(true);
    expect(canParent("story", "story")).toBe(false);
    expect(canParent("epic", "epic")).toBe(false);
    expect(canParent("task", "bug")).toBe(false);
  });

  it("forbids points only on epics", () => {
    expect(allowsStoryPoints("epic")).toBe(false);
    expect(allowsStoryPoints("story")).toBe(true);
    expect(allowsStoryPoints("spike")).toBe(true);
  });

  it("dispatchable = not epic AND no children", () => {
    expect(isDispatchable("epic", false)).toBe(false);
    expect(isDispatchable("story", false)).toBe(true);
    expect(isDispatchable("story", true)).toBe(false);
    expect(isDispatchable("task", false)).toBe(true);
    expect(isDispatchable("task", true)).toBe(false);
  });
});
