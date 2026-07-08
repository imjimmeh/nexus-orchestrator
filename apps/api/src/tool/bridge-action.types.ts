export enum BridgeHandlerType {
  RUNNER = 'runner',
  TELEMETRY = 'telemetry',
}

export interface BridgeActionMetadata {
  type: BridgeHandlerType;
  action: string;
}
