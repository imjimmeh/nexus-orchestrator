import type { ConfigObjectType } from './config-resolution.constants.types';
import type { ConfigLayerRecord } from './effective-config.types';

export interface ScopedConfigSource<T> {
  readonly objectType: ConfigObjectType;
  loadCandidates(
    name: string,
    scopeIds: string[],
  ): Promise<Array<ConfigLayerRecord<T>>>;
}
