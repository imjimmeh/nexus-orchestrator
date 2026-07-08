/**
 * End-to-end integration test for the GitOps credential
 * resolution → invocation builder → real `git` push pipeline.
 *
 * Work item: WI-2026-061 (consume `credentialsSecretId`).
 * Acceptance criterion AC-5: "the integration test against a local
 * bare git repo asserts end-to-end credential delivery".
 *
 * Scope:
 *   Wires the real `GitOpsCredentialsResolver` (Milestone 1) and
 *   the real `GitOpsInvocationBuilder` (Milestone 2) with a
 *   mocked `SecretCrudService` (returns a `{ username, password }`
 *   JSON secret), a mocked `EventLedgerService` (captures every
 *   `emitBestEffort` call), and a hard-coded strict-mode options
 *   payload. The test then runs `git` against a freshly-initialised
 *   bare repository on local disk and verifies that:
 *
 *     (a) the resolver fetches the secret via the mocked
 *         `SecretCrudService.findByIdRaw` (cache miss on first
 *         call, `gitops.credentials.resolved` event emitted with
 *         `bindingId` and `secretKind: 'https'`),
 *     (b) the builder emits `GIT_CONFIG_KEY_0=http.extraHeader`
 *         and a base64-encoded `GIT_CONFIG_VALUE_0` carrying
 *         `<username>:<password>` so the credential never appears
 *         as a command-line argument,
 *     (c) a real `git push` to the local bare repo succeeds (the
 *         transport does not consume the http auth header, but
 *         the credential env vars are applied to the git process
 *         and inherited by the bare repo's `post-update` hook),
 *     (d) the bare repo's `post-update` hook fires AND records
 *         `GIT_CONFIG_VALUE_0` in its log file — proving the
 *         credential env var reached the git subprocess and the
 *         push succeeded end-to-end.
 *
 * The test is intentionally hermetic: it uses a real `git` binary
 * on PATH plus an on-disk bare repo under `os.tmpdir()` and never
 * opens a network socket. When the host has no `git` on PATH the
 * `describe` block is skipped via `describe.skipIf(!gitAvailable)`.
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventLedgerService } from '../observability/event-ledger.service';
import { SecretCrudService } from '../security/services/secret-crud.service';
import type { GitOpsRepositoryBinding } from './database/entities/gitops-repository-binding.entity';
import {
  GITOPS_CREDENTIALS_OPTIONS,
  GitOpsCredentialsResolver,
} from './gitops-credentials-resolver.service';
import type { GitOpsCredentialsOptions } from './gitops-credentials-resolver.service.types';
import { GitOpsInvocationBuilder } from './gitops-invocation-builder';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// git availability probe
// ---------------------------------------------------------------------------
//
// We probe `git --version` at module load so the `describe` block can
// be skipped cleanly in CI containers without a `git` binary on
// PATH. The skip is intentional: the work item AC allows the test
// to be a graceful no-op in environments without git.

let gitAvailable = false;
let gitSkipReason = '';
try {
  execFileSync('git', ['--version'], { stdio: 'pipe' });
  gitAvailable = true;
} catch (error) {
  gitSkipReason = error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const SECRET_ID = '00000000-0000-0000-0000-000000000001';
const BINDING_ID = 'binding-1';
const USERNAME = 'gitops-it-user';
const PASSWORD = 'gitops-it-token-abc123';

function buildBinding(repoUrl: string): GitOpsRepositoryBinding {
  return {
    id: BINDING_ID,
    scopeNodeId: '00000000-0000-0000-0000-000000000002',
    name: 'integration',
    repoUrl,
    defaultRef: 'main',
    rootPath: '.',
    syncMode: 'two_way',
    credentialsSecretId: SECRET_ID,
    enabled: true,
    includedObjectTypes: ['workflow'],
    conflictPolicy: 'require_review',
    lastAppliedRevision: null,
    createdByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe.skipIf(!gitAvailable)(
  'GitOpsOutboundSyncService credential delivery (integration)',
  () => {
    let moduleRef: TestingModule;
    let resolver: GitOpsCredentialsResolver;
    let builder: GitOpsInvocationBuilder;
    let eventLedger: { emitBestEffort: ReturnType<typeof vi.fn> };
    let secretCrud: { findByIdRaw: ReturnType<typeof vi.fn> };

    let tmpDir: string;
    let bareRepoPath: string;
    let workRepoPath: string;
    let hookLogPath: string;
    const defaultBranch = 'main';

    beforeAll(async () => {
      eventLedger = {
        emitBestEffort: vi.fn().mockResolvedValue(undefined),
      };
      secretCrud = {
        findByIdRaw: vi.fn().mockResolvedValue({
          id: SECRET_ID,
          decryptedValue: JSON.stringify({
            username: USERNAME,
            password: PASSWORD,
          }),
        }),
      };

      const options: GitOpsCredentialsOptions = {
        requireCredentials: true,
        ttlMs: 60_000,
        anonymousAllowedHosts: [],
      };

      moduleRef = await Test.createTestingModule({
        providers: [
          GitOpsCredentialsResolver,
          GitOpsInvocationBuilder,
          { provide: SecretCrudService, useValue: secretCrud },
          { provide: EventLedgerService, useValue: eventLedger },
          { provide: GITOPS_CREDENTIALS_OPTIONS, useValue: options },
        ],
      }).compile();
      resolver = moduleRef.get(GitOpsCredentialsResolver);
      builder = moduleRef.get(GitOpsInvocationBuilder);

      tmpDir = await mkdtemp(path.join(tmpdir(), 'gitops-it-'));
      bareRepoPath = path.join(tmpDir, 'bare.git');
      workRepoPath = path.join(tmpDir, 'work');
      hookLogPath = path.join(tmpDir, 'hook.log');

      // Init the bare repo (no working tree).
      execFileSync('git', ['init', '--bare', bareRepoPath], { stdio: 'pipe' });

      // Install a `post-update` hook that records every push and
      // dumps the GIT_CONFIG_VALUE_0 env var it inherited from the
      // parent git process. The dump proves that the credential
      // env var emitted by `GitOpsInvocationBuilder` reached the
      // git subprocess (and therefore would have been sent to any
      // http(s) transport git might use).
      // Note: `$GIT_CONFIG_VALUE_0` is intentionally NOT escaped.
      // In a JS template literal, `$` is only special when followed
      // by `{` — the shell will expand `$GIT_CONFIG_VALUE_0` at
      // hook execution time from the inherited git-process env.
      const hookScript = [
        '#!/bin/sh',
        // The hook receives the updated ref names as positional
        // args; append them so each invocation is uniquely logged.
        `printf 'post-update fired for %s\\n' "$*" >> "${hookLogPath}"`,
        `printf 'GIT_CONFIG_VALUE_0=%s\\n' "$GIT_CONFIG_VALUE_0" >> "${hookLogPath}"`,
        '',
      ].join('\n');
      await mkdir(path.join(bareRepoPath, 'hooks'), { recursive: true });
      await writeFile(
        path.join(bareRepoPath, 'hooks', 'post-update'),
        hookScript,
        { mode: 0o755 },
      );

      // Init the working tree with an explicit branch name so the
      // test is independent of `init.defaultBranch` (which differs
      // between git versions).
      execFileSync('git', ['init', '-b', defaultBranch, workRepoPath], {
        stdio: 'pipe',
      });
      execFileSync(
        'git',
        [
          '-C',
          workRepoPath,
          '-c',
          'user.email=integration@test.local',
          '-c',
          'user.name=GitOps Integration',
          'commit',
          '--allow-empty',
          '-m',
          'initial',
        ],
        { stdio: 'pipe' },
      );
      execFileSync(
        'git',
        ['-C', workRepoPath, 'remote', 'add', 'origin', bareRepoPath],
        { stdio: 'pipe' },
      );
      // Seed the bare repo so the post-update hook fires at least
      // once before the credentialed test push (sanity).
      execFileSync(
        'git',
        ['-C', workRepoPath, 'push', '-u', 'origin', defaultBranch],
        { stdio: 'pipe' },
      );
    });

    afterAll(async () => {
      if (moduleRef) {
        await moduleRef.close();
      }
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
      vi.clearAllMocks();
    });

    it('delivers resolved HTTPS credentials end-to-end through a real git push', async () => {
      // We bind to an https:// URL even though the actual push
      // target is the local bare repo path. The URL is only used
      // by `GitOpsCredentialsResolver` to classify the binding as
      // HTTPS-shaped (and therefore route through the
      // `resolveHttpsCredentials` path). The real git command
      // arguments are supplied separately so the local-path push
      // succeeds without a network.
      const binding = buildBinding(
        'https://gitops-integration.example.com/repo.git',
      );

      // (1) Resolve HTTPS credentials via the real resolver.
      const credentials = await resolver.resolveHttpsCredentials(binding);
      expect(credentials).toEqual({ username: USERNAME, password: PASSWORD });

      // (2) Confirm the resolver fetched the secret from the
      // secret store with the configured secret ID.
      expect(secretCrud.findByIdRaw).toHaveBeenCalledWith(SECRET_ID);

      // (3) Build the credentialed invocation via the real
      // builder. The args/cwd point at the local bare repo so the
      // push can actually succeed in a hermetic environment.
      const invocation = await builder.build({
        binding,
        args: ['push', 'origin', defaultBranch],
        cwd: workRepoPath,
      });

      try {
        // (4) The builder must inject GIT_CONFIG_* env vars
        // matching the existing project-wide auth-env contract.
        expect(invocation.env['GIT_CONFIG_KEY_0']).toBe('http.extraHeader');
        const headerValue = invocation.env['GIT_CONFIG_VALUE_0'];
        expect(headerValue).toMatch(/^Authorization: Basic /);

        const expectedBasic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString(
          'base64',
        );
        expect(headerValue).toBe(`Authorization: Basic ${expectedBasic}`);

        // The credential value must never appear in the args.
        expect(invocation.args.join(' ')).not.toContain(PASSWORD);
        expect(invocation.args.join(' ')).not.toContain(USERNAME);

        // (5) Create a second commit so the push updates the bare
        // repo's refs (the post-update hook fires only on ref
        // changes).
        execFileSync(
          'git',
          [
            '-C',
            workRepoPath,
            '-c',
            'user.email=integration@test.local',
            '-c',
            'user.name=GitOps Integration',
            'commit',
            '--allow-empty',
            '-m',
            'integration-test-push',
          ],
          { stdio: 'pipe' },
        );

        // (6) Execute the push with REAL git using the
        // credential-augmented env. The local-path push does not
        // consume the http auth header, but the env is applied to
        // the git process and inherited by the post-update hook.
        await execFileAsync('git', ['-C', invocation.cwd, ...invocation.args], {
          env: { ...process.env, ...invocation.env },
          maxBuffer: 16 * 1024 * 1024,
        });
      } finally {
        await invocation.cleanup();
      }

      // (7) Verify the post-update hook fired AND that it observed
      // the GIT_CONFIG_VALUE_0 env var (the credential-injection
      // proof). The hook's env is the git subprocess's env, which
      // is the env built by the resolver → builder pipeline.
      const hookLog = await readFile(hookLogPath, 'utf8');
      const expectedBasic = Buffer.from(`${USERNAME}:${PASSWORD}`).toString(
        'base64',
      );
      expect(hookLog).toContain('post-update fired');
      expect(hookLog).toContain(
        `GIT_CONFIG_VALUE_0=Authorization: Basic ${expectedBasic}`,
      );

      // (8) Verify the EventLedgerService emitted the resolved
      // event with the expected payload.
      const resolvedCall = eventLedger.emitBestEffort.mock.calls
        .map(([params]) => params)
        .find((params) => params?.eventName === 'gitops.credentials.resolved');
      expect(resolvedCall).toBeDefined();
      const payload = (
        resolvedCall as { payload?: Record<string, unknown> } | undefined
      )?.payload;
      expect(payload?.['bindingId']).toBe(BINDING_ID);
      expect(payload?.['secretKind']).toBe('https');
      expect(typeof payload?.['emittedAt']).toBe('string');
    });
  },
);
