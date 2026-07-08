import type { IToolRegistry } from '@nexus/core';
import type { CanonicalCapabilityDefinition } from './canonical-capability.types';

export function mapCapabilityEntryToToolRegistryPayload(
  entry: CanonicalCapabilityDefinition,
): Partial<IToolRegistry> {
  return {
    name: entry.name,
    schema: entry.schema,
    typescript_code: entry.typescriptCode,
    tier_restriction: entry.tierRestriction,
    transport: entry.transport,
    runtime_owner: entry.runtimeOwner,
    source: entry.source,
    api_callback: entry.apiCallback
      ? {
          method: entry.apiCallback.method,
          path_template: entry.apiCallback.pathTemplate,
          body_mapping: entry.apiCallback.bodyMapping,
        }
      : undefined,
  };
}
