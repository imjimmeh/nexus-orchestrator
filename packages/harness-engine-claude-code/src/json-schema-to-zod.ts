import { z } from "zod";

/**
 * Converts a JSON Schema (the shape mounted tools carry in `parameters`) into a
 * Zod schema.
 *
 * The Claude Agent SDK's `tool()` / `createSdkMcpServer()` reject a raw JSON
 * Schema object ("inputSchema must be a Zod schema or raw shape") — they accept
 * only a Zod schema, which the SDK then re-derives a JSON Schema from for the
 * model. PI consumes the JSON Schema directly, so the mounted tools store JSON
 * Schema; this bridges that to the SDK's requirement.
 *
 * Objects are mapped to LOOSE objects so caller-supplied keys are never silently
 * stripped before reaching the tool handler (the API still validates params
 * against the authoritative JSON Schema server-side). Unrecognized constructs
 * fall back to `z.any()` rather than over-constraining a valid call.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodType {
  if (!isRecord(schema)) {
    return z.any();
  }

  const variants = schema["anyOf"] ?? schema["oneOf"];
  if (Array.isArray(variants) && variants.length > 0) {
    return withDescription(unionOf(variants.map(jsonSchemaToZod)), schema);
  }

  if (Array.isArray(schema["enum"]) && schema["enum"].length > 0) {
    return withDescription(
      unionOf(schema["enum"].map((value) => z.literal(value as never))),
      schema,
    );
  }

  return withDescription(fromType(schema), schema);
}

function fromType(schema: Record<string, unknown>): z.ZodType {
  const type = schema["type"];

  if (Array.isArray(type)) {
    const nonNull = type.filter((entry) => entry !== "null");
    const base = unionOf(
      nonNull.map((entry) => fromType({ ...schema, type: entry })),
    );
    return type.includes("null") ? base.nullable() : base;
  }

  switch (type) {
    case "object":
      return objectFromSchema(schema);
    case "array":
      return z.array(jsonSchemaToZod(schema["items"]));
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    default:
      return z.any();
  }
}

function objectFromSchema(schema: Record<string, unknown>): z.ZodType {
  const properties = schema["properties"];
  if (!isRecord(properties)) {
    return z.looseObject({});
  }

  const required = new Set(
    Array.isArray(schema["required"])
      ? schema["required"].filter(
          (name): name is string => typeof name === "string",
        )
      : [],
  );

  const shape: Record<string, z.ZodType> = {};
  for (const [key, value] of Object.entries(properties)) {
    const field = jsonSchemaToZod(value);
    shape[key] = required.has(key) ? field : field.optional();
  }

  return z.looseObject(shape);
}

function unionOf(schemas: z.ZodType[]): z.ZodType {
  if (schemas.length === 0) {
    return z.any();
  }
  if (schemas.length === 1) {
    return schemas[0];
  }
  return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function withDescription(
  zodSchema: z.ZodType,
  jsonSchema: Record<string, unknown>,
): z.ZodType {
  const description = jsonSchema["description"];
  return typeof description === "string"
    ? zodSchema.describe(description)
    : zodSchema;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
