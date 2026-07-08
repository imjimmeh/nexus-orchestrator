// apps/api/src/capability-infra/capability-registry.service.spec.ts
import { Test } from '@nestjs/testing';
import { DiscoveryModule, MetadataScanner } from '@nestjs/core';
import { Injectable, Type } from '@nestjs/common';
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { CapabilityRegistryService } from './capability-registry.service';
import { Capability } from './capability.decorator';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

@Injectable()
class AutoToolA implements IInternalToolHandler {
  getName() {
    return 'auto_tool_a';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'auto_tool_a',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only'],
      description: 'Auto-discovered tool A',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/auto-a',
        bodyMapping: { foo: 'foo' },
      },
      inputSchema: z.object({ foo: z.string() }),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

@Injectable()
class AutoToolB implements IInternalToolHandler {
  getName() {
    return 'auto_tool_b';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'auto_tool_b',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      description: 'Auto-discovered tool B',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/auto-b',
        bodyMapping: {},
      },
      inputSchema: z.object({}),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

// A provider that has both a @Capability stub AND an IInternalToolHandler —
// used to verify deduplication.
@Injectable()
class DualRegistrationTool implements IInternalToolHandler {
  getName() {
    return 'dual_tool';
  }
  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: 'dual_tool',
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      description: 'Dual-registered tool',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/test/dual',
        bodyMapping: {},
      },
      inputSchema: z.object({}),
    };
  }
  execute(_ctx: InternalToolExecutionContext, _params: unknown) {
    return Promise.resolve({});
  }
}

class DualStubProvider {
  @Capability({
    name: 'dual_tool',
    tierRestriction: 1,
    transport: 'api_callback',
    runtimeOwner: 'api',
    policyTags: [],
    description: 'Dual-registered tool',
    apiCallback: {
      method: 'POST',
      pathTemplate: '/api/test/dual',
      bodyMapping: {},
    },
    inputSchema: z.object({}),
  })
  dualTool() {
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildRegistry(
  extraProviders: Type<unknown>[],
): Promise<CapabilityRegistryService> {
  const module = await Test.createTestingModule({
    imports: [DiscoveryModule],
    providers: [CapabilityRegistryService, MetadataScanner, ...extraProviders],
  }).compile();

  await module.init(); // triggers OnModuleInit → discover()
  return module.get(CapabilityRegistryService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CapabilityRegistryService', () => {
  describe('IInternalToolHandler auto-discovery', () => {
    it('discovers a capability from getDefinition() without a @Capability stub', async () => {
      const registry = await buildRegistry([AutoToolA]);

      const names = registry.getDiscoveredEntries().map((e) => e.name);
      expect(names).toContain('auto_tool_a');
    });

    it('populates all manifest fields from getDefinition()', async () => {
      const registry = await buildRegistry([AutoToolA]);

      const entry = registry.getDiscoveredEntryByName('auto_tool_a');
      expect(entry).toBeDefined();
      expect(entry?.transport).toBe('api_callback');
      expect(entry?.runtimeOwner).toBe('api');
      expect(entry?.description).toBe('Auto-discovered tool A');
      expect(entry?.apiCallback?.pathTemplate).toBe('/api/test/auto-a');
    });

    it('discovers multiple IInternalToolHandler providers', async () => {
      const registry = await buildRegistry([AutoToolA, AutoToolB]);

      const names = registry.getDiscoveredEntries().map((e) => e.name);
      expect(names).toContain('auto_tool_a');
      expect(names).toContain('auto_tool_b');
    });

    it('deduplicates when @Capability stub and IInternalToolHandler share a name', async () => {
      const registry = await buildRegistry([
        DualRegistrationTool,
        DualStubProvider,
      ]);

      const entries = registry
        .getDiscoveredEntries()
        .filter((e) => e.name === 'dual_tool');
      expect(entries).toHaveLength(1);
    });
  });
});
