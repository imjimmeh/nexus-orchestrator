import { describe, expect, it } from "vitest";
import { isContainerCandidate } from "./dispatch-container.helper";

const base = { id: "x", status: "todo" } as never;

describe("isContainerCandidate", () => {
  it("treats an epic as a container", () => {
    expect(isContainerCandidate({ ...base, type: "epic" }, new Set())).toBe(
      true,
    );
  });
  it("treats a childless story as dispatchable", () => {
    expect(isContainerCandidate({ ...base, type: "story" }, new Set())).toBe(
      false,
    );
  });
  it("treats a story WITH children as a container", () => {
    expect(
      isContainerCandidate({ ...base, id: "s", type: "story" }, new Set(["s"])),
    ).toBe(true);
  });
});
