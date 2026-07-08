import { describe, expect, it } from "vitest";
import { edgeTypes } from "./edge-types";
import { DependencyEdge } from "./DependencyEdge";
import { TransitionEdge } from "./TransitionEdge";
import { SwitchEdge } from "./SwitchEdge";

describe("edgeTypes", () => {
  it("maps dependency to DependencyEdge", () => {
    expect(edgeTypes.dependency).toBe(DependencyEdge);
  });

  it("maps transition to TransitionEdge", () => {
    expect(edgeTypes.transition).toBe(TransitionEdge);
  });

  it("maps switch to SwitchEdge", () => {
    expect(edgeTypes.switch).toBe(SwitchEdge);
  });

  it("has exactly three edge type entries", () => {
    expect(Object.keys(edgeTypes)).toHaveLength(3);
  });
});
