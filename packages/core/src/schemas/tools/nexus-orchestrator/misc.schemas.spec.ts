import { describe, expect, it } from "vitest";
import { StepCompleteSchema } from "./misc.schemas.js";

describe("StepCompleteSchema", () => {
  it("accepts the API runtime step completion contract", () => {
    const input = {
      action: "step_complete",
      status: "completed",
      summary: "Milestone complete",
      reasoning: "Verification passed",
    };

    expect(StepCompleteSchema.parse(input)).toEqual(input);
  });

  it("rejects unsupported additional fields", () => {
    expect(() =>
      StepCompleteSchema.parse({
        action: "step_complete",
        summary: "Done",
        reason: "Use reasoning instead",
      }),
    ).toThrow();
  });
});
