import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { chmod, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitOpsCredentialsResolver } from './gitops-credentials-resolver.service';
import { isSshUrl } from './gitops-credentials-resolver.helpers';
import type {
  BuildInvocationInput,
  GitInvocation,
} from './gitops-invocation-builder.types';

/**
 * Default ssh flags used for authenticated git-over-SSH
 * invocations. Mirrors the project's existing
 * "non-interactive, accept-new host key, only the supplied
 * key" contract so the resolver output slots in cleanly next
 * to any anonymous SSH fallback the loader may still take.
 */
const DEFAULT_SSH_FLAGS = [
  '-o',
  'IdentitiesOnly=yes',
  '-o',
  'StrictHostKeyChecking=accept-new',
  '-o',
  'BatchMode=yes',
] as const;

/**
 * Per-invocation temp file handle for an SSH private key.
 *
 * The builder allocates a fresh file per call so a single
 * leaked process listing or coredump cannot exfiltrate the
 * key across invocations. The file is unlinked via the
 * `GitInvocation.cleanup` hook in a `finally` block at the
 * call site.
 */
interface SshKeyTempFile {
  filePath: string;
  cleanup: () => Promise<void>;
}

/**
 * Builds a credential-aware git invocation for a given
 * `GitOpsRepositoryBinding`. Shared by
 * `GitOpsOutboundSyncService` (push) and
 * `DesiredStateLoaderService` (inbound fetch/clone) so the
 * auth contract is defined in exactly one place.
 *
 * Behaviour:
 *
 * 1. **SSH URL** (`git@host:...` or `ssh://...`):
 *    - Calls `GitOpsCredentialsResolver.resolveSshPrivateKey`.
 *    - On success, writes the key to a 0600 temp file under
 *      `os.tmpdir()`, sets `GIT_SSH_COMMAND` to point at
 *      the file with the project's standard SSH flags, and
 *      returns a `GitInvocation` whose `cleanup` hook
 *      unlinks the file.
 *    - When no key is available (anonymous mode / strict
 *      mode OFF) the builder proceeds with the caller-supplied
 *      `args` unchanged; the network layer will fail, which
 *      is the desired behaviour for a binding that explicitly
 *      has no secret.
 *
 * 2. **HTTPS URL**:
 *    - Calls `GitOpsCredentialsResolver.resolveHttpsCredentials`.
 *    - On success, builds `GIT_CONFIG_*` env entries
 *      (matching the existing `buildGitAuthEnv` pattern used
 *      elsewhere in the codebase) so the resolved
 *      `username:password` pair is delivered as an
 *      `http.extraHeader` `Authorization: Basic ...` value
 *      and never appears in process listings or in the
 *      command-line arguments. The empty-username case
 *      (token-only) uses `x-access-token:<password>` as the
 *      Basic auth user — same convention as the existing
 *      `git-auth-env.helpers` builder.
 *    - When no credentials are available, the builder
 *      proceeds anonymously as today, with
 *      `GIT_TERMINAL_PROMPT=0` to keep git non-interactive
 *      in non-tty contexts.
 *
 * 3. **Credential values are NEVER logged or thrown** by
 *    this class. The resolver emits its own typed
 *    `CredentialResolutionError` in strict mode; the
 *    builder simply propagates that error to the caller
 *    without copying the resolved value into any log line,
 *    error message, or telemetry payload.
 */
@Injectable()
export class GitOpsInvocationBuilder {
  private readonly logger = new Logger(GitOpsInvocationBuilder.name);

  constructor(private readonly resolver: GitOpsCredentialsResolver) {}

  /**
   * Build a credential-aware git invocation for the given
   * binding + argument list. The returned `GitInvocation`
   * carries a `cleanup` hook the caller MUST await (typically
   * in a `finally` block) so the SSH temp file is always
   * unlinked, even when the downstream git command throws.
   */
  async build(input: BuildInvocationInput): Promise<GitInvocation> {
    const baseEnv = this.buildBaseEnv();
    const emptyCleanup = (): Promise<void> => Promise.resolve();

    if (isSshUrl(input.binding.repoUrl)) {
      const key = await this.resolver.resolveSshPrivateKey(input.binding);
      if (key === null) {
        return {
          args: input.args,
          cwd: input.cwd,
          env: baseEnv,
          cleanup: emptyCleanup,
        };
      }
      const tempFile = await this.writeSshKeyTempFile(key);
      return {
        args: input.args,
        cwd: input.cwd,
        env: {
          ...baseEnv,
          GIT_SSH_COMMAND: this.buildSshCommand(tempFile.filePath),
        },
        cleanup: tempFile.cleanup,
      };
    }

    const credentials = await this.resolver.resolveHttpsCredentials(
      input.binding,
    );
    if (credentials === null) {
      return {
        args: input.args,
        cwd: input.cwd,
        env: baseEnv,
        cleanup: emptyCleanup,
      };
    }
    return {
      args: input.args,
      cwd: input.cwd,
      env: {
        ...baseEnv,
        ...buildGitHttpsAuthEnv(credentials.username, credentials.password),
      },
      cleanup: emptyCleanup,
    };
  }

  private buildBaseEnv(): NodeJS.ProcessEnv {
    return {
      // Always non-interactive — keep prompts from
      // accidentally leaking into a non-tty reconcile tick.
      GIT_TERMINAL_PROMPT: '0',
    };
  }

  private buildSshCommand(tempFilePath: string): string {
    return ['ssh', '-i', tempFilePath, ...DEFAULT_SSH_FLAGS].join(' ');
  }

  private async writeSshKeyTempFile(key: string): Promise<SshKeyTempFile> {
    const fileName = `nexus-gitops-ssh-${randomUUID()}.key`;
    const filePath = path.join(tmpdir(), fileName);
    await writeFile(filePath, key, { encoding: 'utf8', mode: 0o600 });
    // Defensive: on platforms where `writeFile` ignores the
    // `mode` (e.g. when the file already exists) explicitly
    // chmod to 0600 so the key file is owner-readable only.
    await chmod(filePath, 0o600);
    return {
      filePath,
      cleanup: async (): Promise<void> => {
        try {
          await unlink(filePath);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT') {
            return;
          }
          this.logger.warn(
            `Failed to unlink SSH key temp file ${filePath}: ${code ?? 'unknown'}`,
          );
        }
      },
    };
  }
}

/**
 * Build the `GIT_CONFIG_*` env triple that delivers HTTPS
 * credentials to git without ever exposing the token as a
 * command-line argument.
 *
 * The pattern matches `buildGitAuthEnv` in
 * `apps/api/src/common/git/git-auth-env.helpers.ts` so the
 * resolver output and the existing project-wide auth-env
 * helper share a single encoding contract.
 */
export function buildGitHttpsAuthEnv(
  username: string,
  password: string,
): NodeJS.ProcessEnv {
  const authUser = username.length > 0 ? username : 'x-access-token';
  const encoded = Buffer.from(`${authUser}:${password}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  };
}
