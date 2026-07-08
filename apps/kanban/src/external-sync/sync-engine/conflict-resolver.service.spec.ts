import { describe, expect, it } from "vitest";
import { ConflictResolverService } from "./conflict-resolver.service.js";
import type { ConflictCheckInput } from "./conflict-resolver.types.js";

describe("ConflictResolverService", () => {
  const resolver = new ConflictResolverService();

  const baseInput: ConflictCheckInput = {
    externalUpdatedAt: "2026-06-02T12:00:00.000Z",
    workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
    externalId: "EXT-1",
    workItemId: "WI-1",
  };

  describe("resolveExternalUpdate", () => {
    it("returns apply_external when external is newer than the work item", () => {
      const result = resolver.resolveExternalUpdate({
        ...baseInput,
        externalUpdatedAt: "2026-06-02T12:00:00.000Z",
        workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
      });

      expect(result.decision).toBe("apply_external");
      expect(result.reason).toBeDefined();
      expect(result.details.externalId).toBe("EXT-1");
      expect(result.details.workItemId).toBe("WI-1");
      expect(result.details.externalUpdatedAt).toBe("2026-06-02T12:00:00.000Z");
      expect(result.details.workItemUpdatedAt).toBe("2026-06-01T12:00:00.000Z");
    });

    it("returns skip_external when the work item is newer than external", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: "2026-06-01T12:00:00.000Z",
        workItemUpdatedAt: "2026-06-02T12:00:00.000Z",
        externalId: "EXT-2",
        workItemId: "WI-2",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.reason).toBeDefined();
      expect(result.details.externalId).toBe("EXT-2");
      expect(result.details.workItemId).toBe("WI-2");
    });

    it("returns noop when timestamps are equal", () => {
      const sameTime = "2026-06-02T00:00:00.000Z";

      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: sameTime,
        workItemUpdatedAt: sameTime,
        externalId: "EXT-3",
        workItemId: "WI-3",
      });

      expect(result.decision).toBe("noop");
      expect(result.reason).toBeDefined();
      expect(result.details.externalId).toBe("EXT-3");
    });

    it("returns skip_external when externalUpdatedAt is null", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: null,
        workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
        externalId: "EXT-4",
        workItemId: "WI-4",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.reason).toContain("missing");
      expect(result.details.externalUpdatedAt).toBeNull();
    });

    it("returns skip_external when externalUpdatedAt is undefined", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: undefined,
        workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
        externalId: "EXT-5",
        workItemId: "WI-5",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.details.externalUpdatedAt).toBeNull();
    });

    it("returns skip_external when externalUpdatedAt is an invalid date string", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: "not-a-date",
        workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
        externalId: "EXT-6",
        workItemId: "WI-6",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.reason).toContain("invalid");
      expect(result.details.externalUpdatedAt).toBe("not-a-date");
    });

    it("returns skip_external when externalUpdatedAt is an empty string", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: "",
        workItemUpdatedAt: "2026-06-01T12:00:00.000Z",
        externalId: "EXT-7",
        workItemId: "WI-7",
      });

      expect(result.decision).toBe("skip_external");
    });

    it("returns skip_external when workItemUpdatedAt is invalid as a safety measure", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: "2026-06-02T12:00:00.000Z",
        workItemUpdatedAt: "garbage",
        externalId: "EXT-8",
        workItemId: "WI-8",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.reason).toContain("invalid");
    });

    it("reports conflict reason with enough detail for sync operation logging", () => {
      const result = resolver.resolveExternalUpdate({
        externalUpdatedAt: "2026-06-01T12:00:00.000Z",
        workItemUpdatedAt: "2026-06-02T12:00:00.000Z",
        externalId: "EXT-CONFLICT",
        workItemId: "WI-CONFLICT",
      });

      expect(result.decision).toBe("skip_external");
      expect(result.reason).toBeDefined();
      expect(result.reason.length).toBeGreaterThan(0);
      expect(result.details.externalId).toBe("EXT-CONFLICT");
      expect(result.details.workItemId).toBe("WI-CONFLICT");
      expect(result.details.externalUpdatedAt).toBeDefined();
      expect(result.details.workItemUpdatedAt).toBeDefined();
    });
  });
});
