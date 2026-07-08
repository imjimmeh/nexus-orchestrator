export type SupportedProvider = 'github' | 'gitlab' | 'bitbucket';

export interface ParsedRepository {
  provider: SupportedProvider;
  host: string;
  owner: string;
  repo: string;
}
