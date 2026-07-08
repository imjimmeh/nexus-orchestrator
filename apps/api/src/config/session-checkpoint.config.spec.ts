import { describe, it, expect, afterEach } from 'vitest';
import { isSessionCheckpointResumeEnabled } from './session-checkpoint.config';

describe('isSessionCheckpointResumeEnabled', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns false when the env var is unset', () => {
    delete process.env.SESSION_CHECKPOINT_RESUME_ENABLED;

    expect(isSessionCheckpointResumeEnabled()).toBe(false);
  });

  it('returns true when the env var is "true"', () => {
    process.env.SESSION_CHECKPOINT_RESUME_ENABLED = 'true';

    expect(isSessionCheckpointResumeEnabled()).toBe(true);
  });

  it('returns true when the env var is "1"', () => {
    process.env.SESSION_CHECKPOINT_RESUME_ENABLED = '1';

    expect(isSessionCheckpointResumeEnabled()).toBe(true);
  });

  it('returns false when the env var is "false"', () => {
    process.env.SESSION_CHECKPOINT_RESUME_ENABLED = 'false';

    expect(isSessionCheckpointResumeEnabled()).toBe(false);
  });

  it('returns false when the env var is an empty string', () => {
    process.env.SESSION_CHECKPOINT_RESUME_ENABLED = '';

    expect(isSessionCheckpointResumeEnabled()).toBe(false);
  });

  it('returns false when the env var is garbage', () => {
    process.env.SESSION_CHECKPOINT_RESUME_ENABLED = 'yes';

    expect(isSessionCheckpointResumeEnabled()).toBe(false);
  });
});
