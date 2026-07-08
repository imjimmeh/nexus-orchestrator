import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodSchemaToCapabilityJsonSchema } from './runtime-capability-schema.adapter';

describe('zodSchemaToCapabilityJsonSchema', () => {
  it('preserves passthrough object schemas for arbitrary key payloads', () => {
    const schema = z.object({
      data: z.looseObject({}),
    });

    const result = zodSchemaToCapabilityJsonSchema(schema);
    const dataSchema = (result.properties as Record<string, unknown>).data as
      | Record<string, unknown>
      | undefined;

    expect(result).toMatchObject({
      type: 'object',
      required: ['data'],
    });
    expect(dataSchema).toMatchObject({
      type: 'object',
    });
    expect(dataSchema?.additionalProperties).toEqual({});
  });
});
