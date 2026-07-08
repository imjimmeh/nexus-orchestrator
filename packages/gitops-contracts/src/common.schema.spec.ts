import { describe, it, expect } from "vitest";
import { ScopePathSchema, GITOPS_API_VERSION } from "./common.schema";

describe("gitops common schema", () => {
  it('accepts the platform root path "/"', () => {
    expect(ScopePathSchema.parse("/")).toBe("/");
  });
  it("accepts a nested slug path", () => {
    expect(ScopePathSchema.parse("/acme/emea/platform-team")).toBe(
      "/acme/emea/platform-team",
    );
  });
  it("rejects a path with empty or invalid slug segments", () => {
    expect(ScopePathSchema.safeParse("/acme//team").success).toBe(false);
    expect(ScopePathSchema.safeParse("/Acme").success).toBe(false);
    expect(ScopePathSchema.safeParse("acme/team").success).toBe(false);
  });
  it("exposes a stable apiVersion constant", () => {
    expect(GITOPS_API_VERSION).toBe("nexus.gitops/v1");
  });
});
