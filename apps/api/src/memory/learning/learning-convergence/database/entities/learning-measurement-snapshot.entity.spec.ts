import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { LearningMeasurementSnapshot } from './learning-measurement-snapshot.entity';

describe('LearningMeasurementSnapshot entity', () => {
  it('declares a UUID primary id column for TypeORM metadata validation', () => {
    const primaryColumns = getMetadataArgsStorage().columns.filter(
      (column) =>
        column.target === LearningMeasurementSnapshot &&
        column.options.primary === true,
    );

    expect(primaryColumns).toHaveLength(1);
    expect(primaryColumns[0]?.propertyName).toBe('id');
    expect(primaryColumns[0]?.options.type).toBe('uuid');
  });
});
