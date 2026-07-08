import { describe, it, expect } from 'vitest';
import { buildGitAuthEnv } from './git-auth-env.helpers';

describe('buildGitAuthEnv', () => {
  it('returns GIT_CONFIG_COUNT of 1', () => {
    const env = buildGitAuthEnv('ghp_test_token');
    expect(env.GIT_CONFIG_COUNT).toBe('1');
  });

  it('sets http.extraHeader config key', () => {
    const env = buildGitAuthEnv('ghp_test_token');
    expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
  });

  it('encodes token as Basic Authorization header', () => {
    const token = 'ghp_test_token';
    const env = buildGitAuthEnv(token);
    const expectedEncoded = Buffer.from(`x-access-token:${token}`).toString(
      'base64',
    );
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `Authorization: Basic ${expectedEncoded}`,
    );
  });

  it('sets GIT_TERMINAL_PROMPT to 0 to prevent interactive prompts', () => {
    const env = buildGitAuthEnv('any-token');
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('does not embed token value in any top-level key name', () => {
    const token = 'super-secret-token';
    const env = buildGitAuthEnv(token);
    const keyNames = Object.keys(env);
    for (const key of keyNames) {
      expect(key).not.toContain(token);
    }
  });

  it('produces different Authorization values for different tokens', () => {
    const env1 = buildGitAuthEnv('token-a');
    const env2 = buildGitAuthEnv('token-b');
    expect(env1.GIT_CONFIG_VALUE_0).not.toBe(env2.GIT_CONFIG_VALUE_0);
  });
});
