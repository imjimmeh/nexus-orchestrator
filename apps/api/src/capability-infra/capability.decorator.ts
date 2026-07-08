import { SetMetadata } from '@nestjs/common';
import { DiscoveredCapabilityDefinition } from './capability-registry.types';

export const CAPABILITY_METADATA_KEY = Symbol('CAPABILITY_METADATA_KEY');

export function Capability(definition: DiscoveredCapabilityDefinition) {
  return SetMetadata(CAPABILITY_METADATA_KEY, definition);
}

export function getCapabilityMetadata(
  target: object,
  propertyKey?: string | symbol,
): DiscoveredCapabilityDefinition | undefined {
  const metadata: unknown = propertyKey
    ? Reflect.getMetadata(CAPABILITY_METADATA_KEY, target, propertyKey)
    : Reflect.getMetadata(CAPABILITY_METADATA_KEY, target);

  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }

  if (propertyKey) {
    return metadata as DiscoveredCapabilityDefinition;
  }
  return metadata as DiscoveredCapabilityDefinition;
}
