import { describe, it, expect } from "vitest";
import { CreateModelSchema } from "./models.schema";

describe("model schema default_thinking_level", () => {
  it("accepts a valid default_thinking_level and rejects an invalid one", () => {
    expect(
      CreateModelSchema.safeParse({
        name: "gpt-4o",
        default_thinking_level: "high",
      }).success,
    ).toBe(true);
    expect(
      CreateModelSchema.safeParse({
        name: "gpt-4o",
        default_thinking_level: "turbo",
      }).success,
    ).toBe(false);
  });

  it("accepts null default_thinking_level", () => {
    expect(
      CreateModelSchema.safeParse({
        name: "gpt-4o",
        default_thinking_level: null,
      }).success,
    ).toBe(true);
  });

  it("accepts omitted default_thinking_level", () => {
    expect(CreateModelSchema.safeParse({ name: "gpt-4o" }).success).toBe(true);
  });
});
