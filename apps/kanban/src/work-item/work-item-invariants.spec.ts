import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertWorkItemInvariants } from "./work-item-invariants";

describe("assertWorkItemInvariants", () => {
  it("passes a standalone story with valid points", () => {
    expect(() =>
      { assertWorkItemInvariants({
        type: "story",
        storyPoints: 5,
        parentType: null,
      }); },
    ).not.toThrow();
  });

  it("rejects points on an epic", () => {
    expect(() =>
      { assertWorkItemInvariants({
        type: "epic",
        storyPoints: 3,
        parentType: null,
      }); },
    ).toThrow(BadRequestException);
  });

  it("rejects an epic with a parent", () => {
    expect(() =>
      { assertWorkItemInvariants({ type: "epic", parentType: "epic" }); },
    ).toThrow(BadRequestException);
  });

  it("rejects a disallowed parent/child pairing", () => {
    expect(() =>
      { assertWorkItemInvariants({ type: "task", parentType: "task" }); },
    ).toThrow(BadRequestException);
    expect(() =>
      { assertWorkItemInvariants({ type: "story", parentType: "story" }); },
    ).toThrow(BadRequestException);
  });

  it("rejects non-Fibonacci points", () => {
    expect(() =>
      { assertWorkItemInvariants({
        type: "task",
        storyPoints: 4,
        parentType: null,
      }); },
    ).toThrow(BadRequestException);
  });
});
