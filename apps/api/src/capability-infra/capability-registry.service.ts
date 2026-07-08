import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { DEFAULT_TS_SNIPPET } from './shared-capability-constants';
import { CapabilityManifestEntry } from './capability-manifest.types';
import { CAPABILITY_METADATA_KEY } from './capability.decorator';
import { DiscoveredCapabilityDefinition } from './capability-registry.types';
import { normalizeTierRestriction } from './runtime-capability.types';
import { zodSchemaToCapabilityJsonSchema } from './runtime-capability-schema.adapter';
import type { IInternalToolHandler } from '@nexus/core';

@Injectable()
export class CapabilityRegistryService implements OnModuleInit {
  private discoveredEntries: CapabilityManifestEntry[] = [];
  private discoveredBridgeActions = new Set<string>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onModuleInit() {
    this.discover();
  }

  private discover() {
    const providers = this.discovery.getProviders();
    const allEntries: CapabilityManifestEntry[] = [];
    const bridgeActions = new Set<string>();

    for (const wrapper of providers) {
      const instance: unknown = wrapper.instance;
      if (!this.isScannableInstance(instance)) {
        continue;
      }

      this.collectMethodMetadata(instance, allEntries, bridgeActions);
      this.collectClassMetadata(instance, allEntries, bridgeActions);
      this.collectInternalToolHandler(instance, allEntries);
    }

    // Deduplicate by name — first registration wins. This lets @Capability stubs
    // and IInternalToolHandler coexist during migration; the stubs will be
    // removed in a follow-up cleanup.
    const seenNames = new Set<string>();
    const dedupedEntries: CapabilityManifestEntry[] = [];
    for (const entry of allEntries) {
      if (!seenNames.has(entry.name)) {
        seenNames.add(entry.name);
        dedupedEntries.push(entry);
      }
    }

    dedupedEntries.sort((a, b) => a.name.localeCompare(b.name));

    this.discoveredEntries = dedupedEntries;
    this.discoveredBridgeActions = bridgeActions;
  }

  private isScannableInstance(
    value: unknown,
  ): value is Record<string, unknown> {
    return (
      !!value && (typeof value === 'object' || typeof value === 'function')
    );
  }

  private readCapabilityMetadata(
    target: unknown,
  ): DiscoveredCapabilityDefinition | undefined {
    if (
      target === null ||
      (typeof target !== 'object' && typeof target !== 'function')
    ) {
      return undefined;
    }

    const metadata: unknown = Reflect.getMetadata(
      CAPABILITY_METADATA_KEY,
      target,
    );
    if (!metadata || typeof metadata !== 'object') {
      return undefined;
    }
    return metadata as DiscoveredCapabilityDefinition;
  }

  private appendDiscoveredCapability(
    metadata: DiscoveredCapabilityDefinition | undefined,
    entries: CapabilityManifestEntry[],
    bridgeActions: Set<string>,
  ): void {
    if (!metadata) {
      return;
    }

    const entry = this.buildEntry(metadata);
    entries.push(entry);
    if (metadata.bridgeAction) {
      bridgeActions.add(metadata.bridgeAction);
    }
  }

  private collectMethodMetadata(
    instance: Record<string, unknown>,
    entries: CapabilityManifestEntry[],
    bridgeActions: Set<string>,
  ): void {
    const methodNames = this.metadataScanner.getAllMethodNames(instance);
    for (const methodName of methodNames) {
      const methodValue: unknown = instance[methodName];
      if (typeof methodValue !== 'function') {
        continue;
      }
      this.appendDiscoveredCapability(
        this.readCapabilityMetadata(methodValue),
        entries,
        bridgeActions,
      );
    }
  }

  private collectClassMetadata(
    instance: Record<string, unknown>,
    entries: CapabilityManifestEntry[],
    bridgeActions: Set<string>,
  ): void {
    const constructorRef: unknown = instance.constructor;
    this.appendDiscoveredCapability(
      this.readCapabilityMetadata(constructorRef),
      entries,
      bridgeActions,
    );
  }

  private collectInternalToolHandler(
    instance: Record<string, unknown>,
    entries: CapabilityManifestEntry[],
  ): void {
    if (!this.isInternalToolHandler(instance)) return;
    const definition = instance.getDefinition();
    const normalized: DiscoveredCapabilityDefinition = {
      ...definition,
      description: definition.description ?? '',
      mutatingAction: definition.mutatingAction as
        | DiscoveredCapabilityDefinition['mutatingAction']
        | undefined,
      policyTags: (definition.policyTags ??
        []) as DiscoveredCapabilityDefinition['policyTags'],
      tierRestriction: normalizeTierRestriction(definition.tierRestriction),
    };
    entries.push(this.buildEntry(normalized));
  }

  private isInternalToolHandler(
    instance: Record<string, unknown>,
  ): instance is Record<string, unknown> & IInternalToolHandler {
    return (
      typeof instance.getName === 'function' &&
      typeof instance.getDefinition === 'function'
    );
  }

  private buildEntry(
    definition: DiscoveredCapabilityDefinition,
  ): CapabilityManifestEntry {
    return {
      name: definition.name,
      tierRestriction: definition.tierRestriction,
      schema: zodSchemaToCapabilityJsonSchema(definition.inputSchema),
      transport: definition.transport,
      policyTags: definition.policyTags,
      description: definition.description,
      typescriptCode: DEFAULT_TS_SNIPPET,
      apiCallback: definition.apiCallback,
      bridgeAction: definition.bridgeAction,
      runtimeOwner: definition.runtimeOwner,
      seedInRegistry: definition.seedInRegistry,
      mutatingAction: definition.mutatingAction,
      modeBehavior:
        definition.modeBehavior as CapabilityManifestEntry['modeBehavior'],
    };
  }

  getDiscoveredEntries(): CapabilityManifestEntry[] {
    return this.discoveredEntries;
  }

  getDiscoveredBridgeActions(): Set<string> {
    return this.discoveredBridgeActions;
  }

  getDiscoveredEntryByName(name: string): CapabilityManifestEntry | undefined {
    return this.discoveredEntries.find((e) => e.name === name);
  }

  getSeededCapabilityEntries(): CapabilityManifestEntry[] {
    return this.discoveredEntries.filter(
      (entry) => entry.seedInRegistry !== false,
    );
  }
}
