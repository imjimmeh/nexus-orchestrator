import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SecretCrudService } from '../security/services/secret-crud.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import {
  CredentialResolutionError,
  DEFAULT_GITOPS_CREDENTIALS_OPTIONS,
  GITOPS_CREDENTIALS_OPTIONS,
  GitOpsCredentialsResolver,
} from './gitops-credentials-resolver.service';
import type {
  GitOpsCredentialsOptions,
  ResolvedHttpsCredentials,
} from './gitops-credentials-resolver.service.types';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';

type FindByIdRawResult = {
  id: string;
  decryptedValue: string;
} | null;

interface SecretCrudStub {
  findByIdRaw: ReturnType<typeof vi.fn<[string], Promise<FindByIdRawResult>>>;
}

interface EventLedgerStub {
  emitBestEffort: ReturnType<typeof vi.fn>;
}

const BINDING_ID = 'binding-1';
const SECRET_ID = '11111111-1111-1111-1111-111111111111';

function buildBinding(
  overrides: Partial<GitOpsRepositoryBinding> = {},
): GitOpsRepositoryBinding {
  return {
    id: BINDING_ID,
    scopeNodeId: '22222222-2222-2222-2222-222222222222',
    name: 'primary',
    repoUrl: 'https://example.com/repo.git',
    defaultRef: 'main',
    rootPath: '.',
    syncMode: 'git_to_app',
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

describe('GitOpsCredentialsResolver', () => {
  let secretCrud: SecretCrudStub;
  let eventLedger: EventLedgerStub;
  let options: GitOpsCredentialsOptions;
  let resolver: GitOpsCredentialsResolver;

  async function buildResolver(): Promise<GitOpsCredentialsResolver> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        GitOpsCredentialsResolver,
        { provide: SecretCrudService, useValue: secretCrud },
        { provide: EventLedgerService, useValue: eventLedger },
        { provide: GITOPS_CREDENTIALS_OPTIONS, useValue: options },
      ],
    }).compile();
    return moduleRef.get(GitOpsCredentialsResolver);
  }

  function findEmitted(
    eventName: string,
  ): { eventName: string; payload: Record<string, unknown> } | undefined {
    return eventLedger.emitBestEffort.mock.calls.find(
      ([params]) => params.eventName === eventName,
    )?.[0] as { eventName: string; payload: Record<string, unknown> };
  }

  beforeEach(() => {
    vi.useRealTimers();
    secretCrud = { findByIdRaw: vi.fn() };
    eventLedger = {
      emitBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    options = { ...DEFAULT_GITOPS_CREDENTIALS_OPTIONS };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('HTTPS resolution', () => {
    it('returns { username, password } from a { username, token } secret', async () => {
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username: 'octocat',
          token: 'ghp_secretsupersecret',
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({
        credentialsSecretId: SECRET_ID,
      });

      const result = (await resolver.resolveHttpsCredentials(
        binding,
      )) as ResolvedHttpsCredentials;

      expect(result).toEqual({
        username: 'octocat',
        password: 'ghp_secretsupersecret',
      });
      expect(findEmitted('gitops.credentials.resolved')?.payload).toMatchObject(
        {
          bindingId: BINDING_ID,
          secretKind: 'https',
          cached: false,
        },
      );
    });

    it('returns { username, password } from a { username, password } secret', async () => {
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username: 'octocat',
          password: 'hunter2hunter2',
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      const result = (await resolver.resolveHttpsCredentials(
        binding,
      )) as ResolvedHttpsCredentials;

      expect(result).toEqual({
        username: 'octocat',
        password: 'hunter2hunter2',
      });
      expect(findEmitted('gitops.credentials.resolved')?.payload).toMatchObject(
        {
          bindingId: BINDING_ID,
          secretKind: 'https',
        },
      );
    });

    it('treats a plain string secret as a token-only HTTPS credential', async () => {
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: 'plain-token-value',
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      const result = (await resolver.resolveHttpsCredentials(
        binding,
      )) as ResolvedHttpsCredentials;

      expect(result).toEqual({ username: '', password: 'plain-token-value' });
    });

    it('honours a kind discriminator of https_token', async () => {
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          kind: 'https_token',
          username: 'svc',
          password: 'abc123',
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      const result = (await resolver.resolveHttpsCredentials(
        binding,
      )) as ResolvedHttpsCredentials;

      expect(result).toEqual({ username: 'svc', password: 'abc123' });
    });
  });

  describe('SSH resolution', () => {
    it('returns the private-key string from an sshPrivateKey payload', async () => {
      const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END';
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({ sshPrivateKey: key }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'git@github.com:octocat/hello.git',
        credentialsSecretId: SECRET_ID,
      });

      const result = await resolver.resolveSshPrivateKey(binding);

      expect(result).toBe(key);
      expect(findEmitted('gitops.credentials.resolved')?.payload).toMatchObject(
        {
          bindingId: BINDING_ID,
          secretKind: 'ssh',
          cached: false,
        },
      );
    });

    it('returns the private-key string from a privateKey alias payload', async () => {
      const key = '-----BEGIN PRIVATE KEY-----\nfake\n-----END';
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({ privateKey: key }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'git@gitlab.com:group/repo.git',
        credentialsSecretId: SECRET_ID,
      });

      const result = await resolver.resolveSshPrivateKey(binding);

      expect(result).toBe(key);
    });

    it('returns null when the binding URL is HTTPS-shaped', async () => {
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({ sshPrivateKey: 'unused' }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      const result = await resolver.resolveSshPrivateKey(binding);

      expect(result).toBeNull();
      expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
    });
  });

  describe('missing credentialsSecretId', () => {
    it('returns null in anonymous mode and emits gitops.credentials.missing', async () => {
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: null });

      const result = await resolver.resolveHttpsCredentials(binding);

      expect(result).toBeNull();
      expect(secretCrud.findByIdRaw).not.toHaveBeenCalled();
      const missing = findEmitted('gitops.credentials.missing');
      expect(missing).toBeDefined();
      expect(missing?.payload).toMatchObject({
        bindingId: BINDING_ID,
        url: binding.repoUrl,
      });
    });
  });

  describe('resolution failure', () => {
    it('throws CredentialResolutionError in strict mode', async () => {
      options = { ...options, requireCredentials: true };
      secretCrud.findByIdRaw.mockRejectedValue(new Error('vault unreachable'));
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'https://private.example.com/repo.git',
        credentialsSecretId: SECRET_ID,
      });

      await expect(
        resolver.resolveHttpsCredentials(binding),
      ).rejects.toBeInstanceOf(CredentialResolutionError);

      const failed = findEmitted('gitops.credentials.failed');
      expect(failed).toBeDefined();
      expect(failed?.payload).toMatchObject({
        bindingId: BINDING_ID,
        secretId: SECRET_ID,
      });
    });

    it('returns null (does not throw) when strict mode is OFF', async () => {
      secretCrud.findByIdRaw.mockRejectedValue(new Error('vault unreachable'));
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'https://private.example.com/repo.git',
        credentialsSecretId: SECRET_ID,
      });

      const result = await resolver.resolveHttpsCredentials(binding);

      expect(result).toBeNull();
      const failed = findEmitted('gitops.credentials.failed');
      expect(failed).toBeDefined();
      expect(failed?.payload).toMatchObject({
        bindingId: BINDING_ID,
        secretId: SECRET_ID,
      });
      // The reason label must NOT include the underlying
      // error message (which could conceivably mention the
      // credential value).
      const reason = failed?.payload['reason'];
      const reasonString = typeof reason === 'string' ? reason : '';
      expect(reasonString).not.toContain('vault unreachable');
    });
  });

  describe('in-memory cache', () => {
    it('does not re-call findByIdRaw within the TTL and emits cached=true', async () => {
      options = { ...options, ttlMs: 60_000 };
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username: 'octocat',
          token: 'ghp_first',
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      const first = await resolver.resolveHttpsCredentials(binding);
      const second = await resolver.resolveHttpsCredentials(binding);

      expect(first).toEqual(second);
      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(1);

      const resolvedCalls = eventLedger.emitBestEffort.mock.calls.filter(
        ([params]) => params.eventName === 'gitops.credentials.resolved',
      );
      expect(resolvedCalls.length).toBe(2);
      expect(resolvedCalls[0]?.[0].payload['cached']).toBe(false);
      expect(resolvedCalls[1]?.[0].payload['cached']).toBe(true);
    });

    it('re-fetches after TTL expiry and emits cached=false', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      options = { ...options, ttlMs: 1_000 };
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username: 'octocat',
          token: 'ghp_first',
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      await resolver.resolveHttpsCredentials(binding);

      vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
      await resolver.resolveHttpsCredentials(binding);

      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(2);
      const resolvedCalls = eventLedger.emitBestEffort.mock.calls.filter(
        ([params]) => params.eventName === 'gitops.credentials.resolved',
      );
      expect(resolvedCalls.length).toBe(2);
      expect(resolvedCalls[0]?.[0].payload['cached']).toBe(false);
      expect(resolvedCalls[1]?.[0].payload['cached']).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('strict mode', () => {
    it('throws CredentialResolutionError for missing secretId on a non-anonymous-allowed host', async () => {
      options = { ...options, requireCredentials: true };
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'https://private.example.com/repo.git',
        credentialsSecretId: null,
      });

      await expect(
        resolver.resolveHttpsCredentials(binding),
      ).rejects.toBeInstanceOf(CredentialResolutionError);

      const missing = findEmitted('gitops.credentials.missing');
      expect(missing?.payload).toMatchObject({
        bindingId: BINDING_ID,
        url: binding.repoUrl,
        reason: 'require_credentials_for_host',
      });
    });

    it('does not throw for missing secretId on an anonymous-allowed host', async () => {
      options = { ...options, requireCredentials: true };
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'https://github.com/octocat/hello.git',
        credentialsSecretId: null,
      });

      const result = await resolver.resolveHttpsCredentials(binding);

      expect(result).toBeNull();
      const missing = findEmitted('gitops.credentials.missing');
      expect(missing).toBeDefined();
      // No reason label: anonymous mode against an allowed host
      // is a normal, non-strict-mode event.
      expect(missing?.payload['reason']).toBeUndefined();
    });
  });

  describe('telemetry payload sanitisation', () => {
    it('never includes the credential value in any emitted event', async () => {
      const password = 'should-never-leak-supersecret';
      const username = 'should-never-leak-username';
      const sshKey = 'should-never-leak-private-key-blob';
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username,
          password,
          sshPrivateKey: sshKey,
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({ credentialsSecretId: SECRET_ID });

      await resolver.resolveHttpsCredentials(binding);

      for (const call of eventLedger.emitBestEffort.mock.calls) {
        const serialised = JSON.stringify(call);
        expect(serialised).not.toContain(password);
        expect(serialised).not.toContain(username);
        expect(serialised).not.toContain(sshKey);
      }
    });

    it('also redacts the resolved credential in failure events', async () => {
      const password = 'fail-mode-password-should-not-leak';
      secretCrud.findByIdRaw.mockResolvedValue({
        id: SECRET_ID,
        decryptedValue: JSON.stringify({
          username: 'octocat',
          password,
          // Deliberately HTTPS-shaped but the caller will
          // ask for SSH so the shape-mismatch path fires.
        }),
      });
      resolver = await buildResolver();
      const binding = buildBinding({
        repoUrl: 'git@github.com:octocat/hello.git',
        credentialsSecretId: SECRET_ID,
      });

      await resolver.resolveSshPrivateKey(binding);

      for (const call of eventLedger.emitBestEffort.mock.calls) {
        const serialised = JSON.stringify(call);
        expect(serialised).not.toContain(password);
      }
    });
  });

  describe('clearCache', () => {
    it('removes only the requested secretId entry', async () => {
      options = { ...options, ttlMs: 60_000 };
      secretCrud.findByIdRaw.mockImplementation(async (id: string) => ({
        id,
        decryptedValue: JSON.stringify({ username: 'u', token: 'p' }),
      }));
      resolver = await buildResolver();
      const bindingA = buildBinding({
        id: 'binding-a',
        credentialsSecretId: 'secret-a',
      });
      const bindingB = buildBinding({
        id: 'binding-b',
        credentialsSecretId: 'secret-b',
      });

      await resolver.resolveHttpsCredentials(bindingA);
      await resolver.resolveHttpsCredentials(bindingB);
      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(2);

      resolver.clearCache('secret-a');

      await resolver.resolveHttpsCredentials(bindingA);
      await resolver.resolveHttpsCredentials(bindingB);
      // bindingA was uncached -> re-fetched. bindingB still cached.
      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(3);
      expect(secretCrud.findByIdRaw).toHaveBeenNthCalledWith(3, 'secret-a');
    });

    it('clears all entries when called with no argument', async () => {
      options = { ...options, ttlMs: 60_000 };
      secretCrud.findByIdRaw.mockImplementation(async (id: string) => ({
        id,
        decryptedValue: JSON.stringify({ username: 'u', token: 'p' }),
      }));
      resolver = await buildResolver();
      const bindingA = buildBinding({
        id: 'binding-a',
        credentialsSecretId: 'secret-a',
      });
      const bindingB = buildBinding({
        id: 'binding-b',
        credentialsSecretId: 'secret-b',
      });

      await resolver.resolveHttpsCredentials(bindingA);
      await resolver.resolveHttpsCredentials(bindingB);
      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(2);

      resolver.clearCache();

      await resolver.resolveHttpsCredentials(bindingA);
      await resolver.resolveHttpsCredentials(bindingB);
      expect(secretCrud.findByIdRaw).toHaveBeenCalledTimes(4);
    });
  });
});
