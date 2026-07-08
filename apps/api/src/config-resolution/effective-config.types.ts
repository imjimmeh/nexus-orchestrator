import type {
  ConfigObjectType,
  OverrideStrategy,
} from './config-resolution.constants';

export interface ConfigLayerRecord<T> {
  rowId: string;
  scopeNodeId: string | null;
  source: string;
  locked: boolean;
  strategy: OverrideStrategy;
  definition: T | null;
  overrides: Record<string, unknown> | null;
  baseRef: string | null;
}

export interface EffectiveConfig<T> {
  objectType: ConfigObjectType;
  name: string;
  scopeNodeId: string;
  value: T;
  contributingLayers: Array<
    Pick<ConfigLayerRecord<T>, 'rowId' | 'scopeNodeId' | 'source' | 'strategy'>
  >;
  isDefault: boolean;
  locked: boolean;
}
