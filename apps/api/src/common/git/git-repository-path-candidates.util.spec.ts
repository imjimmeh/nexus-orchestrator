import { afterEach, describe, expect, it } from 'vitest';
import { buildGitRepositoryPathCandidates } from './git-repository-path-candidates.util';

const UUID_SCOPE_ID = '70945876-acf1-4ec4-bd7b-ea0121f90140';

describe('buildGitRepositoryPathCandidates', () => {
  const originalWorkspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;

  afterEach(() => {
    if (originalWorkspaceBasePath === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
      return;
    }

    process.env.NEXUS_WORKSPACE_BASE_PATH = originalWorkspaceBasePath;
  });

  it('uses non-uuid repository identifiers as literal paths only', () => {
    process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';

    expect(buildGitRepositoryPathCandidates('/repos/custom')).toEqual([
      '/repos/custom',
    ]);
  });

  it('adds managed clone candidates for uuid repository identifiers', () => {
    process.env.NEXUS_WORKSPACE_BASE_PATH = '/workspace-root';

    expect(buildGitRepositoryPathCandidates(UUID_SCOPE_ID)).toEqual([
      UUID_SCOPE_ID,
      `/workspace-root/clones/${UUID_SCOPE_ID}`,
      `/data/nexus-workspaces/clones/${UUID_SCOPE_ID}`,
      `/tmp/nexus-workspaces/clones/${UUID_SCOPE_ID}`,
    ]);
  });
});
