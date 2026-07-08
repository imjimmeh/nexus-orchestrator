import { Injectable } from '@nestjs/common';
import type { ConfigObjectType } from './config-resolution.constants';
import type { EffectiveConfig } from './effective-config.types';

const TTL_MS = 60_000;

interface Entry<T> {
  value: EffectiveConfig<T>;
  expiresAt: number;
}

@Injectable()
export class ConfigResolutionCache {
  private readonly store = new Map<string, Entry<unknown>>();

  private key(
    objectType: ConfigObjectType,
    name: string,
    scopeNodeId: string,
  ): string {
    return `${objectType}::${name}::${scopeNodeId}`;
  }

  get<T>(
    objectType: ConfigObjectType,
    name: string,
    scopeNodeId: string,
  ): EffectiveConfig<T> | undefined {
    const k = this.key(objectType, name, scopeNodeId);
    const entry = this.store.get(k);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(k);
      return undefined;
    }
    return entry.value as EffectiveConfig<T>;
  }

  set<T>(
    objectType: ConfigObjectType,
    name: string,
    scopeNodeId: string,
    value: EffectiveConfig<T>,
  ): void {
    this.store.set(this.key(objectType, name, scopeNodeId), {
      value: value,
      expiresAt: Date.now() + TTL_MS,
    });
  }

  invalidate(objectType: ConfigObjectType, name: string): void {
    const prefix = `${objectType}::${name}::`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }
}
