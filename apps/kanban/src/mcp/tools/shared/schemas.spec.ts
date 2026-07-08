import { describe, expect, it } from "vitest";
import { z } from "zod";
import { xmlArrayArtifact } from "./schemas";

describe("xmlArrayArtifact", () => {
  const schema = xmlArrayArtifact(z.string().min(1));

  it("coerces a single-element XML artifact { item: <primitive> } into an array", () => {
    const parsed = schema.safeParse({ item: "AC-1" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1"]);
    }
  });

  it("coerces a multi-element XML artifact { item: [...] } into the array", () => {
    const parsed = schema.safeParse({ item: ["AC-1", "AC-2"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1", "AC-2"]);
    }
  });

  it("passes a plain array through unchanged", () => {
    const parsed = schema.safeParse(["AC-1", "AC-2", "AC-3"]);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual(["AC-1", "AC-2", "AC-3"]);
    }
  });

  it("does NOT unwrap a multi-key object (not the sole-key artifact shape)", () => {
    const parsed = schema.safeParse({ item: "AC-1", total: 1 });
    expect(parsed.success).toBe(false);
  });

  it("validates element constraints after coercion", () => {
    const parsed = schema.safeParse({ item: "" });
    expect(parsed.success).toBe(false);
  });

  it("works with object element schemas", () => {
    const objectSchema = xmlArrayArtifact(z.object({ ac_id: z.string() }));
    const parsed = objectSchema.safeParse({ item: { ac_id: "AC-1" } });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual([{ ac_id: "AC-1" }]);
    }
  });
});
