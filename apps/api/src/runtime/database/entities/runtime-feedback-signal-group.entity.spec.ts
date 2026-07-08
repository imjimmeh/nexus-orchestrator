import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { RuntimeFeedbackSignalGroup } from './runtime-feedback-signal-group.entity';

describe('RuntimeFeedbackSignalGroup entity', () => {
  it('maps persisted aggregation and diagnostics columns', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === RuntimeFeedbackSignalGroup)
      .map((column) => column.options.name ?? column.propertyName);

    expect(columns).toEqual(
      expect.arrayContaining([
        'dedupe_fingerprint',
        'signal_type',
        'source_module',
        'scope_type',
        'scope_id',
        'occurrence_count',
        'window_occurrence_count',
        'window_started_at',
        'candidate_id',
        'last_skipped_reason',
        'examples_json',
      ]),
    );
  });
});
