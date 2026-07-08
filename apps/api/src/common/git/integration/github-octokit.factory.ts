import { Octokit } from '@octokit/rest';
import type { OctokitFactory } from './github-octokit.factory.types';

/** Default production factory — builds a real authenticated Octokit client. */
export const defaultOctokitFactory: OctokitFactory = (token: string) =>
  new Octokit({ auth: token });
