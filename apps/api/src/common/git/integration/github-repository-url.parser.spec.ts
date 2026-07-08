import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseGitHubRepositoryUrl } from './github-repository-url.parser';

describe('parseGitHubRepositoryUrl', () => {
  it('parses an https URL without .git', () => {
    expect(parseGitHubRepositoryUrl('https://github.com/acme/widgets')).toEqual(
      {
        owner: 'acme',
        repo: 'widgets',
      },
    );
  });

  it('parses an https URL with .git suffix', () => {
    expect(
      parseGitHubRepositoryUrl('https://github.com/acme/widgets.git'),
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses an https URL with a trailing slash', () => {
    expect(
      parseGitHubRepositoryUrl('https://github.com/acme/widgets/'),
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses an ssh scp-style URL', () => {
    expect(parseGitHubRepositoryUrl('git@github.com:acme/widgets.git')).toEqual(
      { owner: 'acme', repo: 'widgets' },
    );
  });

  it('parses an ssh scp-style URL without .git', () => {
    expect(parseGitHubRepositoryUrl('git@github.com:acme/widgets')).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('throws BadRequestException for a non-github host', () => {
    expect(() =>
      parseGitHubRepositoryUrl('https://gitlab.com/acme/widgets.git'),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for a URL missing the repo segment', () => {
    expect(() => parseGitHubRepositoryUrl('https://github.com/acme')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for an empty string', () => {
    expect(() => parseGitHubRepositoryUrl('')).toThrow(BadRequestException);
  });
});
