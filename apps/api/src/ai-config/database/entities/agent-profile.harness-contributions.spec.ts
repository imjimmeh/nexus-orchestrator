import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { AgentProfile } from './agent-profile.entity';

describe('AgentProfile.harness_contributions column', () => {
  it('is declared as a nullable jsonb column', () => {
    const col = getMetadataArgsStorage().columns.find(
      (c) =>
        c.target === AgentProfile && c.propertyName === 'harness_contributions',
    );
    expect(col).toBeDefined();
    expect(col?.options.type).toBe('jsonb');
    expect(col?.options.nullable).toBe(true);
  });
});
