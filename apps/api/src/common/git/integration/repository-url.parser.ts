import { BadRequestException } from '@nestjs/common';
import type {
  ParsedRepository,
  SupportedProvider,
} from './repository-url.parser.types';

const HTTPS_REMOTE = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i;
const SSH_REMOTE = /^git@([^:]+):(.+?)(?:\.git)?\/?$/i;

function detectProvider(host: string): SupportedProvider | null {
  const normalized = host.toLowerCase();
  if (normalized === 'github.com' || normalized.includes('github')) {
    return 'github';
  }
  if (normalized === 'gitlab.com' || normalized.includes('gitlab')) {
    return 'gitlab';
  }
  if (normalized === 'bitbucket.org' || normalized.includes('bitbucket')) {
    return 'bitbucket';
  }
  return null;
}

/**
 * Parse any supported git remote into `{ provider, host, owner, repo }`.
 *
 * Detects the provider from the host (the three cloud hosts plus self-hosted
 * hosts whose name contains `github` / `gitlab` / `bitbucket`). The owner keeps
 * the full namespace path (GitLab subgroups); the repo is the final segment.
 *
 * @throws BadRequestException when the URL is unparseable or the host is unknown.
 */
export function parseRepositoryUrl(url: string): ParsedRepository {
  const trimmed = url.trim();
  const match = HTTPS_REMOTE.exec(trimmed) ?? SSH_REMOTE.exec(trimmed);
  if (!match) {
    throw new BadRequestException('Unparseable repository URL');
  }
  const [, host, path] = match;
  const provider = detectProvider(host);
  if (!provider) {
    throw new BadRequestException('Unsupported repository host');
  }

  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    throw new BadRequestException('Repository URL is missing owner/repo');
  }
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, segments.length - 1).join('/');
  return { provider, host, owner, repo };
}
