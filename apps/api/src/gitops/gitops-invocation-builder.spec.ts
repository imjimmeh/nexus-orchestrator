import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitOpsInvocationBuilder } from './gitops-invocation-builder';
import { buildGitHttpsAuthEnv } from './gitops-invocation-builder';
import { CredentialResolutionError } from './gitops-credentials-resolver.service';
import type { GitOpsCredentialsResolver } from './gitops-credentials-resolver.service';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

interface ResolverStub {
  resolveHttpsCredentials: ReturnType<typeof vi.fn>;
  resolveSshPrivateKey: ReturnType<typeof vi.fn>;
}

function buildBinding(
  overrides: Partial<GitOpsRepositoryBinding> = {},
): GitOpsRepositoryBinding {
  return {
    id: 'binding-1',
    scopeNodeId: 'scope-1',
    name: 'primary',
    repoUrl: 'https://example.com/repo.git',
    defaultRef: 'main',
    rootPath: '.',
    syncMode: 'two_way',
    credentialsSecretId: null,
    enabled: true,
    includedObjectTypes: ['scope_node'],
    conflictPolicy: 'require_review',
    lastAppliedRevision: null,
    createdByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('GitOpsInvocationBuilder', () => {
  let resolver: ResolverStub;
  let builder: GitOpsInvocationBuilder;
  let workspaceBase: string;
  let previousWorkspaceBase: string | undefined;

  beforeEach(async () => {
    previousWorkspaceBase = process.env.NEXUS_WORKSPACE_BASE_PATH;
    workspaceBase = await mkdtemp(path.join(tmpdir(), 'gitops-builder-'));
    process.env.NEXUS_WORKSPACE_BASE_PATH = workspaceBase;
    resolver = {
      resolveHttpsCredentials: vi.fn().mockResolvedValue(null),
      resolveSshPrivateKey: vi.fn().mockResolvedValue(null),
    };
    builder = new GitOpsInvocationBuilder(
      resolver as unknown as GitOpsCredentialsResolver,
    );
  });

  afterEach(async () => {
    if (previousWorkspaceBase === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
    } else {
      process.env.NEXUS_WORKSPACE_BASE_PATH = previousWorkspaceBase;
    }
    await rm(workspaceBase, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('HTTPS path', () => {
    it('passes args + cwd through unchanged when no credentials resolve', async () => {
      const binding = buildBinding({
        repoUrl: 'https://example.com/repo.git',
      });
      const invocation = await builder.build({
        binding,
        args: ['fetch', '--prune', 'origin', 'main'],
        cwd: '/tmp/repo',
      });

      expect(resolver.resolveHttpsCredentials).toHaveBeenCalledWith(binding);
      expect(invocation.args).toEqual(['fetch', '--prune', 'origin', 'main']);
      expect(invocation.cwd).toBe('/tmp/repo');
      expect(invocation.env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
      await expect(invocation.cleanup()).resolves.toBeUndefined();
    });

    it('injects GIT_CONFIG_* auth env when credentials resolve', async () => {
      resolver.resolveHttpsCredentials.mockResolvedValue({
        username: 'octocat',
        password: 'ghp_supersecret',
      });
      const binding = buildBinding({
        repoUrl: 'https://github.com/owner/repo.git',
      });
      const invocation = await builder.build({
        binding,
        args: ['push', 'origin', 'main'],
        cwd: '/tmp/repo',
      });

      expect(invocation.env).toEqual({
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: expect.stringContaining('Authorization: Basic '),
      });

      const headerValue = invocation.env['GIT_CONFIG_VALUE_0'] as string;
      const expected = Buffer.from('octocat:ghp_supersecret').toString(
        'base64',
      );
      expect(headerValue).toBe(`Authorization: Basic ${expected}`);
      // The token value must never appear in the args list.
      expect(invocation.args.join(' ')).not.toContain('ghp_supersecret');
    });

    it('uses x-access-token as the basic-auth user for token-only credentials', async () => {
      resolver.resolveHttpsCredentials.mockResolvedValue({
        username: '',
        password: 'ghp_supersecret',
      });
      const invocation = await builder.build({
        binding: buildBinding({ repoUrl: 'https://github.com/owner/repo.git' }),
        args: ['fetch', 'origin'],
        cwd: '/tmp/repo',
      });

      const headerValue = invocation.env['GIT_CONFIG_VALUE_0'] as string;
      const expected = Buffer.from('x-access-token:ghp_supersecret').toString(
        'base64',
      );
      expect(headerValue).toBe(`Authorization: Basic ${expected}`);
    });

    it('propagates strict-mode CredentialResolutionError without rewriting it', async () => {
      const strict = new CredentialResolutionError({
        bindingId: 'binding-1',
        secretId: null,
        reason: 'require_credentials_for_host',
      });
      resolver.resolveHttpsCredentials.mockRejectedValue(strict);

      await expect(
        builder.build({
          binding: buildBinding({ repoUrl: 'https://example.com/repo.git' }),
          args: ['fetch', 'origin'],
          cwd: '/tmp/repo',
        }),
      ).rejects.toBeInstanceOf(CredentialResolutionError);
    });
  });

  describe('SSH path', () => {
    it('writes the resolved key to a 0600 temp file and points GIT_SSH_COMMAND at it', async () => {
      const keyBody = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake-key\n-----END';
      resolver.resolveSshPrivateKey.mockResolvedValue(keyBody);
      const binding = buildBinding({
        repoUrl: 'git@github.com:owner/repo.git',
      });

      const invocation = await builder.build({
        binding,
        args: ['fetch', '--prune', 'origin', 'main'],
        cwd: '/tmp/repo',
      });

      const sshCommand = invocation.env['GIT_SSH_COMMAND'];
      expect(typeof sshCommand).toBe('string');
      const commandString = sshCommand as string;
      expect(commandString.startsWith('ssh -i ')).toBe(true);
      expect(commandString).toContain('IdentitiesOnly=yes');
      expect(commandString).toContain('StrictHostKeyChecking=accept-new');
      expect(commandString).toContain('BatchMode=yes');

      const tempFilePath = (commandString.match(/-i (\S+)/) ?? [])[1];
      expect(tempFilePath).toBeTruthy();

      const onDisk = await readFile(tempFilePath, 'utf8');
      expect(onDisk).toBe(keyBody);
      const stats = await stat(tempFilePath);
      // Mask out type bits — only the permission portion is
      // load-bearing for this assertion. The check is POSIX-only:
      // on Windows, Node's chmod can only toggle the read-only bit
      // and cannot represent Unix 0600, so stat reports 666. The
      // production runtime is Linux containers where 0600 holds, and
      // the builder sets mode 0o600 on both writeFile and chmod.
      if (process.platform !== 'win32') {
        expect((stats.mode & 0o777).toString(8)).toBe('600');
      }

      await invocation.cleanup();
      await expect(stat(tempFilePath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('cleanup is idempotent — calling it twice does not throw', async () => {
      const keyBody = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END';
      resolver.resolveSshPrivateKey.mockResolvedValue(keyBody);
      const invocation = await builder.build({
        binding: buildBinding({ repoUrl: 'git@github.com:owner/repo.git' }),
        args: ['fetch', 'origin'],
        cwd: '/tmp/repo',
      });
      await invocation.cleanup();
      await expect(invocation.cleanup()).resolves.toBeUndefined();
    });

    it('proceeds anonymously when no key is returned (strict mode OFF)', async () => {
      resolver.resolveSshPrivateKey.mockResolvedValue(null);
      const invocation = await builder.build({
        binding: buildBinding({ repoUrl: 'git@github.com:owner/repo.git' }),
        args: ['fetch', 'origin'],
        cwd: '/tmp/repo',
      });

      expect(invocation.env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
      expect(invocation.env['GIT_SSH_COMMAND']).toBeUndefined();
      await expect(invocation.cleanup()).resolves.toBeUndefined();
    });

    it('propagates strict-mode CredentialResolutionError on the SSH path', async () => {
      const strict = new CredentialResolutionError({
        bindingId: 'binding-1',
        secretId: null,
        reason: 'require_credentials_for_host',
      });
      resolver.resolveSshPrivateKey.mockRejectedValue(strict);

      await expect(
        builder.build({
          binding: buildBinding({ repoUrl: 'git@github.com:owner/repo.git' }),
          args: ['fetch', 'origin'],
          cwd: '/tmp/repo',
        }),
      ).rejects.toBeInstanceOf(CredentialResolutionError);
    });
  });

  describe('buildGitHttpsAuthEnv', () => {
    it('encodes username:password as Basic auth and never echoes the password into key names', () => {
      const env = buildGitHttpsAuthEnv('octocat', 'super-secret');
      expect(env.GIT_CONFIG_COUNT).toBe('1');
      expect(env.GIT_CONFIG_KEY_0).toBe('http.extraHeader');
      const expected = Buffer.from('octocat:super-secret').toString('base64');
      expect(env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
      // The password value must not appear in any env key name.
      for (const key of Object.keys(env)) {
        expect(key).not.toContain('super-secret');
      }
    });
  });
});
