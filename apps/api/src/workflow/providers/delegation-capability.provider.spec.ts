import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import type { ZodType } from 'zod';
import { DelegationCapabilityProvider } from './delegation-capability.provider';
import { getCapabilityMetadata } from '../../capability-infra/capability.decorator';
import { zodSchemaToCapabilityJsonSchema } from '../../capability-infra/runtime-capability-schema.adapter';

/**
 * Locks the delegation capability surface against the root-union schema bug:
 * a tool whose inputSchema serializes to a non-object root (e.g. a root
 * `z.union` → `{ anyOf: [...] }`) is rejected by strict LLM providers
 * (DeepSeek `type: null`) and kills the agent's first turn. ToolValidationService
 * guards this at registration; this test catches it at author time.
 */
describe('DelegationCapabilityProvider capability schemas', () => {
  const prototype = DelegationCapabilityProvider.prototype as Record<
    string,
    unknown
  >;
  // `@Capability` (SetMetadata) stores metadata on the method function itself,
  // mirroring how CapabilityRegistryService reads it (single-arg lookup).
  const capabilities = Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => prototype[name])
    .filter((value): value is object => typeof value === 'function')
    .map((methodFn) => getCapabilityMetadata(methodFn))
    .filter(
      (meta): meta is NonNullable<typeof meta> & { inputSchema: ZodType } =>
        Boolean(meta?.inputSchema),
    );

  it('exposes the core delegation capabilities', () => {
    const names = capabilities.map((meta) => meta.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'invoke_agent_workflow',
        'await_agent_workflow',
        'list_running_workflows',
      ]),
    );
  });

  it('serializes every capability inputSchema to an object-rooted JSON schema', () => {
    const offenders = capabilities
      .map((meta) => ({
        name: meta.name,
        json: zodSchemaToCapabilityJsonSchema(meta.inputSchema),
      }))
      .filter((entry) => entry.json.type !== 'object')
      .map((entry) => entry.name);

    expect(offenders).toEqual([]);
  });
});
