import { describe, expect, it } from "vitest";
import { AuditLogEntrySchema, AuditLogResponseSchema } from "./audit.schema";

const VALID_ENTRY = {
  id: "11111111-1111-1111-8111-111111111111",
  eventType: "authz.denied",
  userId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userEmail: "user@example.com",
  scopeNodeId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  scopeNodeName: "Root",
  metadata: { requiredPermission: "audit:read" },
  createdAt: "2026-06-01T10:00:00.000Z",
};

describe("AuditLogEntrySchema", () => {
  it("parses a valid entry", () => {
    const result = AuditLogEntrySchema.parse(VALID_ENTRY);
    expect(result.eventType).toBe("authz.denied");
    expect(result.createdAt).toBe("2026-06-01T10:00:00.000Z");
  });

  it("allows null scopeNodeId and scopeNodeName", () => {
    const result = AuditLogEntrySchema.parse({
      ...VALID_ENTRY,
      scopeNodeId: null,
      scopeNodeName: null,
    });
    expect(result.scopeNodeId).toBeNull();
    expect(result.scopeNodeName).toBeNull();
  });

  it("accepts optional fields targetUserEmail, roleName, inheritedBy", () => {
    const result = AuditLogEntrySchema.parse({
      ...VALID_ENTRY,
      targetUserEmail: "target@example.com",
      roleName: "admin",
      inheritedBy: ["child-scope-id"],
    });
    expect(result.targetUserEmail).toBe("target@example.com");
    expect(result.roleName).toBe("admin");
    expect(result.inheritedBy).toEqual(["child-scope-id"]);
  });

  it("parses entry without optional fields", () => {
    const result = AuditLogEntrySchema.parse(VALID_ENTRY);
    expect(result.targetUserEmail).toBeUndefined();
    expect(result.roleName).toBeUndefined();
    expect(result.inheritedBy).toBeUndefined();
  });

  it("rejects a missing id", () => {
    const { id: _id, ...withoutId } = VALID_ENTRY;
    expect(() => AuditLogEntrySchema.parse(withoutId)).toThrow();
  });

  it("rejects a non-datetime createdAt", () => {
    expect(() =>
      AuditLogEntrySchema.parse({ ...VALID_ENTRY, createdAt: "not-a-date" }),
    ).toThrow();
  });
});

describe("AuditLogResponseSchema", () => {
  it("parses a valid paginated response", () => {
    const result = AuditLogResponseSchema.parse({
      entries: [VALID_ENTRY],
      total: 1,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("accepts an empty entries array", () => {
    const result = AuditLogResponseSchema.parse({ entries: [], total: 0 });
    expect(result.entries).toHaveLength(0);
  });

  it("rejects a negative total", () => {
    expect(() =>
      AuditLogResponseSchema.parse({ entries: [], total: -1 }),
    ).toThrow();
  });
});
