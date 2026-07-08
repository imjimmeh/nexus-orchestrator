import { describe, it, expect } from "vitest";
import { jsonSchemaToZod } from "./json-schema-to-zod.js";

describe("jsonSchemaToZod", () => {
  it("produces a zod schema (duck-typed: has parse/safeParse)", () => {
    const schema = jsonSchemaToZod({ type: "object", properties: {} });
    expect(typeof (schema as { parse?: unknown }).parse).toBe("function");
    expect(typeof (schema as { safeParse?: unknown }).safeParse).toBe(
      "function",
    );
  });

  it("requires fields listed in `required` and accepts valid input", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        groomed_board_summary: { type: "string" },
        note: { type: "string" },
      },
      required: ["groomed_board_summary"],
    });

    expect(schema.safeParse({ groomed_board_summary: "done" }).success).toBe(
      true,
    );
    expect(schema.safeParse({ note: "only optional" }).success).toBe(false);
  });

  it("preserves unknown keys (loose objects) so no params are silently dropped", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a"],
    });

    const parsed = schema.parse({ a: "x", extra: 42 }) as Record<
      string,
      unknown
    >;
    expect(parsed["extra"]).toBe(42);
  });

  it("maps primitive types", () => {
    expect(jsonSchemaToZod({ type: "string" }).safeParse("s").success).toBe(
      true,
    );
    expect(jsonSchemaToZod({ type: "string" }).safeParse(1).success).toBe(
      false,
    );
    expect(jsonSchemaToZod({ type: "number" }).safeParse(1).success).toBe(true);
    expect(jsonSchemaToZod({ type: "integer" }).safeParse(3).success).toBe(
      true,
    );
    expect(jsonSchemaToZod({ type: "boolean" }).safeParse(true).success).toBe(
      true,
    );
  });

  it("maps enum to a constrained set", () => {
    const schema = jsonSchemaToZod({ enum: ["a", "b"] });
    expect(schema.safeParse("a").success).toBe(true);
    expect(schema.safeParse("c").success).toBe(false);
  });

  it("maps arrays with item schemas", () => {
    const schema = jsonSchemaToZod({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.safeParse(["a", "b"]).success).toBe(true);
    expect(schema.safeParse([1]).success).toBe(false);
  });

  it("maps nested object properties", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      required: ["meta"],
    });

    expect(schema.safeParse({ meta: { id: "x" } }).success).toBe(true);
    expect(schema.safeParse({ meta: {} }).success).toBe(false);
  });

  it("maps anyOf/oneOf to a union", () => {
    const schema = jsonSchemaToZod({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
    expect(schema.safeParse("s").success).toBe(true);
    expect(schema.safeParse(7).success).toBe(true);
    expect(schema.safeParse(true).success).toBe(false);
  });

  it("falls back to an accept-anything schema for unrecognized input", () => {
    const schema = jsonSchemaToZod({ weird: "schema" });
    expect(schema.safeParse({ anything: 1 }).success).toBe(true);
    expect(jsonSchemaToZod(undefined).safeParse("x").success).toBe(true);
  });
});
