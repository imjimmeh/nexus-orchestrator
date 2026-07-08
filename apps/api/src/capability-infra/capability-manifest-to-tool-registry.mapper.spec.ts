import { describe, expect, it } from 'vitest';
import { mapCapabilityEntryToToolRegistryPayload } from './capability-manifest-to-tool-registry.mapper';
import type { CanonicalCapabilityDefinition } from './canonical-capability.types';

const baseEntry: CanonicalCapabilityDefinition = {
  name: 'file.read',
  description: 'Read a file',
  schema: { type: 'object' },
  typescriptCode: 'export const tool = {};',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: [],
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/tools/file/read',
    bodyMapping: { foo: 'bar' },
  },
  source: 'decorator_provider',
};

describe('mapCapabilityEntryToToolRegistryPayload', () => {
  it('includes the entry source in the resulting payload', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.source).toBe('decorator_provider');
  });

  it('carries through external MCP source values unchanged', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload({
      ...baseEntry,
      source: 'external_mcp',
    });

    expect(payload.source).toBe('external_mcp');
  });

  it('transforms tier_restriction from tierRestriction', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.tier_restriction).toBe(1);
  });

  it('carries through transport field', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.transport).toBe('api_callback');
  });

  it('transforms runtime_owner from runtimeOwner', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.runtime_owner).toBe('api');
  });

  it('transforms api_callback field names (method, path_template, body_mapping)', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload(baseEntry);

    expect(payload.api_callback).toEqual({
      method: 'POST',
      path_template: '/api/tools/file/read',
      body_mapping: { foo: 'bar' },
    });
  });

  it('omits api_callback when not provided', () => {
    const payload = mapCapabilityEntryToToolRegistryPayload({
      ...baseEntry,
      apiCallback: undefined,
    });

    expect(payload.api_callback).toBeUndefined();
  });
});
