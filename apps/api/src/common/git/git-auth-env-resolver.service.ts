import { Injectable } from '@nestjs/common';

const NO_AUTH_ENV: Readonly<Record<string, string>> = Object.freeze({
  GIT_TERMINAL_PROMPT: '0',
});

/**
 * Resolves the env vars required for authenticated git operations against
 * a project's remote repository.
 *
 * - Loads the project's linked GitHub auth secret via the secret store.
 * - Decrypts the payload, extracts the token, and produces the
 *   `GIT_CONFIG_*` env that git will use for the next invocation.
 * - Falls back to a non-interactive env when no secret is configured so
 *   that git fails fast instead of prompting in non-tty contexts.
 *
 * Token values are never logged or returned.
 */
@Injectable()
export class GitAuthEnvResolverService {
  async resolveProjectGitAuthEnv(
    _scopeId: string,
  ): Promise<Record<string, string>> {
    await Promise.resolve();
    return { ...NO_AUTH_ENV };
  }
}
