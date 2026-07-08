import { describe, it, expect } from "vitest";
import { CreateAgentProfileSchema } from "./profiles.schema";
import { HarnessContributionsInputSchema } from "./harness-contributions.schema";

describe("agent profile thinking_level", () => {
  it("accepts a valid thinking_level and rejects an invalid one", () => {
    expect(
      CreateAgentProfileSchema.safeParse({ name: "p", thinking_level: "high" })
        .success,
    ).toBe(true);
    expect(
      CreateAgentProfileSchema.safeParse({ name: "p", thinking_level: "turbo" })
        .success,
    ).toBe(false);
  });

  it("accepts null thinking_level", () => {
    expect(
      CreateAgentProfileSchema.safeParse({ name: "p", thinking_level: null })
        .success,
    ).toBe(true);
  });

  it("accepts omitted thinking_level", () => {
    expect(CreateAgentProfileSchema.safeParse({ name: "p" }).success).toBe(
      true,
    );
  });
});

describe("agent profile harness_contributions", () => {
  it("accepts a partial contributions block on a profile", () => {
    const parsed = CreateAgentProfileSchema.parse({
      name: "p",
      harness_contributions: {
        hooks: [{ event: "session_start", command: "echo hi" }],
      },
    });
    expect(parsed.harness_contributions?.hooks?.[0].command).toBe("echo hi");
  });

  it("input schema allows any subset (no required arrays)", () => {
    expect(() => HarnessContributionsInputSchema.parse({})).not.toThrow();
    expect(() =>
      HarnessContributionsInputSchema.parse({
        settings: { outputStyle: "concise" },
      }),
    ).not.toThrow();
  });
});
