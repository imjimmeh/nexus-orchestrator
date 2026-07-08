export function stripJsonSchemaMeta(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };
  delete result.$schema;
  const { definitions } = result;
  if (
    definitions &&
    typeof definitions === "object" &&
    !Array.isArray(definitions) &&
    Object.keys(definitions).length === 0
  ) {
    delete result.definitions;
  }
  return result;
}
