import { Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
  type HarnessId,
  type HarnessCapabilities,
} from '@nexus/core';
import type { HarnessProviderEntry } from './harness-provider-registry.types';
import { validateOrFallback } from './harness-selection';
import type { HarnessDefinitionRepository } from './harness-definition.repository.js';

@Injectable()
export class HarnessProviderRegistryService implements OnModuleInit {
  constructor(
    @Optional() private readonly definitionRepo?: HarnessDefinitionRepository,
  ) {}

  private readonly builtins: Map<HarnessId, HarnessProviderEntry> = new Map<
    HarnessId,
    HarnessProviderEntry
  >([
    [
      'pi',
      {
        harnessId: 'pi',
        displayName: 'PI',
        capabilities: PI_CAPABILITIES,
        imageRef: process.env.HARNESS_IMAGE_PI ?? 'nexus/harness-pi:latest',
        defaultEnv: {},
        transport: 'kernel' as const,
        source: 'builtin' as const,
        enabled: true,
      },
    ],
    [
      'claude-code',
      {
        harnessId: 'claude-code',
        displayName: 'Claude Code',
        capabilities: CLAUDE_CODE_CAPABILITIES,
        imageRef:
          process.env.HARNESS_IMAGE_CLAUDE_CODE ??
          'nexus/harness-claude-code:latest',
        defaultEnv: { DISABLE_AUTOUPDATER: '1' },
        transport: 'kernel' as const,
        source: 'builtin' as const,
        enabled: true,
      },
    ],
  ]);

  async onModuleInit(): Promise<void> {
    await this.loadCustomDefinitions();
  }

  resolve(harnessId: HarnessId): HarnessProviderEntry {
    const e = this.builtins.get(harnessId);
    if (!e) throw new Error(`Harness ${harnessId} not registered`);
    return e;
  }

  list(): HarnessProviderEntry[] {
    return [...this.builtins.values()].filter((e) => e.enabled);
  }

  /**
   * Resolves a session ref's `kind` to a harness ID and returns its capabilities.
   * Handles the `claude_code` → `claude-code` mapping needed because
   * `HarnessSessionRef.kind` uses underscores while `HarnessId` uses hyphens.
   */
  getCapabilitiesForRef(ref: { kind: string }): HarnessCapabilities {
    const harnessId: HarnessId =
      ref.kind === 'claude_code' ? 'claude-code' : (ref.kind as HarnessId);
    return this.resolve(harnessId).capabilities;
  }

  validateForStep(
    harnessId: HarnessId,
    required: Partial<HarnessCapabilities>,
    platformDefault: HarnessId = 'pi',
  ): { harnessId: HarnessId; fallbackReason?: string } {
    const caps = this.resolve(harnessId).capabilities;
    return validateOrFallback(caps, required, harnessId, platformDefault);
  }

  /** Loads custom harness definitions from the DB into the in-memory registry. */
  async loadCustomDefinitions(): Promise<void> {
    if (!this.definitionRepo) return;
    const customs = await this.definitionRepo.find();
    for (const def of customs) {
      if (!def.enabled) continue;
      this.builtins.set(def.harnessId as HarnessId, {
        harnessId: def.harnessId as HarnessId,
        displayName: def.displayName,
        capabilities: def.capabilities,
        imageRef: def.imageRef,
        defaultEnv: def.defaultEnv,
        transport: def.transport,
        source: 'custom',
        enabled: def.enabled,
      });
    }
  }
}
