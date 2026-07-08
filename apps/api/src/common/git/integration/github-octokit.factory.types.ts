import type { Octokit } from '@octokit/rest';

export const GITHUB_OCTOKIT_FACTORY = Symbol('GITHUB_OCTOKIT_FACTORY');

/** Constructs an authenticated Octokit client. Swappable for tests. */
export type OctokitFactory = (token: string) => Octokit;
