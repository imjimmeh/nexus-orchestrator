import { toJSONSchema, type ZodType } from 'zod';

export function zodSchemaToCapabilityJsonSchema(
  schema: ZodType,
): Record<string, unknown> {
  const jsonSchema = toJSONSchema(schema, {
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  return removeEmptyDefinitions(stripSchemaDeclaration(jsonSchema));
}

function stripSchemaDeclaration(
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedSchema = { ...jsonSchema };
  delete normalizedSchema.$schema;
  return normalizedSchema;
}

function removeEmptyDefinitions(
  jsonSchema: Record<string, unknown>,
): Record<string, unknown> {
  const definitions = jsonSchema.definitions;

  if (
    definitions &&
    typeof definitions === 'object' &&
    !Array.isArray(definitions) &&
    Object.keys(definitions).length === 0
  ) {
    const normalizedSchema = { ...jsonSchema };
    delete normalizedSchema.definitions;
    return normalizedSchema;
  }

  return jsonSchema;
}
