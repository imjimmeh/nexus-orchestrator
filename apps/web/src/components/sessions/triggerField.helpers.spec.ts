import { describe, expect, it } from "vitest";
import { resolveTriggerField } from "./triggerField.helpers";

// Aliases mirror the keys `SessionConversationPane.data.ts` reads inline today.
// Keeping them realistic makes the spec useful as documentation for callers.
const WORKFLOW_NAME_ALIASES = [
  "displayName",
  "display_name",
  "workflowName",
  "workflow_name",
] as const;

describe("resolveTriggerField", () => {
  it("returns undefined when trigger is null", () => {
    expect(
      resolveTriggerField(null, WORKFLOW_NAME_ALIASES),
    ).toBeUndefined();
  });

  it("returns undefined when trigger is undefined", () => {
    expect(
      resolveTriggerField(undefined, WORKFLOW_NAME_ALIASES),
    ).toBeUndefined();
  });

  it("returns undefined when no aliases are provided", () => {
    expect(
      resolveTriggerField({ displayName: "Has a name" }, []),
    ).toBeUndefined();
  });

  it("returns the first matching alias in the order given", () => {
    const trigger = {
      displayName: "Camel display",
      workflowName: "Camel workflow",
    };

    expect(
      resolveTriggerField(trigger, WORKFLOW_NAME_ALIASES),
    ).toBe("Camel display");

    // Reordering aliases must change which value is returned.
    const reversed = [
      "workflow_name",
      "workflowName",
      "display_name",
      "displayName",
    ] as const;
    expect(resolveTriggerField(trigger, reversed)).toBe("Camel workflow");
  });

  it("skips non-string values when looking up aliases", () => {
    const trigger = {
      displayName: 42,
      display_name: { nested: "object" },
      workflow_name: "snake_case_workflow",
    };

    expect(
      resolveTriggerField(trigger, WORKFLOW_NAME_ALIASES),
    ).toBe("snake_case_workflow");
  });

  it("skips empty-string values when looking up aliases", () => {
    const trigger = {
      displayName: "",
      workflowName: "real workflow",
    };

    // `displayName: ""` is empty and must be skipped, falling through to
    // `workflowName: "real workflow"`.
    expect(
      resolveTriggerField(trigger, WORKFLOW_NAME_ALIASES),
    ).toBe("real workflow");
  });

  it("ignores non-string displayName variants (number, boolean, object)", () => {
    const numberTrigger = { displayName: 7 };
    expect(
      resolveTriggerField(numberTrigger, ["displayName"]),
    ).toBeUndefined();

    const booleanTrigger = { displayName: true };
    expect(
      resolveTriggerField(booleanTrigger, ["displayName"]),
    ).toBeUndefined();

    const objectTrigger = {
      displayName: { toString: () => "looks like a string" },
    };
    expect(
      resolveTriggerField(objectTrigger, ["displayName"]),
    ).toBeUndefined();
  });

  it("does not mutate the caller's aliases array", () => {
    // The helper declares `aliases` as `readonly string[]` so callers can pass
    // an `as const` tuple or any frozen array. To verify the helper does not
    // mutate the caller's array, capture a snapshot before calling and
    // compare after — and confirm a second invocation with the same input
    // still returns the same answer (i.e. the helper does not retain state
    // from the first call that would be observable later).
    const aliases = ["displayName", "workflow_name"] as const;
    const snapshot = [...aliases];

    const firstResult = resolveTriggerField(
      { displayName: "first call" },
      aliases,
    );

    const secondResult = resolveTriggerField(
      { displayName: "second call" },
      aliases,
    );

    expect(firstResult).toBe("first call");
    expect(secondResult).toBe("second call");
    expect(aliases).toEqual(snapshot);
    expect(aliases).toHaveLength(snapshot.length);
  });

  it("returns undefined when the trigger has none of the requested aliases", () => {
    expect(
      resolveTriggerField(
        { unrelatedKey: "value" },
        WORKFLOW_NAME_ALIASES,
      ),
    ).toBeUndefined();
  });
});