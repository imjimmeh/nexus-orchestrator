import { describe, expect, it } from 'vitest';
import { ToolPayloadMapper } from './tool-payload.mapper';

describe('ToolPayloadMapper', () => {
  const mapper = new ToolPayloadMapper();

  it('includes source in the create payload when provided', () => {
    const payload = mapper.toCreatePayload({
      name: 'file.read',
      schema: { type: 'object' },
      typescript_code: 'export const tool = {};',
      source: 'decorator_provider',
    });

    expect(payload.source).toBe('decorator_provider');
  });

  it('omits source from the create payload when not provided', () => {
    const payload = mapper.toCreatePayload({
      name: 'file.read',
      schema: { type: 'object' },
      typescript_code: 'export const tool = {};',
    });

    expect(payload.source).toBeUndefined();
  });

  it('never includes source in the update payload, even when provided', () => {
    const payload = mapper.toUpdatePayload({
      name: 'file.read',
      source: 'manual',
    });

    expect(payload.source).toBeUndefined();
  });
});
