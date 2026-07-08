import { BadRequestException } from '@nestjs/common';
import type { ParsedGitHubRepository } from './github-repository-url.parser.types';

const HTTPS_GITHUB =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_GITHUB = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/**
 * Parse a GitHub repository URL into its `{ owner, repo }` pair.
 *
 * Accepts the two canonical remote forms:
 *  - `https://github.com/owner/repo` (with optional `.git` / trailing slash)
 *  - `git@github.com:owner/repo.git`
 *
 * @throws BadRequestException when the URL is not a parseable github.com repo.
 */
export function parseGitHubRepositoryUrl(url: string): ParsedGitHubRepository {
  const trimmed = url.trim();
  const match = HTTPS_GITHUB.exec(trimmed) ?? SSH_GITHUB.exec(trimmed);
  if (!match) {
    throw new BadRequestException(
      `Unsupported or unparseable GitHub repository URL`,
    );
  }
  const [, owner, repo] = match;
  return { owner, repo };
}
