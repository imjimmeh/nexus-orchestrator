# GitOps Architecture

The GitOps subsystem reconciles Nexus configuration against
declarative YAML manifests in a remote git repository. A
`GitOpsRepositoryBinding` (per-scope row) records the
repository URL, the ref to track, the sync mode, and the
`credentialsSecretId` that authenticates the remote.

This document covers the credential-resolution subsystem
introduced by WI-2026-061. For the broader reconciliation
loop and reconciliation data model, see
`docs/architecture/workflow-driven-kanban-policy-boundary.md`
and the probe report at
`docs/project-context/probe-results/gitops-desired-state-and-sync.md`.

## Module Surface

- `apps/api/src/gitops/gitops.module.ts` — NestJS module.
  Registers the `GITOPS_CREDENTIALS_OPTIONS` provider, the
  resolver, and the credential-aware invocation builder.
- `apps/api/src/gitops/gitops-credentials-resolver.service.ts` —
  `GitOpsCredentialsResolver`. Resolves HTTPS basic-auth /
  token or SSH private-key credentials for a binding through
  `SecretCrudService.findByIdRaw`, with a TTL cache. Emits
  `gitops.credentials.resolved` / `gitops.credentials.missing`
  / `gitops.credentials.failed` telemetry events.
- `apps/api/src/gitops/gitops-credentials-resolver.helpers.ts` —
  Pure classification + coercion helpers (`isSshUrl`,
  `extractHost`, `inferSecretKind`, `toHttpsCredentials`,
  `toSshPrivateKey`, ...).
- `apps/api/src/gitops/gitops-invocation-builder.ts` —
  `GitOpsInvocationBuilder`. Shared by the inbound
  `DesiredStateLoaderService` and the outbound
  `GitOpsOutboundSyncService`. Builds a credential-aware
  `{ args, cwd, env, cleanup }` plan for a single `git`
  invocation. The cleanup hook unlinks per-invocation SSH
  key temp files (0600) created in `os.tmpdir()`.
- `apps/api/src/gitops/gitops-outbound-sync.service.ts` —
  Outbound push. Routes every `git` invocation through
  `runCredentialedGit` so credentials are injected on
  fetch, reset, checkout, add, commit, and push.
- `apps/api/src/gitops/desired-state-loader.service.ts` —
  Inbound fetch/clone. Takes optional binding metadata on
  its `LoadDesiredStateInput` and routes git through the
  invocation builder when present.

## Credential Auth Contract

For every credentialed git operation:

1. **SSH URLs** (`git@host:...` or `ssh://...`):
   `GitOpsCredentialsResolver.resolveSshPrivateKey(binding)`
   returns the decrypted private key string. The builder
   writes it to a 0600 temp file under `os.tmpdir()`, sets
   `GIT_SSH_COMMAND="ssh -i <tempfile> -o IdentitiesOnly=yes
   -o StrictHostKeyChecking=accept-new -o BatchMode=yes"`,
   and unlinks the file in a `finally` block.
2. **HTTPS URLs**:
   `GitOpsCredentialsResolver.resolveHttpsCredentials(binding)`
   returns `{ username, password }`. The builder encodes them
   as Basic auth and injects them via `GIT_CONFIG_COUNT=1`,
   `GIT_CONFIG_KEY_0=http.extraHeader`,
   `GIT_CONFIG_VALUE_0=Authorization: Basic <b64>`. The
   token is never put on the command line.
3. **Anonymous mode** (no `credentialsSecretId` AND strict
   mode OFF): the builder returns the caller-supplied
   arguments unchanged, with `GIT_TERMINAL_PROMPT=0` to keep
   git non-interactive.

Credential values are NEVER logged. They are NEVER included
in thrown error messages. They are NEVER persisted to disk
beyond the lifetime of a single `git` invocation.

## Configuration

The resolver is configured via three environment variables
read off `process.env` by
`buildGitOpsCredentialsOptionsFromEnv` in
`apps/api/src/gitops/gitops.module.ts`:

| Env var                          | Default                                  | Effect                                                                                                                                  |
| -------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GITOPS_REQUIRE_CREDENTIALS`     | `false`                                  | When `'true'` / `'1'`, missing or unresolvable credentials against a non-anonymous-allowed host throw a typed `CredentialResolutionError`. |
| `GITOPS_ANONYMOUS_ALLOWED_HOSTS` | `github.com,gitlab.com,bitbucket.org`    | Comma-separated host list that is allowed to operate anonymously even when `GITOPS_REQUIRE_CREDENTIALS=true`. Compared lower-case.    |
| `GITOPS_CREDENTIALS_TTL_MS`      | `60000`                                  | In-memory cache TTL (in ms) for resolved secret values, keyed by secret ID. `0` disables caching.                                       |

### Security Tradeoff

- **`GITOPS_REQUIRE_CREDENTIALS=false` (default)**: missing
  credentials are tolerated. Public-host bindings (e.g.
  `github.com`) work without a secret; private-host
  bindings silently fail at the network layer. Operators
  must inspect the `gitops.credentials.missing` and
  `gitops.credentials.failed` telemetry events to detect
  misconfigured bindings. Suitable for dev and for
  deployments where the operator curates bindings
  out-of-band.
- **`GITOPS_REQUIRE_CREDENTIALS=true`**: any binding that
  targets a non-anonymous-allowed host without a resolvable
  `credentialsSecretId` is rejected with a typed
  `CredentialResolutionError` BEFORE the `git` CLI is
  invoked. The reconcile run is marked `failed` and the
  operator gets a deterministic error rather than a
  silent anonymous-clone. Recommended for production
  deployments where any silent fallback is a security
  regression.

The `gitops.credentials.failed` event payload never carries
the credential value, the resolved password, the SSH key, or
the raw secret-store error message body — only the
`reason` label (e.g. `unrecognised_secret_shape`,
`require_credentials_for_host`).

## Acceptance Criteria Coverage

- AC-1 (resolver exists with HTTPS + SSH resolution and
  60s cache): implemented in Milestone 1 at
  `gitops-credentials-resolver.service.ts`.
- AC-2 (Outbound push + Inbound fetch/clone consume the
  resolver): implemented in Milestone 2 via
  `GitOpsInvocationBuilder` and the
  `runCredentialedGit` helpers in
  `GitOpsOutboundSyncService` and
  `DesiredStateLoaderService`.
- AC-3 (`GITOPS_REQUIRE_CREDENTIALS` strict mode, default
  `false`, documented here): implemented in Milestone 2.
- AC-4 (telemetry events): emitted by
  `GitOpsCredentialsResolver` (Milestone 1).
- AC-5 (tests pass): `gitops-credentials-resolver`,
  `gitops-outbound-sync`, `gitops-inbound-reconcile`,
  `gitops-invocation-builder`, and
  `desired-state-loader` unit tests all pass.
- AC-6 (DTO and entity docs mark `credentialsSecretId` as
  load-bearing): updated in
  `gitops-repository-binding.entity.ts` and
  `gitops-repository-binding.dto.ts` in Milestone 2.
- AC-7 (OPEN_QUESTIONS G7 resolved): closed in Milestone 3.
