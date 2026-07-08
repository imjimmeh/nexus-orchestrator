import { SetMetadata } from '@nestjs/common';
import type { RuntimeCapabilityDefinition } from './runtime-capability.types';

export {
  CAPABILITY_METADATA_KEY,
  Capability,
  getCapabilityMetadata,
} from './capability.decorator';

export const RUNTIME_CAPABILITY_METADATA_KEY = 'runtime-capability-definition';

export function RuntimeCapability(
  definition: RuntimeCapabilityDefinition,
): MethodDecorator {
  return SetMetadata(RUNTIME_CAPABILITY_METADATA_KEY, definition);
}

export function getRuntimeCapabilityMetadata(
  target: object,
  propertyKey: string,
): RuntimeCapabilityDefinition | undefined {
  const method = Reflect.get(target, propertyKey) as unknown;
  if (typeof method !== 'function') {
    return undefined;
  }

  return Reflect.getMetadata(RUNTIME_CAPABILITY_METADATA_KEY, method) as
    | RuntimeCapabilityDefinition
    | undefined;
}
