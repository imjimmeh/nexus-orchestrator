import { describe, it, expect } from "vitest";
import { ScopeNodeDocSchema, ScopeNodeTypeSchema } from "./scope.schema";

describe("ScopeNodeDocSchema", () => {
  it("declares the canonical node types from 204A", () => {
    expect(ScopeNodeTypeSchema.options).toEqual([
      "platform",
      "org",
      "region",
      "team",
      "project",
    ]);
  });
  it("parses a valid org node doc", () => {
    const doc = ScopeNodeDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "ScopeNode",
      type: "org",
      name: "Acme",
      slug: "acme",
      metadata: { tier: "enterprise" },
    });
    expect(doc.slug).toBe("acme");
    expect(doc.metadata).toEqual({ tier: "enterprise" });
  });
  it("defaults metadata to null and id to undefined when omitted", () => {
    const doc = ScopeNodeDocSchema.parse({
      apiVersion: "nexus.gitops/v1",
      kind: "ScopeNode",
      type: "team",
      name: "Platform",
      slug: "platform-team",
    });
    expect(doc.metadata).toBeNull();
    expect(doc.id).toBeUndefined();
  });
  it("rejects an unknown node type", () => {
    expect(
      ScopeNodeDocSchema.safeParse({
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "galaxy",
        name: "X",
        slug: "x",
      }).success,
    ).toBe(false);
  });
  it("rejects a non-slug slug", () => {
    expect(
      ScopeNodeDocSchema.safeParse({
        apiVersion: "nexus.gitops/v1",
        kind: "ScopeNode",
        type: "org",
        name: "Bad",
        slug: "Not A Slug",
      }).success,
    ).toBe(false);
  });
});
