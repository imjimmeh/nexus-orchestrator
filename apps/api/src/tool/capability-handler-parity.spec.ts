import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CAPABILITY_METADATA_KEY } from './capability.decorator';
import { OrchestrationSessionCapabilityProvider } from '../workflow/providers/orchestration-session-capability.provider';
import { DelegationCapabilityProvider } from '../workflow/providers/delegation-capability.provider';
import { WorkflowContextCapabilityProvider } from '../workflow/providers/workflow-context-capability.provider';
import { WorkflowManagementCapabilityProvider } from '../workflow/providers/workflow-management-capability.provider';
import { WorkflowRuntimeBrowserCapabilityProvider } from '../workflow/providers/workflow-runtime-browser-capability.provider';

const CAPABILITY_PROVIDERS = [
  DelegationCapabilityProvider,
  OrchestrationSessionCapabilityProvider,
  WorkflowContextCapabilityProvider,
  WorkflowManagementCapabilityProvider,
  WorkflowRuntimeBrowserCapabilityProvider,
];

function collectCapabilityNames(
  providerClasses: Array<new () => object>,
): Set<string> {
  const names = new Set<string>();
  for (const ProviderClass of providerClasses) {
    const proto = ProviderClass.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') {
        continue;
      }
      const method = proto[key];
      if (typeof method !== 'function') {
        continue;
      }
      const metadata = Reflect.getMetadata(CAPABILITY_METADATA_KEY, method) as
        | { name?: string }
        | undefined;
      if (metadata?.name) {
        names.add(metadata.name);
      }
    }
  }
  return names;
}

function collectApiCallbackPaths(
  providerClasses: Array<new () => object>,
): string[] {
  const paths: string[] = [];
  for (const ProviderClass of providerClasses) {
    const proto = ProviderClass.prototype as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') {
        continue;
      }
      const method = proto[key];
      if (typeof method !== 'function') {
        continue;
      }
      const metadata = Reflect.getMetadata(CAPABILITY_METADATA_KEY, method) as
        | { apiCallback?: { pathTemplate?: string } }
        | undefined;
      if (metadata?.apiCallback?.pathTemplate) {
        paths.push(metadata.apiCallback.pathTemplate);
      }
    }
  }
  return paths.sort();
}

describe('capability-handler parity', () => {
  it('does not declare external runtime capabilities inside the API workflow providers', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          'src/workflow/providers/external-runtime-capability.provider.ts',
        ),
      ),
    ).toBe(false);
  });

  it('does not keep the retired preflight callback provider in API tool paths', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          'src/tool/providers/preflight-capability.provider.ts',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          process.cwd(),
          'src/capability-governance/providers/preflight-capability.provider.ts',
        ),
      ),
    ).toBe(false);
  });

  it('does not keep compatibility re-export providers in API tool paths', () => {
    for (const fileName of [
      'approvals-capability.provider.ts',
      'delegation-capability.provider.ts',
      'implementation-plan-capability.provider.ts',
      'job-output-capability.provider.ts',
      'orchestration-session-capability.provider.ts',
      'workflow-context-capability.provider.ts',
      'workflow-management-capability.provider.ts',
      'workflow-runtime-browser-capability.provider.ts',
    ]) {
      expect(
        existsSync(join(process.cwd(), 'src/tool/providers', fileName)),
        fileName,
      ).toBe(false);
    }
  });

  it('does not advertise removed external runtime bridge callbacks from core providers', () => {
    const callbackPaths = collectApiCallbackPaths(CAPABILITY_PROVIDERS);

    expect(callbackPaths).not.toContain(
      '/api/workflow-runtime/get-orchestration-state',
    );
    expect(callbackPaths).not.toContain(
      '/api/workflow-runtime/steering/query-project-state',
    );
    expect(callbackPaths).not.toContain(
      '/api/workflow-runtime/orchestration/complete',
    );
    expect(callbackPaths).not.toContain('/api/workflow-runtime/publish-specs');
  });

  it('does not advertise the missing generic internal-tools callback endpoint', () => {
    const callbackPaths = collectApiCallbackPaths(CAPABILITY_PROVIDERS);

    expect(callbackPaths).not.toContain(
      '/api/workflow-runtime/internal-tools/execute',
    );
  });

  it('no duplicate capability names across all providers', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];

    for (const ProviderClass of CAPABILITY_PROVIDERS) {
      const proto = ProviderClass.prototype as unknown as Record<
        string,
        unknown
      >;
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor') {
          continue;
        }
        const method = proto[key];
        if (typeof method !== 'function') {
          continue;
        }
        const metadata = Reflect.getMetadata(
          CAPABILITY_METADATA_KEY,
          method,
        ) as { name?: string } | undefined;
        if (metadata?.name) {
          if (seen.has(metadata.name)) {
            duplicates.push(metadata.name);
          }
          seen.add(metadata.name);
        }
      }
    }

    expect(
      duplicates,
      `Duplicate capability names: ${duplicates.join(', ')}`,
    ).toEqual([]);
  });
});

function collectProviderCapabilities(ProviderClass: new () => object): Array<{
  name?: string;
  runtimeOwner?: string;
  seedInRegistry?: boolean;
  apiCallback?: { method?: string; pathTemplate?: string };
}> {
  const capabilities = [];
  const proto = ProviderClass.prototype as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') {
      continue;
    }
    const method = proto[key];
    if (typeof method !== 'function') {
      continue;
    }
    const metadata = Reflect.getMetadata(CAPABILITY_METADATA_KEY, method) as
      | {
          name?: string;
          runtimeOwner?: string;
          seedInRegistry?: boolean;
          apiCallback?: { method?: string; pathTemplate?: string };
        }
      | undefined;
    if (metadata) {
      capabilities.push(metadata);
    }
  }
  return capabilities;
}
