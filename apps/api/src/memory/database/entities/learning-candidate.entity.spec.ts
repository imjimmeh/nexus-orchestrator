import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { LearningCandidate } from './learning-candidate.entity';

describe('LearningCandidate entity', () => {
  it('uses neutral scope columns', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === LearningCandidate)
      .map((column) => column.options.name ?? column.propertyName);

    expect(columns).toContain('scope_type');
    expect(columns).toContain('scope_id');
  });
});
