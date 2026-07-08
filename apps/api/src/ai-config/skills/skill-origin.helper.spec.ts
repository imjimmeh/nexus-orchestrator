import { describe, expect, it } from 'vitest';
import {
  stampRuntimeOrigin,
  readRuntimeOrigin,
  isRuntimeAuthored,
} from './skill-origin.helper';
import type { RuntimeSkillOrigin } from './skill-origin.types';

const FIXED_TIMESTAMP = '2026-01-15T12:00:00.000Z';

const baseOrigin: RuntimeSkillOrigin = {
  source: 'agent_factory',
  stamped_at: FIXED_TIMESTAMP,
};

const SEED_MARKDOWN =
  '---\nname: my-skill\ndescription: A seed skill.\n---\n\n# Body\n\nSome content.';

const NO_FRONTMATTER = '# Just a body with no frontmatter';

describe('stampRuntimeOrigin', () => {
  it('adds nexus_origin.source === agent_factory to bare markdown', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.source).toBe('agent_factory');
  });

  it('sets stamped_at on the nexus_origin block', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.stamped_at).toBe(FIXED_TIMESTAMP);
  });

  it('includes optional source_proposal_id when provided', () => {
    const origin: RuntimeSkillOrigin = {
      ...baseOrigin,
      source_proposal_id: 'prop-abc',
    };
    const result = stampRuntimeOrigin(SEED_MARKDOWN, origin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.source_proposal_id).toBe('prop-abc');
  });

  it('includes optional generated_from_run_id when provided', () => {
    const origin: RuntimeSkillOrigin = {
      ...baseOrigin,
      generated_from_run_id: 'run-xyz',
    };
    const result = stampRuntimeOrigin(SEED_MARKDOWN, origin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.generated_from_run_id).toBe('run-xyz');
  });

  it('preserves existing frontmatter keys alongside nexus_origin', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    expect(result).toContain('name: my-skill');
    expect(result).toContain('description:');
  });

  it('preserves the markdown body after the frontmatter', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    expect(result).toContain('# Body');
    expect(result).toContain('Some content.');
  });

  it('is idempotent — re-stamping produces exactly one nexus_origin block', () => {
    const once = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const twice = stampRuntimeOrigin(once, {
      ...baseOrigin,
      stamped_at: '2026-02-01T00:00:00.000Z',
    });
    const occurrences = (twice.match(/nexus_origin/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('updates stamped_at on re-stamp (idempotent update in place)', () => {
    const once = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const secondTimestamp = '2026-02-01T00:00:00.000Z';
    const twice = stampRuntimeOrigin(once, {
      ...baseOrigin,
      stamped_at: secondTimestamp,
    });
    const parsed = readRuntimeOrigin(twice);
    expect(parsed?.stamped_at).toBe(secondTimestamp);
  });

  it('returns input unchanged (fail-soft) when markdown has no frontmatter', () => {
    const result = stampRuntimeOrigin(NO_FRONTMATTER, baseOrigin);
    expect(result).toBe(NO_FRONTMATTER);
  });

  it('omits source_proposal_id from nexus_origin when not provided', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.source_proposal_id).toBeUndefined();
  });

  it('omits generated_from_run_id from nexus_origin when not provided', () => {
    const result = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const parsed = readRuntimeOrigin(result);
    expect(parsed?.generated_from_run_id).toBeUndefined();
  });
});

describe('readRuntimeOrigin', () => {
  it('round-trips: reads back the origin that was stamped', () => {
    const stamped = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    const read = readRuntimeOrigin(stamped);
    expect(read).toEqual(baseOrigin);
  });

  it('round-trips optional ids when provided', () => {
    const origin: RuntimeSkillOrigin = {
      ...baseOrigin,
      source_proposal_id: 'prop-abc',
      generated_from_run_id: 'run-xyz',
    };
    const stamped = stampRuntimeOrigin(SEED_MARKDOWN, origin);
    const read = readRuntimeOrigin(stamped);
    expect(read).toEqual(origin);
  });

  it('returns null for a seed skill with no nexus_origin block', () => {
    expect(readRuntimeOrigin(SEED_MARKDOWN)).toBeNull();
  });

  it('returns null for markdown with no frontmatter', () => {
    expect(readRuntimeOrigin(NO_FRONTMATTER)).toBeNull();
  });

  it('returns null when nexus_origin.source is not agent_factory', () => {
    const withOtherSource =
      '---\nname: my-skill\ndescription: Test\nnexus_origin:\n  source: manual\n  stamped_at: 2026-01-01T00:00:00.000Z\n---\n';
    expect(readRuntimeOrigin(withOtherSource)).toBeNull();
  });
});

describe('isRuntimeAuthored', () => {
  it('returns true for a skill stamped with agent_factory source', () => {
    const stamped = stampRuntimeOrigin(SEED_MARKDOWN, baseOrigin);
    expect(isRuntimeAuthored(stamped)).toBe(true);
  });

  it('returns false for a seed skill with no marker', () => {
    expect(isRuntimeAuthored(SEED_MARKDOWN)).toBe(false);
  });

  it('returns false for markdown with no frontmatter', () => {
    expect(isRuntimeAuthored(NO_FRONTMATTER)).toBe(false);
  });
});
