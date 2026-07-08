import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { parseRepositoryUrl } from './repository-url.parser';

describe('parseRepositoryUrl', () => {
  it('detects github.com https', () => {
    expect(parseRepositoryUrl('https://github.com/acme/widgets.git')).toEqual({
      provider: 'github',
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('detects gitlab.com https', () => {
    expect(parseRepositoryUrl('https://gitlab.com/acme/widgets')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('detects bitbucket.org https', () => {
    expect(
      parseRepositoryUrl('https://bitbucket.org/acme/widgets.git'),
    ).toEqual({
      provider: 'bitbucket',
      host: 'bitbucket.org',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('detects an ssh scp-style gitlab url', () => {
    expect(parseRepositoryUrl('git@gitlab.com:acme/widgets.git')).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('keeps the full gitlab subgroup namespace as owner', () => {
    expect(
      parseRepositoryUrl('https://gitlab.com/acme/team-a/widgets.git'),
    ).toEqual({
      provider: 'gitlab',
      host: 'gitlab.com',
      owner: 'acme/team-a',
      repo: 'widgets',
    });
  });

  it('detects a self-hosted gitlab host by substring', () => {
    expect(
      parseRepositoryUrl('https://gitlab.internal.acme.dev/acme/widgets.git'),
    ).toEqual({
      provider: 'gitlab',
      host: 'gitlab.internal.acme.dev',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('detects a self-hosted bitbucket server host by substring', () => {
    expect(
      parseRepositoryUrl('https://bitbucket.acme.dev/acme/widgets.git'),
    ).toEqual({
      provider: 'bitbucket',
      host: 'bitbucket.acme.dev',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('throws BadRequestException for an unknown host', () => {
    expect(() =>
      parseRepositoryUrl('https://example.com/acme/widgets.git'),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for a url missing the repo segment', () => {
    expect(() => parseRepositoryUrl('https://gitlab.com/acme')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for an empty string', () => {
    expect(() => parseRepositoryUrl('')).toThrow(BadRequestException);
  });
});
