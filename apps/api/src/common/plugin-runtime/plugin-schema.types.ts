/**
 * Parameters for building a registry schema.
 */
export interface BuildRegistrySchemaParams<TNormalizedSchema> {
  /** The normalized input schema */
  schema: TNormalizedSchema;
  /** Optional description to apply to schema */
  description?: string | null;
  /** The x-nexus extension object to attach */
  nexusExtension: Record<string, unknown>;
}
