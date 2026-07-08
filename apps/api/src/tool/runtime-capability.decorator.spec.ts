import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  getRuntimeCapabilityMetadata,
  RuntimeCapability,
} from '../capability-infra/runtime-capability.decorator';
import type { RuntimeCapabilityDefinition } from '../capability-infra/runtime-capability.types';

const TEST_RUNTIME_CAPABILITY: RuntimeCapabilityDefinition = {
  name: 'query_memory',
  tierRestriction: 1,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['read_only'],
  description: 'Test runtime capability.',
  inputSchema: z.object({}),
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/test/query-memory',
    bodyMapping: {},
  },
};

class RuntimeCapabilityFixture {
  @RuntimeCapability(TEST_RUNTIME_CAPABILITY)
  queryMemory(): void {}

  undecorated(): void {}
}

describe('RuntimeCapability decorator', () => {
  it('stores runtime capability metadata on a decorated method', () => {
    expect(
      getRuntimeCapabilityMetadata(
        RuntimeCapabilityFixture.prototype,
        'queryMemory',
      ),
    ).toBe(TEST_RUNTIME_CAPABILITY);
  });

  it('returns undefined for an undecorated method', () => {
    expect(
      getRuntimeCapabilityMetadata(
        RuntimeCapabilityFixture.prototype,
        'undecorated',
      ),
    ).toBeUndefined();
  });

  it('returns undefined when the property is not a method', () => {
    expect(
      getRuntimeCapabilityMetadata(
        { queryMemory: TEST_RUNTIME_CAPABILITY },
        'queryMemory',
      ),
    ).toBeUndefined();
  });
});
