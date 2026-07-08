import { describe, it, expect } from "vitest";
import { EffectiveMemberSchema } from "./effective-member.schema";

describe("EffectiveMemberSchema", () => {
  const base = {
    userId: "11111111-1111-4111-8111-111111111111",
    userEmail: "a@b.com",
    roleId: "22222222-2222-4222-8222-222222222222",
    roleName: "member",
    source: "direct" as const,
    sourceScopeNodeId: "33333333-3333-4333-8333-333333333333",
    sourceScopeName: "Acme",
  };

  it("accepts a direct member", () => {
    expect(EffectiveMemberSchema.parse(base)).toEqual(base);
  });

  it("accepts an inherited member", () => {
    expect(
      EffectiveMemberSchema.parse({ ...base, source: "inherited" }).source,
    ).toBe("inherited");
  });

  it("rejects an unknown source", () => {
    expect(() =>
      EffectiveMemberSchema.parse({ ...base, source: "other" }),
    ).toThrow();
  });
});
