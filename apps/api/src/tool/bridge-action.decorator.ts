import { SetMetadata } from '@nestjs/common';
import { BridgeActionMetadata, BridgeHandlerType } from './bridge-action.types';
export { BridgeHandlerType } from './bridge-action.types';

export const BRIDGE_ACTION_METADATA_KEY = Symbol('BRIDGE_ACTION_METADATA_KEY');
export const BRIDGE_HANDLER_TYPE = Symbol('BRIDGE_HANDLER_TYPE');

export function BridgeActionHandler(type: BridgeHandlerType, action: string) {
  const metadata: BridgeActionMetadata = { type, action };
  return SetMetadata(BRIDGE_ACTION_METADATA_KEY, metadata);
}

export function getBridgeActionMetadata(
  target: object,
): BridgeActionMetadata[] {
  const metadata: unknown = Reflect.getMetadata(
    BRIDGE_ACTION_METADATA_KEY,
    target,
  );
  return Array.isArray(metadata) ? (metadata as BridgeActionMetadata[]) : [];
}
