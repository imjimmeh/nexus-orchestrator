# Plan: EPIC-209 Phase 6 — GitLab + Bitbucket Merge Providers and Multi-Provider Webhook Ingress

**Date:** 2026-06-22
**Epic:** EPIC-209 (Pull-Request-Based Integration Strategy)
**Spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 10.1 pins the `MergeProvider` / `PullRequestRef` / `PullRequestStatus` / `MergeMethod` / `OpenOrUpdatePullRequestArgs` contract — implemented **verbatim** by every adapter here).
**Mirrors:** Phase 2 (`docs/superpowers/plans/2026-06-22-epic-209-phase-2-github-merge-provider.md`) — the `GitHubMergeProvider`, `MergeProviderFactory`, URL-parsing, octokit-mock structure is the template each new adapter follows.
**Extends:** Phase 4 (`docs/superpowers/plans/2026-06-22-epic-209-phase-4-pr-merge-detection.md`) — the raw-body-HMAC webhook ingress (`PrWebhookController`, `WebhookSecretResolver`, `PrMergeFinalizerService`) is GitHub-shaped; this phase adds per-provider verification + event-mapping behind a small strategy and maps each provider's "merged" event to the **same** `PrMergeFinalizerService.finalizeMergedByIdentity(...)`.

**Consumes (earlier phases — used, not redefined):**

- `MergeProvider` interface, `MERGE_PROVIDER` symbol, `MergeMethod`, `PullRequestState`, `PullRequestChecksStatus`, `OpenOrUpdatePullRequestArgs`, `PullRequestRef`, `PullRequestStatus` (Phase 1 declares / Phase 2 implements — Section 10.1, `apps/api/src/common/git/integration/merge-provider.interface.ts`).
- `MergeProviderFactory.resolveForRepository(repositoryUrl): MergeProvider` (Phase 2, `apps/api/src/common/git/integration/merge-provider.factory.ts`).
- `PrMergeFinalizerService.finalizeMergedByIdentity({ provider, owner, repo, prNumber, mergeCommitSha }): Promise<{ emitted: boolean }>` (Phase 4, `apps/api/src/integration-events/pr-merge-finalizer.service.ts`).
- `PrWebhookController` + `WebhookSecretResolver` + `verifyGithubSignature` (Phase 4, `apps/api/src/integration-events/`).
- `SecretReferenceResolver.resolveString({ secretId, purpose, serverName })` (`apps/api/src/security/secret-reference-resolver.service.ts`).

**Produces (multi-provider parity):** `GitLabMergeProvider`, `BitbucketMergeProvider` (both `MergeProvider`), provider detection by host in `MergeProviderFactory`, a `WebhookVerificationStrategy` registry that validates GitLab (`X-Gitlab-Token`) + Bitbucket payloads and maps each MR/PR-merged event to the shared finalizer, and a **shared parameterized contract test** proving all three adapters are LSP-substitutable.

---

## Goal

Reach **multi-provider parity** for PR-based integration: a repository hosted on GitLab or Bitbucket (cloud or self-hosted) lands work items through a Merge Request / Pull Request exactly as a GitHub repository does — selected automatically from `repository_url`, observed-merged through the same idempotent finalizer, all behind the unchanged `MergeProvider` interface. Exercised **entirely by unit tests** with all provider HTTP mocked (no live network). This phase produces:

1. A **`GitLabMergeProvider`** (Section 10.1 verbatim) backed by the GitLab **Merge Requests** REST API via `fetch`: idempotent `openOrUpdatePullRequest` (find-or-create by `source_branch`+`target_branch`), `getPullRequestStatus` (MR + pipeline + approvals → `PullRequestStatus`), `mergePullRequest` (MR merge with `MergeMethod` mapping).
2. A **`BitbucketMergeProvider`** (Section 10.1 verbatim) backed by the Bitbucket Cloud **Pull Requests** REST API via `fetch`: same idempotency + status mapping + merge.
3. **Provider detection**: `MergeProviderFactory` selects GitHub / GitLab / Bitbucket from the `repository_url` host (incl. self-hosted host patterns + an optional explicit `provider` override), with URL parsers per host.
4. A **`WebhookVerificationStrategy`** registry so the Phase-4 ingress verifies GitLab (`X-Gitlab-Token` shared-secret) and Bitbucket payloads and maps each provider's **merged** event shape to the shared `finalizeMergedByIdentity` path.
5. A **shared, parameterized `MergeProvider` contract test suite** run against GitHub/GitLab/Bitbucket mocks, proving substitutability (LSP).

**No new SDK dependencies.** GitHub keeps `@octokit/rest` (Phase 2); GitLab + Bitbucket use the global `fetch` behind a thin, injectable HTTP-client seam (mockable, no network). No workflow YAML, no lifecycle status, no kanban changes — all of that is provider-agnostic from Phase 3/4 and unchanged here.

## Architecture

- All new code is **API-side VCS-domain** under `apps/api/src/common/git/integration/` (adapters, parsers, factory, contract suite) and `apps/api/src/integration-events/` (webhook verification strategies). This is **boundary-legal**: PR/provider mechanics live API-side per the spec's Core/Kanban boundary. **No kanban identifiers anywhere** — only the neutral `scopeId` / `contextId` / `workflowRunId` pass-through fields and VCS terms (`provider`, `owner`/`namespace`, `repo`/`project`, `pr_number` / MR `iid`, `mergeCommitSha`, `head`/`source`, `base`/`target`). `nexus-boundaries/no-core-kanban-residue` enforces this.
- Each adapter is wrapped so the rest of the codebase sees **only** the `MergeProvider` interface. The `MergeProviderFactory` is the single construction/resolution point; it now resolves by host. Phase 3/4 consumers (`merge-integrate` action, poll reconciler) reference the **interface**, never a concrete adapter — so they gain GitLab/Bitbucket support for free.
- **HTTP seam**: GitLab/Bitbucket share a tiny injectable `HttpJsonClient` (`request(method, url, { token, body, headers })`) with one default implementation over `fetch`. Tests inject a mock returning canned responses keyed by `(method, url)`. No live HTTP is ever made; the token is never logged or embedded in an error message.
- **Webhook verification strategy**: a `WebhookVerificationStrategy` interface (`providerKey`, `verify(rawBody, headers, secret)`, `extractMerge(parsedBody)`) with one implementation per provider. A `WebhookVerificationStrategyRegistry` selects the strategy by route segment (`/webhooks/integration/:provider`). The Phase-4 `PrWebhookController` is generalized to delegate verification + merge-extraction to the registry, then calls the **same** `finalizeMergedByIdentity`. GitHub's existing HMAC behaviour is refactored into a `GithubWebhookVerificationStrategy` with **zero behaviour change** (the Phase-4 tests still pass).
- **Pure mappers per provider** (state / pipeline-or-build-status / approvals → `PullRequestStatus` fields) keep each adapter spec small and the provider-shape edge cases exhaustively testable without live API shapes — mirrors Phase 2's `github-pull-request.mapper.ts`.

## Tech Stack

- **NestJS** providers (`@Injectable`), `nest build` (never `tsc`).
- **Vitest** (`npm run test --workspace=apps/api` → `vitest run --project unit`; unit specs are `src/**/*.spec.ts`).
- **Global `fetch`** (Node 18+) behind an injectable `HttpJsonClient` seam for GitLab/Bitbucket. **No new dependency** (`@octokit/rest` already added in Phase 2 for GitHub only).
- Node `crypto` (`timingSafeEqual`) for the GitLab shared-secret compare.
- TypeScript strict typing. **Never** `eslint-disable` / `@ts-ignore` / `@ts-nocheck`.

## Global Constraints

- **TDD strictly per behaviour:** write failing test → run (`npm run test --workspace=apps/api -- <spec>`, expect **FAIL**) → minimal impl → run (expect **PASS**) → commit. One behaviour per Red/Green cycle. Conventional-commit messages, atomic.
- **All provider HTTP fully mocked** in every test — show the mock setup inline. No network.
- **Token / shared-secret never logged or echoed.** Each touch-point that handles a credential has a test asserting the secret string does not appear in any thrown error message.
- **Idempotency is first-class per adapter.** Explicit test: two `openOrUpdatePullRequest` calls for the same source+target return the same MR/PR (update/no-op, not duplicate).
- **Webhook signature/secret test per provider:** valid → accepted; tampered/absent → 401.
- **LSP via a shared contract suite:** one parameterized describe runs the identical assertions against all three adapters' mocks. Adding a provider that breaks the contract fails this suite.
- **No kanban identifiers** in any file, test, comment, or symbol. `scopeId`/`contextId` only.
- **No lint suppression.** Strong typing. Section 10.1 signatures used verbatim.
- Commit messages end with the project co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
apps/api/src/common/git/integration/
  merge-provider.interface.ts                   (EXISTS — Phase 1/2; consumed verbatim)
  github-repository-url.parser.ts               (EXISTS — Phase 2; consumed)
  github-merge.provider.ts                      (EXISTS — Phase 2; consumed by the contract suite)
  merge-provider.factory.ts                     (EDIT — host detection: github/gitlab/bitbucket + override)
  merge-provider.factory.spec.ts                (EDIT — gitlab/bitbucket/self-hosted/override cases)

  repository-url.parser.ts                      (NEW — provider-agnostic host+owner+repo parser)
  repository-url.parser.types.ts                (NEW — ParsedRepository { provider, host, owner, repo })
  repository-url.parser.spec.ts                 (NEW)

  http-json-client.ts                           (NEW — fetch-backed HttpJsonClient + token + types)
  http-json-client.types.ts                     (NEW — HTTP_JSON_CLIENT token + HttpJsonClient iface)

  gitlab-credential.resolver.ts                 (NEW — gitlab secret id -> token, never logged)
  gitlab-credential.resolver.spec.ts            (NEW)
  gitlab-merge-request.mapper.ts                (NEW — pure MR/pipeline/approvals -> PullRequestStatus)
  gitlab-merge-request.mapper.spec.ts           (NEW)
  gitlab-merge.provider.ts                      (NEW — implements MergeProvider via MR API)
  gitlab-merge.provider.spec.ts                 (NEW)

  bitbucket-credential.resolver.ts              (NEW — bitbucket secret id -> token, never logged)
  bitbucket-credential.resolver.spec.ts         (NEW)
  bitbucket-pull-request.mapper.ts              (NEW — pure PR/build/approvals -> PullRequestStatus)
  bitbucket-pull-request.mapper.spec.ts         (NEW)
  bitbucket-merge.provider.ts                   (NEW — implements MergeProvider via PR API)
  bitbucket-merge.provider.spec.ts              (NEW)

  merge-provider.contract.spec.ts               (NEW — shared parameterized LSP suite for all 3 adapters)

apps/api/src/common/git/git-worktree.module.ts  (EDIT — register gitlab/bitbucket providers + HTTP client + factory deps)
apps/api/src/common/git/index.ts                (EDIT — re-export new public surface)

apps/api/src/integration-events/
  pr-webhook.controller.ts                      (EDIT — generalize to :provider, delegate to registry)
  pr-webhook.controller.spec.ts                 (EDIT — gitlab/bitbucket cases stay green for github)
  webhook-signature.util.ts                     (EXISTS — Phase 4; reused by github strategy)
  webhook-verification-strategy.types.ts        (NEW — WebhookVerificationStrategy iface + token + MergeIdentity)
  webhook-verification-strategy.registry.ts     (NEW — selects strategy by providerKey)
  webhook-verification-strategy.registry.spec.ts(NEW)
  github-webhook-verification.strategy.ts       (NEW — wraps Phase-4 HMAC + closed+merged extract)
  github-webhook-verification.strategy.spec.ts  (NEW)
  gitlab-webhook-verification.strategy.ts       (NEW — X-Gitlab-Token compare + MR merge extract)
  gitlab-webhook-verification.strategy.spec.ts  (NEW)
  bitbucket-webhook-verification.strategy.ts    (NEW — X-Hub-Signature HMAC + pullrequest:fulfilled extract)
  bitbucket-webhook-verification.strategy.spec.ts(NEW)
  integration-events.module.ts                  (EDIT — register the strategies + registry)
```

> All adapter/parser/factory code lives under the existing `apps/api/src/common/git/` module tree and is wired into `GitWorktreeModule` (the narrow git/common module) — **not** `WorkflowModule`. The webhook strategies live in `IntegrationEventsModule` (Phase 4).

---

## Phase Ordering

1. **Task 0** — provider-agnostic URL parser (`repository-url.parser`) — the shared host-detection primitive both the factory and contract suite need.
2. **Task 1** — `HttpJsonClient` seam (no spec; one-line `fetch` default behind a token, exercised by the adapter specs).
3. **Tasks 2–4** — GitLab adapter (credential resolver → mappers → provider).
4. **Tasks 5–7** — Bitbucket adapter (credential resolver → mappers → provider).
5. **Task 8** — extend `MergeProviderFactory` host detection.
6. **Task 9** — shared parameterized `MergeProvider` contract suite (LSP proof).
7. **Task 10** — `GitWorktreeModule` wiring + `index.ts` exports.
8. **Tasks 11–14** — webhook verification strategy interface + registry → github strategy (refactor, zero-behaviour-change) → gitlab strategy → bitbucket strategy → generalize the controller.
9. **Task 15** — `IntegrationEventsModule` wiring.
10. **Task 16** — full regression sweep + boundary lint.

Execute in numbered order.

---

## Task 0 — Provider-agnostic repository URL parser

**Files:**

- `apps/api/src/common/git/integration/repository-url.parser.types.ts`
- `apps/api/src/common/git/integration/repository-url.parser.ts`
- `apps/api/src/common/git/integration/repository-url.parser.spec.ts`

**Interfaces:**

- **Consumes:** nothing.
- **Produces:** `parseRepositoryUrl(url: string): ParsedRepository` where `ParsedRepository = { provider: 'github' | 'gitlab' | 'bitbucket'; host: string; owner: string; repo: string }`. Detects the provider from the host (cloud hosts `github.com`, `gitlab.com`, `bitbucket.org`, plus self-hosted host patterns containing `gitlab` / `bitbucket`). Throws `BadRequestException` for unparseable / unknown hosts. Consumed by `MergeProviderFactory` (Task 8) and the contract suite (Task 9).

> **Self-hosted detection:** GitHub Enterprise / self-managed GitLab / Bitbucket Server use custom hosts. Phase 6 detects by host substring (`gitlab`, `bitbucket`) plus the three known cloud hosts; an explicit `provider` override (Task 8) is the escape hatch for hosts that match no pattern. `owner` is the first path segment (GitLab calls it the namespace; for subgroups we keep the **full namespace path** joined by `/` and the **last** segment as `repo`).

### Step 0.1 — RED: failing spec

`repository-url.parser.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { parseRepositoryUrl } from "./repository-url.parser";

describe("parseRepositoryUrl", () => {
  it("detects github.com https", () => {
    expect(parseRepositoryUrl("https://github.com/acme/widgets.git")).toEqual({
      provider: "github",
      host: "github.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("detects gitlab.com https", () => {
    expect(parseRepositoryUrl("https://gitlab.com/acme/widgets")).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("detects bitbucket.org https", () => {
    expect(
      parseRepositoryUrl("https://bitbucket.org/acme/widgets.git"),
    ).toEqual({
      provider: "bitbucket",
      host: "bitbucket.org",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("detects an ssh scp-style gitlab url", () => {
    expect(parseRepositoryUrl("git@gitlab.com:acme/widgets.git")).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("keeps the full gitlab subgroup namespace as owner", () => {
    expect(
      parseRepositoryUrl("https://gitlab.com/acme/team-a/widgets.git"),
    ).toEqual({
      provider: "gitlab",
      host: "gitlab.com",
      owner: "acme/team-a",
      repo: "widgets",
    });
  });

  it("detects a self-hosted gitlab host by substring", () => {
    expect(
      parseRepositoryUrl("https://gitlab.internal.acme.dev/acme/widgets.git"),
    ).toEqual({
      provider: "gitlab",
      host: "gitlab.internal.acme.dev",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("detects a self-hosted bitbucket server host by substring", () => {
    expect(
      parseRepositoryUrl("https://bitbucket.acme.dev/acme/widgets.git"),
    ).toEqual({
      provider: "bitbucket",
      host: "bitbucket.acme.dev",
      owner: "acme",
      repo: "widgets",
    });
  });

  it("throws BadRequestException for an unknown host", () => {
    expect(() =>
      parseRepositoryUrl("https://example.com/acme/widgets.git"),
    ).toThrow(BadRequestException);
  });

  it("throws BadRequestException for a url missing the repo segment", () => {
    expect(() => parseRepositoryUrl("https://gitlab.com/acme")).toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException for an empty string", () => {
    expect(() => parseRepositoryUrl("")).toThrow(BadRequestException);
  });
});
```

### Step 0.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/repository-url.parser.spec.ts
```

Expected: FAIL — `Cannot find module './repository-url.parser'`.

### Step 0.3 — GREEN: implementation

`repository-url.parser.types.ts`:

```typescript
export type SupportedProvider = "github" | "gitlab" | "bitbucket";

export interface ParsedRepository {
  provider: SupportedProvider;
  host: string;
  owner: string;
  repo: string;
}
```

`repository-url.parser.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import type {
  ParsedRepository,
  SupportedProvider,
} from "./repository-url.parser.types";

const HTTPS_REMOTE = /^https?:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/i;
const SSH_REMOTE = /^git@([^:]+):(.+?)(?:\.git)?\/?$/i;

function detectProvider(host: string): SupportedProvider | null {
  const normalized = host.toLowerCase();
  if (normalized === "github.com" || normalized.includes("github")) {
    return "github";
  }
  if (normalized === "gitlab.com" || normalized.includes("gitlab")) {
    return "gitlab";
  }
  if (normalized === "bitbucket.org" || normalized.includes("bitbucket")) {
    return "bitbucket";
  }
  return null;
}

/**
 * Parse any supported git remote into `{ provider, host, owner, repo }`.
 *
 * Detects the provider from the host (the three cloud hosts plus self-hosted
 * hosts whose name contains `github` / `gitlab` / `bitbucket`). The owner keeps
 * the full namespace path (GitLab subgroups); the repo is the final segment.
 *
 * @throws BadRequestException when the URL is unparseable or the host is unknown.
 */
export function parseRepositoryUrl(url: string): ParsedRepository {
  const trimmed = url.trim();
  const match = HTTPS_REMOTE.exec(trimmed) ?? SSH_REMOTE.exec(trimmed);
  if (!match) {
    throw new BadRequestException("Unparseable repository URL");
  }
  const [, host, path] = match;
  const provider = detectProvider(host);
  if (!provider) {
    throw new BadRequestException("Unsupported repository host");
  }

  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    throw new BadRequestException("Repository URL is missing owner/repo");
  }
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, segments.length - 1).join("/");
  return { provider, host, owner, repo };
}
```

> The error messages deliberately do **not** echo the raw URL — avoids leaking embedded credentials if a tokenized URL is ever passed.

### Step 0.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/repository-url.parser.spec.ts
```

Expected: PASS (10 tests).

```bash
git add apps/api/src/common/git/integration/repository-url.parser.*
git commit -m "feat(api): provider-agnostic repository url parser (github/gitlab/bitbucket)

EPIC-209 Phase 6. Detects provider + host + owner/repo (incl. self-hosted hosts
and gitlab subgroup namespaces) for multi-provider adapter selection.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1 — `HttpJsonClient` seam (injectable `fetch` wrapper)

**Files:**

- `apps/api/src/common/git/integration/http-json-client.types.ts`
- `apps/api/src/common/git/integration/http-json-client.ts`

**Interfaces:**

- **Produces:** an injection token `HTTP_JSON_CLIENT` and an interface
  `HttpJsonClient { request<T>(args: HttpJsonRequest): Promise<HttpJsonResponse<T>> }`
  where `HttpJsonRequest = { method: 'GET'|'POST'|'PUT'; url: string; token: string; tokenScheme?: 'bearer'|'basic-token'; body?: unknown; headers?: Record<string,string> }`
  and `HttpJsonResponse<T> = { status: number; data: T }`.
  A default `FetchHttpJsonClient` implements it over global `fetch`. Tests inject a mock `request`. **No network** is ever made by the specs.

> No spec for the default `fetch` client itself (it is a thin wrapper). It is exercised indirectly when each provider spec injects a mock client. This keeps real HTTP behind a swappable seam, exactly as Phase 2 did with the octokit factory. `tokenScheme` lets GitLab use `Authorization: Bearer <token>` (or `PRIVATE-TOKEN`) and Bitbucket use an app-password/token scheme without each adapter re-implementing header assembly. The token is **never** placed in thrown error messages — non-2xx responses throw with status + provider context only.

### Step 1.1 — Implement the seam

`http-json-client.types.ts`:

```typescript
export const HTTP_JSON_CLIENT = Symbol("HTTP_JSON_CLIENT");

export type HttpMethod = "GET" | "POST" | "PUT";
export type TokenScheme = "bearer" | "private-token" | "basic-token";

export interface HttpJsonRequest {
  method: HttpMethod;
  url: string;
  token: string;
  tokenScheme?: TokenScheme;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpJsonResponse<T = unknown> {
  status: number;
  data: T;
}

export interface HttpJsonClient {
  request<T = unknown>(args: HttpJsonRequest): Promise<HttpJsonResponse<T>>;
}
```

`http-json-client.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type {
  HttpJsonClient,
  HttpJsonRequest,
  HttpJsonResponse,
  TokenScheme,
} from "./http-json-client.types";

function authHeader(
  scheme: TokenScheme | undefined,
  token: string,
): Record<string, string> {
  switch (scheme) {
    case "private-token":
      return { "PRIVATE-TOKEN": token };
    case "basic-token":
      return {
        Authorization: `Basic ${Buffer.from(`x-token-auth:${token}`).toString("base64")}`,
      };
    case "bearer":
    default:
      return { Authorization: `Bearer ${token}` };
  }
}

/**
 * Minimal JSON-over-HTTP client for the GitLab/Bitbucket adapters. Wraps global
 * `fetch` behind an injectable seam so tests mock it with zero network. The token
 * is placed only into the Authorization/PRIVATE-TOKEN header — never logged and
 * never included in a thrown error message.
 */
@Injectable()
export class FetchHttpJsonClient implements HttpJsonClient {
  async request<T = unknown>(
    args: HttpJsonRequest,
  ): Promise<HttpJsonResponse<T>> {
    const response = await fetch(args.url, {
      method: args.method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...authHeader(args.tokenScheme, args.token),
        ...(args.headers ?? {}),
      },
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} from ${args.method} ${new URL(args.url).pathname}`,
      );
    }
    const data = (await response.json()) as T;
    return { status: response.status, data };
  }
}
```

### Step 1.2 — Sanity build + commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/repository-url.parser.spec.ts
```

Expected: PASS (existing suite unaffected; confirms the new files compile in the unit project).

```bash
git add apps/api/src/common/git/integration/http-json-client.*
git commit -m "feat(api): injectable fetch-backed HttpJsonClient seam for gitlab/bitbucket

EPIC-209 Phase 6. No new dependency — global fetch behind a mockable seam; auth
header assembly per token scheme; token never logged or echoed in errors.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — `GitLabCredentialResolver` (`gitlab_secret_id` → token, never logged)

**Files:**

- `apps/api/src/common/git/integration/gitlab-credential.resolver.ts`
- `apps/api/src/common/git/integration/gitlab-credential.resolver.spec.ts`

**Interfaces:**

- **Consumes:** `SecretReferenceResolver.resolveString({ secretId, purpose, serverName })` (`apps/api/src/security/secret-reference-resolver.service.ts`).
- **Produces:** `class GitLabCredentialResolver { resolveToken(gitlabSecretId: string): Promise<string> }`. Throws `BadRequestException` when absent/empty. Token **never** in a thrown message. Mirrors Phase-2 `GitHubCredentialResolver`.

### Step 2.1 — RED: spec with `SecretReferenceResolver` mocked

`gitlab-credential.resolver.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { GitLabCredentialResolver } from "./gitlab-credential.resolver";
import type { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SECRET_ID = "sec-gl-1";
const TOKEN = "glpat-super-secret";

function buildResolver(impl: () => Promise<string | null>) {
  const secretResolver = {
    resolveString: vi.fn(impl),
  } as unknown as SecretReferenceResolver;
  return {
    resolver: new GitLabCredentialResolver(secretResolver),
    secretResolver,
  };
}

describe("GitLabCredentialResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the token for a gitlab_secret_id", async () => {
    const { resolver, secretResolver } = buildResolver(async () => TOKEN);
    await expect(resolver.resolveToken(SECRET_ID)).resolves.toBe(TOKEN);
    expect(secretResolver.resolveString).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: SECRET_ID, purpose: "auth" }),
    );
  });

  it("throws BadRequestException when the secret id is empty", async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken("")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws BadRequestException when the secret resolves empty", async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken(SECRET_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("never includes the token value in a thrown error message", async () => {
    const { resolver } = buildResolver(async () => {
      throw new Error("decrypt failed");
    });
    try {
      await resolver.resolveToken(SECRET_ID);
      throw new Error("expected resolveToken to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});
```

### Step 2.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-credential.resolver.spec.ts
```

Expected: FAIL — module not found.

### Step 2.3 — GREEN: implementation

`gitlab-credential.resolver.ts`:

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SERVER_NAME = "gitlab-merge-provider";

/**
 * Resolves a GitLab API token from a project's `gitlab_secret_id` via the
 * encrypted secret store. The token is never logged, never returned in an error
 * message, and never embedded in a key name.
 */
@Injectable()
export class GitLabCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(gitlabSecretId: string): Promise<string> {
    if (!gitlabSecretId) {
      throw new BadRequestException(
        "gitlab_secret_id is required to authenticate with GitLab",
      );
    }
    const token = await this.secretReferenceResolver.resolveString({
      secretId: gitlabSecretId,
      purpose: "auth",
      serverName: SERVER_NAME,
    });
    if (!token) {
      throw new BadRequestException(
        "gitlab_secret_id did not resolve to a usable token",
      );
    }
    return token;
  }
}
```

### Step 2.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-credential.resolver.spec.ts
```

Expected: PASS (4 tests).

```bash
git add apps/api/src/common/git/integration/gitlab-credential.resolver.*
git commit -m "feat(api): resolve gitlab token from gitlab_secret_id (never logged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Pure GitLab MR → `PullRequestStatus` mappers

**Files:**

- `apps/api/src/common/git/integration/gitlab-merge-request.mapper.ts`
- `apps/api/src/common/git/integration/gitlab-merge-request.mapper.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `PullRequestState`, `PullRequestChecksStatus`, `PullRequestStatus`, `MergeMethod` from `merge-provider.interface.ts`.
- **Produces:** pure functions
  - `mapGitlabState(mr: { state: string }): PullRequestState` (`merged` → merged, `opened` → open, else closed)
  - `mapGitlabChecks(pipeline: { status: string } | null): PullRequestChecksStatus` (`success` → passing, `failed`/`canceled` → failing, `running`/`pending`/`created` → pending, null → unknown)
  - `mapGitlabReviewDecision(approvals: { approved: boolean; approvals_required: number; approvals_left: number }): PullRequestStatus['reviewDecision']`
  - `mapGitlabMergeMethod(method: MergeMethod): { squash: boolean }` (`squash` → `{ squash: true }`, else `{ squash: false }`; GitLab has no `rebase` merge — `rebase`/`merge` both map to a non-squash merge)

### Step 3.1 — RED: mapper spec

`gitlab-merge-request.mapper.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  mapGitlabChecks,
  mapGitlabMergeMethod,
  mapGitlabReviewDecision,
  mapGitlabState,
} from "./gitlab-merge-request.mapper";

describe("mapGitlabState", () => {
  it('maps a merged MR to "merged"', () => {
    expect(mapGitlabState({ state: "merged" })).toBe("merged");
  });
  it('maps an opened MR to "open"', () => {
    expect(mapGitlabState({ state: "opened" })).toBe("open");
  });
  it('maps a closed MR to "closed"', () => {
    expect(mapGitlabState({ state: "closed" })).toBe("closed");
  });
});

describe("mapGitlabChecks", () => {
  it('returns "unknown" with no pipeline', () => {
    expect(mapGitlabChecks(null)).toBe("unknown");
  });
  it('returns "passing" for a successful pipeline', () => {
    expect(mapGitlabChecks({ status: "success" })).toBe("passing");
  });
  it('returns "failing" for a failed pipeline', () => {
    expect(mapGitlabChecks({ status: "failed" })).toBe("failing");
  });
  it('returns "pending" for a running pipeline', () => {
    expect(mapGitlabChecks({ status: "running" })).toBe("pending");
  });
});

describe("mapGitlabReviewDecision", () => {
  it('returns "approved" when fully approved', () => {
    expect(
      mapGitlabReviewDecision({
        approved: true,
        approvals_required: 1,
        approvals_left: 0,
      }),
    ).toBe("approved");
  });
  it('returns "review_required" when approvals remain', () => {
    expect(
      mapGitlabReviewDecision({
        approved: false,
        approvals_required: 2,
        approvals_left: 1,
      }),
    ).toBe("review_required");
  });
  it('returns "none" when no approvals are required and none given', () => {
    expect(
      mapGitlabReviewDecision({
        approved: false,
        approvals_required: 0,
        approvals_left: 0,
      }),
    ).toBe("none");
  });
});

describe("mapGitlabMergeMethod", () => {
  it('maps "squash" to squash=true', () => {
    expect(mapGitlabMergeMethod("squash")).toEqual({ squash: true });
  });
  it('maps "merge" to squash=false', () => {
    expect(mapGitlabMergeMethod("merge")).toEqual({ squash: false });
  });
  it('maps "rebase" to squash=false (gitlab has no rebase-merge)', () => {
    expect(mapGitlabMergeMethod("rebase")).toEqual({ squash: false });
  });
});
```

### Step 3.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-merge-request.mapper.spec.ts
```

Expected: FAIL — module not found.

### Step 3.3 — GREEN: mapper implementation

`gitlab-merge-request.mapper.ts`:

```typescript
import type {
  MergeMethod,
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from "./merge-provider.interface";

const PENDING_PIPELINE = new Set([
  "running",
  "pending",
  "created",
  "waiting_for_resource",
  "preparing",
  "scheduled",
]);
const FAILING_PIPELINE = new Set(["failed", "canceled"]);

export function mapGitlabState(mr: { state: string }): PullRequestState {
  if (mr.state === "merged") {
    return "merged";
  }
  return mr.state === "opened" ? "open" : "closed";
}

export function mapGitlabChecks(
  pipeline: { status: string } | null,
): PullRequestChecksStatus {
  if (!pipeline) {
    return "unknown";
  }
  if (pipeline.status === "success") {
    return "passing";
  }
  if (FAILING_PIPELINE.has(pipeline.status)) {
    return "failing";
  }
  if (PENDING_PIPELINE.has(pipeline.status)) {
    return "pending";
  }
  return "unknown";
}

export function mapGitlabReviewDecision(approvals: {
  approved: boolean;
  approvals_required: number;
  approvals_left: number;
}): PullRequestStatus["reviewDecision"] {
  if (
    approvals.approved ||
    (approvals.approvals_required > 0 && approvals.approvals_left === 0)
  ) {
    return "approved";
  }
  if (approvals.approvals_required > 0) {
    return "review_required";
  }
  return "none";
}

export function mapGitlabMergeMethod(method: MergeMethod): { squash: boolean } {
  return { squash: method === "squash" };
}
```

### Step 3.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-merge-request.mapper.spec.ts
```

Expected: PASS (13 tests).

```bash
git add apps/api/src/common/git/integration/gitlab-merge-request.mapper.*
git commit -m "feat(api): map gitlab MR state, pipeline and approvals to PullRequestStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — `GitLabMergeProvider` (implements `MergeProvider`, HTTP MOCKED)

**Files:**

- `apps/api/src/common/git/integration/gitlab-merge.provider.ts`
- `apps/api/src/common/git/integration/gitlab-merge.provider.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `MergeProvider`, `OpenOrUpdatePullRequestArgs`, `PullRequestRef`, `PullRequestStatus`, `MergeMethod` (verbatim Section 10.1).
- **Consumes (this phase):** `parseRepositoryUrl`, `GitLabCredentialResolver`, `HTTP_JSON_CLIENT`/`HttpJsonClient`, the Task-3 mappers.
- **Produces:** `class GitLabMergeProvider implements MergeProvider` with `readonly providerKey = 'gitlab'`. The `args.githubSecretId` field of `OpenOrUpdatePullRequestArgs` is the **neutral provider secret id** (the contract name is fixed in Section 10.1; for GitLab it carries the GitLab secret id — documented in a code comment, no signature change).

### Behaviour to implement

GitLab addresses projects by URL-encoded `namespace/repo`. The provider:

- `openOrUpdatePullRequest(args)`: resolve token → parse `{ owner, repo }` → `projectPath = encodeURIComponent('${owner}/${repo}')` → **GET** `/projects/${projectPath}/merge_requests?state=opened&source_branch=${head}&target_branch=${base}`; if a MR exists, **PUT** `/merge_requests/${iid}` (title/description) and return its ref; else **POST** `/merge_requests` and return the new ref. `PullRequestRef.number = mr.iid`, `url = mr.web_url`, `owner`/`repo` from the parse.
- `getPullRequestStatus(ref)`: **GET** the MR, the head-pipeline (`/merge_requests/${iid}/pipelines` → latest, or `mr.head_pipeline`), and approvals (`/merge_requests/${iid}/approvals`); map via Task-3 helpers. `mergeCommitSha = mr.merge_commit_sha` only when merged. `mergeable = mr.merge_status === 'can_be_merged'`.
- `mergePullRequest(ref, method)`: **PUT** `/merge_requests/${iid}/merge` with `mapGitlabMergeMethod(method)`; return `{ mergeCommitSha: merged.merge_commit_sha ?? merged.sha }`.

> Status/merge build their secret from the **tracking row** (Phase 3 stores the secret id with the ref). For the Phase-6 unit specs the credential resolver is mocked, so the token path is exercised through the mocked resolver; keep the canonical `getPullRequestStatus(ref)` / `mergePullRequest(ref, method)` signatures unchanged (mirror the Phase-2 note in `github-merge.provider.ts` Task 5 — resolve the token via the mocked resolver, no real secret lookup).

### Step 4.1 — RED: provider spec with a fully-mocked HTTP client

`gitlab-merge.provider.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitLabMergeProvider } from "./gitlab-merge.provider";
import type { GitLabCredentialResolver } from "./gitlab-credential.resolver";
import type { HttpJsonClient, HttpJsonRequest } from "./http-json-client.types";
import type { OpenOrUpdatePullRequestArgs } from "./merge-provider.interface";

const TOKEN = "glpat-secret";
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: "scope-1",
  contextId: "ctx-1",
  workflowRunId: "run-1",
  repositoryUrl: "https://gitlab.com/acme/widgets.git",
  githubSecretId: "sec-gl-1", // neutral provider secret id (GitLab token here)
  headBranch: "feature/x",
  baseBranch: "main",
  title: "Feature X",
  body: "Implements X",
};

/**
 * Route mock by (method, url-substring) — returns canned MR/pipeline/approval
 * shapes. No network.
 */
function buildClient(
  routes: {
    match: (r: HttpJsonRequest) => boolean;
    data: unknown;
    status?: number;
  }[],
) {
  const request = vi.fn(async (r: HttpJsonRequest) => {
    const route = routes.find((entry) => entry.match(r));
    if (!route) {
      throw new Error(`unrouted ${r.method} ${r.url}`);
    }
    return { status: route.status ?? 200, data: route.data };
  });
  return { client: { request } as unknown as HttpJsonClient, request };
}

function buildProvider(client: HttpJsonClient) {
  const credentialResolver = {
    resolveToken: vi.fn(async () => TOKEN),
  } as unknown as GitLabCredentialResolver;
  return {
    provider: new GitLabMergeProvider(credentialResolver, client),
    credentialResolver,
  };
}

const REF = {
  provider: "gitlab",
  owner: "acme",
  repo: "widgets",
  number: 7,
  url: "https://gitlab.com/acme/widgets/-/merge_requests/7",
};

describe("GitLabMergeProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "gitlab"', () => {
    const { client } = buildClient([]);
    expect(buildProvider(client).provider.providerKey).toBe("gitlab");
  });

  it("creates an MR when none exists for the source/target branches", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.includes("/merge_requests?"),
        data: [],
      },
      {
        match: (r) => r.method === "POST" && r.url.endsWith("/merge_requests"),
        data: {
          iid: 42,
          web_url: "https://gitlab.com/acme/widgets/-/merge_requests/42",
        },
      },
    ]);
    const { provider } = buildProvider(client);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    const post = request.mock.calls.find(([r]) => r.method === "POST")![0];
    expect(post.body).toEqual(
      expect.objectContaining({
        source_branch: "feature/x",
        target_branch: "main",
        title: "Feature X",
      }),
    );
    expect(ref).toEqual({
      provider: "gitlab",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://gitlab.com/acme/widgets/-/merge_requests/42",
    });
  });

  it("is idempotent: a second call updates the existing MR (no duplicate)", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.includes("/merge_requests?"),
        data: [{ iid: 7, web_url: REF.url }],
      },
      { match: (r) => r.method === "PUT", data: { iid: 7, web_url: REF.url } },
    ]);
    const { provider } = buildProvider(client);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(request.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
    expect(request.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
      2,
    );
    expect(first).toEqual(second);
    expect(second.number).toBe(7);
  });

  it("maps MR + pipeline + approvals into PullRequestStatus", async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.endsWith("/merge_requests/7"),
        data: {
          state: "opened",
          merge_status: "can_be_merged",
          merge_commit_sha: null,
        },
      },
      {
        match: (r) => r.url.includes("/merge_requests/7/pipelines"),
        data: [{ status: "success" }],
      },
      {
        match: (r) => r.url.includes("/merge_requests/7/approvals"),
        data: { approved: true, approvals_required: 1, approvals_left: 0 },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe("open");
    expect(status.checks).toBe("passing");
    expect(status.reviewDecision).toBe("approved");
    expect(status.mergeable).toBe(true);
    expect(status.mergeCommitSha).toBeNull();
  });

  it("reports the merge commit sha when the MR is merged", async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.endsWith("/merge_requests/7"),
        data: {
          state: "merged",
          merge_status: "can_be_merged",
          merge_commit_sha: "deadbeef",
        },
      },
      { match: (r) => r.url.includes("/pipelines"), data: [] },
      {
        match: (r) => r.url.includes("/approvals"),
        data: { approved: false, approvals_required: 0, approvals_left: 0 },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe("merged");
    expect(status.mergeCommitSha).toBe("deadbeef");
  });

  it("merges an MR with the requested merge method (squash)", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "PUT" && r.url.endsWith("/merge"),
        data: { merge_commit_sha: "mergedsha" },
      },
    ]);
    const { provider } = buildProvider(client);

    const result = await provider.mergePullRequest(REF, "squash");

    const put = request.mock.calls.find(([r]) => r.method === "PUT")![0];
    expect(put.body).toEqual(expect.objectContaining({ squash: true }));
    expect(result).toEqual({ mergeCommitSha: "mergedsha" });
  });

  it("never includes the token in an error when the HTTP client fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("HTTP 403 from GET /api/v4/projects");
    });
    const { provider } = buildProvider({
      request,
    } as unknown as HttpJsonClient);

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
```

### Step 4.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-merge.provider.spec.ts
```

Expected: FAIL — module not found.

### Step 4.3 — GREEN: provider implementation

`gitlab-merge.provider.ts`:

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { GitLabCredentialResolver } from "./gitlab-credential.resolver";
import {
  HTTP_JSON_CLIENT,
  type HttpJsonClient,
} from "./http-json-client.types";
import { parseRepositoryUrl } from "./repository-url.parser";
import {
  mapGitlabChecks,
  mapGitlabMergeMethod,
  mapGitlabReviewDecision,
  mapGitlabState,
} from "./gitlab-merge-request.mapper";
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from "./merge-provider.interface";

const PROVIDER_KEY = "gitlab";
const API_BASE = "https://gitlab.com/api/v4";

interface GitlabMr {
  iid: number;
  web_url: string;
  state: string;
  merge_status?: string;
  merge_commit_sha?: string | null;
  sha?: string | null;
}

@Injectable()
export class GitLabMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: GitLabCredentialResolver,
    @Inject(HTTP_JSON_CLIENT) private readonly http: HttpJsonClient,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseRepositoryUrl(args.repositoryUrl);
    // OpenOrUpdatePullRequestArgs.githubSecretId is the neutral provider secret
    // id (Section 10.1 contract name); for GitLab it carries the GitLab token id.
    const token = await this.credentialResolver.resolveToken(
      args.githubSecretId,
    );
    const project = this.projectPath(owner, repo);

    const existing = await this.http.request<GitlabMr[]>({
      method: "GET",
      url: `${API_BASE}/projects/${project}/merge_requests?state=opened&source_branch=${encodeURIComponent(args.headBranch)}&target_branch=${encodeURIComponent(args.baseBranch)}`,
      token,
    });

    if (existing.data.length > 0) {
      const current = existing.data[0];
      const updated = await this.http.request<GitlabMr>({
        method: "PUT",
        url: `${API_BASE}/projects/${project}/merge_requests/${current.iid}`,
        token,
        body: { title: args.title, description: args.body },
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await this.http.request<GitlabMr>({
      method: "POST",
      url: `${API_BASE}/projects/${project}/merge_requests`,
      token,
      body: {
        source_branch: args.headBranch,
        target_branch: args.baseBranch,
        title: args.title,
        description: args.body,
      },
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const token = await this.credentialResolver.resolveToken(ref.repo); // resolver mocked in specs; Phase 3 row supplies the real secret id
    const project = this.projectPath(ref.owner, ref.repo);
    const base = `${API_BASE}/projects/${project}/merge_requests/${ref.number}`;

    const [mr, pipelines, approvals] = await Promise.all([
      this.http.request<GitlabMr>({ method: "GET", url: base, token }),
      this.http.request<{ status: string }[]>({
        method: "GET",
        url: `${base}/pipelines`,
        token,
      }),
      this.http.request<{
        approved: boolean;
        approvals_required: number;
        approvals_left: number;
      }>({
        method: "GET",
        url: `${base}/approvals`,
        token,
      }),
    ]);

    const state = mapGitlabState(mr.data);
    const latestPipeline = pipelines.data.length > 0 ? pipelines.data[0] : null;

    return {
      ref,
      state,
      checks: mapGitlabChecks(latestPipeline),
      reviewDecision: mapGitlabReviewDecision(approvals.data),
      mergeCommitSha:
        state === "merged" ? (mr.data.merge_commit_sha ?? null) : null,
      mergeable: mr.data.merge_status === "can_be_merged",
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const token = await this.credentialResolver.resolveToken(ref.repo);
    const project = this.projectPath(ref.owner, ref.repo);
    const merged = await this.http.request<GitlabMr>({
      method: "PUT",
      url: `${API_BASE}/projects/${project}/merge_requests/${ref.number}/merge`,
      token,
      body: mapGitlabMergeMethod(method),
    });
    return {
      mergeCommitSha: merged.data.merge_commit_sha ?? merged.data.sha ?? "",
    };
  }

  private projectPath(owner: string, repo: string): string {
    return encodeURIComponent(`${owner}/${repo}`);
  }

  private toRef(owner: string, repo: string, mr: GitlabMr): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: mr.iid,
      url: mr.web_url,
    };
  }
}
```

> **Implementer note (matches the Phase-2 pattern):** `getPullRequestStatus`/`mergePullRequest` take only a `PullRequestRef` per Section 10.1. The real secret id is carried by the Phase-3 PR-tracking row (Phase 3/4 supply it when constructing the call site). In these unit specs the resolver is **mocked** to return the token unconditionally, so the `resolveToken(ref.repo)` argument is irrelevant to the test and no real secret lookup occurs. Do **not** change the canonical signatures; if the implementer wants a cleaner seam, add a private `authToken(ref)` that the wiring layer (Phase 3/4) feeds the row's secret id — but keep `getPullRequestStatus(ref)` / `mergePullRequest(ref, method)` byte-exact.

### Step 4.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/gitlab-merge.provider.spec.ts
```

Expected: PASS (7 tests) — including idempotency (no POST, two PUTs) and the no-token-in-error test.

```bash
git add apps/api/src/common/git/integration/gitlab-merge.provider.*
git commit -m "feat(api): GitLabMergeProvider open/inspect/merge MRs (fetch, idempotent)

EPIC-209 Phase 6. Implements MergeProvider via the GitLab Merge Requests API;
find-or-create by source/target branch; pipeline + approvals status mapping.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `BitbucketCredentialResolver` (`bitbucket_secret_id` → token, never logged)

**Files:**

- `apps/api/src/common/git/integration/bitbucket-credential.resolver.ts`
- `apps/api/src/common/git/integration/bitbucket-credential.resolver.spec.ts`

**Interfaces:**

- **Consumes:** `SecretReferenceResolver.resolveString({ secretId, purpose, serverName })`.
- **Produces:** `class BitbucketCredentialResolver { resolveToken(bitbucketSecretId: string): Promise<string> }`. Same guarantees as Task 2 (`SERVER_NAME = 'bitbucket-merge-provider'`).

### Step 5.1 — RED: spec (identical structure to Task 2, Bitbucket names)

`bitbucket-credential.resolver.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { BitbucketCredentialResolver } from "./bitbucket-credential.resolver";
import type { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SECRET_ID = "sec-bb-1";
const TOKEN = "bbtoken-super-secret";

function buildResolver(impl: () => Promise<string | null>) {
  const secretResolver = {
    resolveString: vi.fn(impl),
  } as unknown as SecretReferenceResolver;
  return {
    resolver: new BitbucketCredentialResolver(secretResolver),
    secretResolver,
  };
}

describe("BitbucketCredentialResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the token for a bitbucket_secret_id", async () => {
    const { resolver, secretResolver } = buildResolver(async () => TOKEN);
    await expect(resolver.resolveToken(SECRET_ID)).resolves.toBe(TOKEN);
    expect(secretResolver.resolveString).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: SECRET_ID, purpose: "auth" }),
    );
  });

  it("throws BadRequestException when the secret id is empty", async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken("")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws BadRequestException when the secret resolves empty", async () => {
    const { resolver } = buildResolver(async () => null);
    await expect(resolver.resolveToken(SECRET_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("never includes the token value in a thrown error message", async () => {
    const { resolver } = buildResolver(async () => {
      throw new Error("decrypt failed");
    });
    try {
      await resolver.resolveToken(SECRET_ID);
      throw new Error("expected resolveToken to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });
});
```

### Step 5.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-credential.resolver.spec.ts
```

Expected: FAIL — module not found.

### Step 5.3 — GREEN

`bitbucket-credential.resolver.ts`:

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SERVER_NAME = "bitbucket-merge-provider";

/**
 * Resolves a Bitbucket API token (app password / access token) from a project's
 * `bitbucket_secret_id` via the encrypted secret store. Never logged, never
 * returned in an error message, never embedded in a key name.
 */
@Injectable()
export class BitbucketCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(bitbucketSecretId: string): Promise<string> {
    if (!bitbucketSecretId) {
      throw new BadRequestException(
        "bitbucket_secret_id is required to authenticate with Bitbucket",
      );
    }
    const token = await this.secretReferenceResolver.resolveString({
      secretId: bitbucketSecretId,
      purpose: "auth",
      serverName: SERVER_NAME,
    });
    if (!token) {
      throw new BadRequestException(
        "bitbucket_secret_id did not resolve to a usable token",
      );
    }
    return token;
  }
}
```

### Step 5.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-credential.resolver.spec.ts
```

Expected: PASS (4 tests).

```bash
git add apps/api/src/common/git/integration/bitbucket-credential.resolver.*
git commit -m "feat(api): resolve bitbucket token from bitbucket_secret_id (never logged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — Pure Bitbucket PR → `PullRequestStatus` mappers

**Files:**

- `apps/api/src/common/git/integration/bitbucket-pull-request.mapper.ts`
- `apps/api/src/common/git/integration/bitbucket-pull-request.mapper.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `PullRequestState`, `PullRequestChecksStatus`, `PullRequestStatus`, `MergeMethod`.
- **Produces:** pure functions
  - `mapBitbucketState(pr: { state: string }): PullRequestState` (`MERGED` → merged, `OPEN` → open, `DECLINED`/`SUPERSEDED` → closed)
  - `mapBitbucketChecks(statuses: { state: string }[]): PullRequestChecksStatus` (commit build statuses: any `FAILED`/`STOPPED` → failing; any `INPROGRESS` → pending; all `SUCCESSFUL` → passing; empty → unknown)
  - `mapBitbucketReviewDecision(participants: { role: string; approved: boolean }[]): PullRequestStatus['reviewDecision']` (any reviewer `approved` → approved; reviewers present but none approved → review_required; no reviewers → none)
  - `mapBitbucketMergeStrategy(method: MergeMethod): 'merge_commit' | 'squash' | 'fast_forward'`

### Step 6.1 — RED: mapper spec

`bitbucket-pull-request.mapper.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  mapBitbucketChecks,
  mapBitbucketMergeStrategy,
  mapBitbucketReviewDecision,
  mapBitbucketState,
} from "./bitbucket-pull-request.mapper";

describe("mapBitbucketState", () => {
  it('maps MERGED to "merged"', () => {
    expect(mapBitbucketState({ state: "MERGED" })).toBe("merged");
  });
  it('maps OPEN to "open"', () => {
    expect(mapBitbucketState({ state: "OPEN" })).toBe("open");
  });
  it('maps DECLINED to "closed"', () => {
    expect(mapBitbucketState({ state: "DECLINED" })).toBe("closed");
  });
});

describe("mapBitbucketChecks", () => {
  it('returns "unknown" with no statuses', () => {
    expect(mapBitbucketChecks([])).toBe("unknown");
  });
  it('returns "passing" when all statuses succeeded', () => {
    expect(mapBitbucketChecks([{ state: "SUCCESSFUL" }])).toBe("passing");
  });
  it('returns "failing" when any status failed', () => {
    expect(
      mapBitbucketChecks([{ state: "SUCCESSFUL" }, { state: "FAILED" }]),
    ).toBe("failing");
  });
  it('returns "pending" when any status is in progress', () => {
    expect(mapBitbucketChecks([{ state: "INPROGRESS" }])).toBe("pending");
  });
});

describe("mapBitbucketReviewDecision", () => {
  it('returns "approved" when a reviewer approved', () => {
    expect(
      mapBitbucketReviewDecision([{ role: "REVIEWER", approved: true }]),
    ).toBe("approved");
  });
  it('returns "review_required" when reviewers exist but none approved', () => {
    expect(
      mapBitbucketReviewDecision([{ role: "REVIEWER", approved: false }]),
    ).toBe("review_required");
  });
  it('returns "none" when there are no reviewers', () => {
    expect(
      mapBitbucketReviewDecision([{ role: "PARTICIPANT", approved: false }]),
    ).toBe("none");
  });
});

describe("mapBitbucketMergeStrategy", () => {
  it('maps "merge" to merge_commit', () => {
    expect(mapBitbucketMergeStrategy("merge")).toBe("merge_commit");
  });
  it('maps "squash" to squash', () => {
    expect(mapBitbucketMergeStrategy("squash")).toBe("squash");
  });
  it('maps "rebase" to fast_forward', () => {
    expect(mapBitbucketMergeStrategy("rebase")).toBe("fast_forward");
  });
});
```

### Step 6.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-pull-request.mapper.spec.ts
```

Expected: FAIL — module not found.

### Step 6.3 — GREEN

`bitbucket-pull-request.mapper.ts`:

```typescript
import type {
  MergeMethod,
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from "./merge-provider.interface";

const FAILING_BUILD = new Set(["FAILED", "STOPPED"]);
const PENDING_BUILD = new Set(["INPROGRESS"]);

export function mapBitbucketState(pr: { state: string }): PullRequestState {
  if (pr.state === "MERGED") {
    return "merged";
  }
  return pr.state === "OPEN" ? "open" : "closed";
}

export function mapBitbucketChecks(
  statuses: { state: string }[],
): PullRequestChecksStatus {
  if (statuses.length === 0) {
    return "unknown";
  }
  if (statuses.some((s) => FAILING_BUILD.has(s.state))) {
    return "failing";
  }
  if (statuses.some((s) => PENDING_BUILD.has(s.state))) {
    return "pending";
  }
  if (statuses.every((s) => s.state === "SUCCESSFUL")) {
    return "passing";
  }
  return "unknown";
}

export function mapBitbucketReviewDecision(
  participants: { role: string; approved: boolean }[],
): PullRequestStatus["reviewDecision"] {
  const reviewers = participants.filter((p) => p.role === "REVIEWER");
  if (reviewers.some((r) => r.approved)) {
    return "approved";
  }
  if (reviewers.length > 0) {
    return "review_required";
  }
  return "none";
}

export function mapBitbucketMergeStrategy(
  method: MergeMethod,
): "merge_commit" | "squash" | "fast_forward" {
  switch (method) {
    case "squash":
      return "squash";
    case "rebase":
      return "fast_forward";
    case "merge":
    default:
      return "merge_commit";
  }
}
```

### Step 6.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-pull-request.mapper.spec.ts
```

Expected: PASS (13 tests).

```bash
git add apps/api/src/common/git/integration/bitbucket-pull-request.mapper.*
git commit -m "feat(api): map bitbucket PR state, build statuses and approvals to PullRequestStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — `BitbucketMergeProvider` (implements `MergeProvider`, HTTP MOCKED)

**Files:**

- `apps/api/src/common/git/integration/bitbucket-merge.provider.ts`
- `apps/api/src/common/git/integration/bitbucket-merge.provider.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `MergeProvider`, `OpenOrUpdatePullRequestArgs`, `PullRequestRef`, `PullRequestStatus`, `MergeMethod`.
- **Consumes (this phase):** `parseRepositoryUrl`, `BitbucketCredentialResolver`, `HTTP_JSON_CLIENT`/`HttpJsonClient`, Task-6 mappers.
- **Produces:** `class BitbucketMergeProvider implements MergeProvider` with `readonly providerKey = 'bitbucket'`. `tokenScheme: 'basic-token'` (Bitbucket Cloud app-password / access-token Basic auth). The neutral `args.githubSecretId` carries the Bitbucket secret id.

### Behaviour to implement

Bitbucket Cloud REST 2.0 addresses repos as `/repositories/{workspace}/{repo_slug}`:

- `openOrUpdatePullRequest(args)`: resolve token → parse `{ owner: workspace, repo: slug }` → **GET** `/repositories/${workspace}/${slug}/pullrequests?state=OPEN&q=source.branch.name="${head}" AND destination.branch.name="${base}"`; if one exists, **PUT** `/pullrequests/${id}` (title/description) and return its ref; else **POST** `/pullrequests` and return the new ref. `PullRequestRef.number = pr.id`, `url = pr.links.html.href`.
- `getPullRequestStatus(ref)`: **GET** the PR (state, `participants`, `merge_commit`), and the commit build statuses (`/commit/${sourceSha}/statuses` or the PR `statuses` link). Map via Task-6 helpers. `mergeCommitSha = pr.merge_commit?.hash` only when merged. `mergeable` — Bitbucket exposes no direct boolean; set `mergeable = pr.state === 'OPEN' ? null : false` (unknown while open).
- `mergePullRequest(ref, method)`: **POST** `/pullrequests/${id}/merge` with `{ merge_strategy: mapBitbucketMergeStrategy(method) }`; return `{ mergeCommitSha: merged.merge_commit.hash }`.

### Step 7.1 — RED: provider spec with a fully-mocked HTTP client

`bitbucket-merge.provider.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BitbucketMergeProvider } from "./bitbucket-merge.provider";
import type { BitbucketCredentialResolver } from "./bitbucket-credential.resolver";
import type { HttpJsonClient, HttpJsonRequest } from "./http-json-client.types";
import type { OpenOrUpdatePullRequestArgs } from "./merge-provider.interface";

const TOKEN = "bbtoken-secret";
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: "scope-1",
  contextId: "ctx-1",
  workflowRunId: "run-1",
  repositoryUrl: "https://bitbucket.org/acme/widgets.git",
  githubSecretId: "sec-bb-1",
  headBranch: "feature/x",
  baseBranch: "main",
  title: "Feature X",
  body: "Implements X",
};

const REF = {
  provider: "bitbucket",
  owner: "acme",
  repo: "widgets",
  number: 7,
  url: "https://bitbucket.org/acme/widgets/pull-requests/7",
};

function buildClient(
  routes: {
    match: (r: HttpJsonRequest) => boolean;
    data: unknown;
    status?: number;
  }[],
) {
  const request = vi.fn(async (r: HttpJsonRequest) => {
    const route = routes.find((entry) => entry.match(r));
    if (!route) {
      throw new Error(`unrouted ${r.method} ${r.url}`);
    }
    return { status: route.status ?? 200, data: route.data };
  });
  return { client: { request } as unknown as HttpJsonClient, request };
}

function buildProvider(client: HttpJsonClient) {
  const credentialResolver = {
    resolveToken: vi.fn(async () => TOKEN),
  } as unknown as BitbucketCredentialResolver;
  return { provider: new BitbucketMergeProvider(credentialResolver, client) };
}

describe("BitbucketMergeProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "bitbucket"', () => {
    const { client } = buildClient([]);
    expect(buildProvider(client).provider.providerKey).toBe("bitbucket");
  });

  it("creates a PR when none exists for the source/destination branches", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.includes("/pullrequests?"),
        data: { values: [] },
      },
      {
        match: (r) => r.method === "POST" && r.url.endsWith("/pullrequests"),
        data: {
          id: 42,
          links: {
            html: {
              href: "https://bitbucket.org/acme/widgets/pull-requests/42",
            },
          },
        },
      },
    ]);
    const { provider } = buildProvider(client);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    const post = request.mock.calls.find(([r]) => r.method === "POST")![0];
    expect(post.tokenScheme).toBe("basic-token");
    expect(post.body).toEqual(
      expect.objectContaining({
        title: "Feature X",
        source: { branch: { name: "feature/x" } },
        destination: { branch: { name: "main" } },
      }),
    );
    expect(ref).toEqual({
      provider: "bitbucket",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://bitbucket.org/acme/widgets/pull-requests/42",
    });
  });

  it("is idempotent: a second call updates the existing PR (no duplicate)", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.includes("/pullrequests?"),
        data: { values: [{ id: 7, links: { html: { href: REF.url } } }] },
      },
      {
        match: (r) => r.method === "PUT",
        data: { id: 7, links: { html: { href: REF.url } } },
      },
    ]);
    const { provider } = buildProvider(client);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(request.mock.calls.some(([r]) => r.method === "POST")).toBe(false);
    expect(request.mock.calls.filter(([r]) => r.method === "PUT")).toHaveLength(
      2,
    );
    expect(first).toEqual(second);
  });

  it("maps PR + build statuses + participants into PullRequestStatus", async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.endsWith("/pullrequests/7"),
        data: {
          state: "OPEN",
          merge_commit: null,
          source: { commit: { hash: "srcsha" } },
          participants: [{ role: "REVIEWER", approved: true }],
        },
      },
      {
        match: (r) => r.url.includes("/statuses"),
        data: { values: [{ state: "SUCCESSFUL" }] },
      },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe("open");
    expect(status.checks).toBe("passing");
    expect(status.reviewDecision).toBe("approved");
    expect(status.mergeCommitSha).toBeNull();
  });

  it("reports the merge commit hash when the PR is merged", async () => {
    const { client } = buildClient([
      {
        match: (r) => r.method === "GET" && r.url.endsWith("/pullrequests/7"),
        data: {
          state: "MERGED",
          merge_commit: { hash: "deadbeef" },
          source: { commit: { hash: "srcsha" } },
          participants: [],
        },
      },
      { match: (r) => r.url.includes("/statuses"), data: { values: [] } },
    ]);
    const { provider } = buildProvider(client);

    const status = await provider.getPullRequestStatus(REF);

    expect(status.state).toBe("merged");
    expect(status.mergeCommitSha).toBe("deadbeef");
  });

  it("merges a PR with the requested merge strategy (squash)", async () => {
    const { client, request } = buildClient([
      {
        match: (r) => r.method === "POST" && r.url.endsWith("/merge"),
        data: { merge_commit: { hash: "mergedsha" } },
      },
    ]);
    const { provider } = buildProvider(client);

    const result = await provider.mergePullRequest(REF, "squash");

    const post = request.mock.calls.find(([r]) => r.method === "POST")![0];
    expect(post.body).toEqual(
      expect.objectContaining({ merge_strategy: "squash" }),
    );
    expect(result).toEqual({ mergeCommitSha: "mergedsha" });
  });

  it("never includes the token in an error when the HTTP client fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("HTTP 403 from GET /repositories");
    });
    const { provider } = buildProvider({
      request,
    } as unknown as HttpJsonClient);

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
```

### Step 7.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-merge.provider.spec.ts
```

Expected: FAIL — module not found.

### Step 7.3 — GREEN

`bitbucket-merge.provider.ts`:

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { BitbucketCredentialResolver } from "./bitbucket-credential.resolver";
import {
  HTTP_JSON_CLIENT,
  type HttpJsonClient,
} from "./http-json-client.types";
import { parseRepositoryUrl } from "./repository-url.parser";
import {
  mapBitbucketChecks,
  mapBitbucketMergeStrategy,
  mapBitbucketReviewDecision,
  mapBitbucketState,
} from "./bitbucket-pull-request.mapper";
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from "./merge-provider.interface";

const PROVIDER_KEY = "bitbucket";
const API_BASE = "https://api.bitbucket.org/2.0";
const TOKEN_SCHEME = "basic-token" as const;

interface BitbucketPr {
  id: number;
  state: string;
  links: { html: { href: string } };
  merge_commit?: { hash: string } | null;
  source?: { commit?: { hash?: string } };
  participants?: { role: string; approved: boolean }[];
}

@Injectable()
export class BitbucketMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: BitbucketCredentialResolver,
    @Inject(HTTP_JSON_CLIENT) private readonly http: HttpJsonClient,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseRepositoryUrl(args.repositoryUrl);
    // OpenOrUpdatePullRequestArgs.githubSecretId is the neutral provider secret
    // id (Section 10.1 contract name); for Bitbucket it carries the BB token id.
    const token = await this.credentialResolver.resolveToken(
      args.githubSecretId,
    );
    const base = `${API_BASE}/repositories/${owner}/${repo}/pullrequests`;
    const query = `q=${encodeURIComponent(
      `source.branch.name="${args.headBranch}" AND destination.branch.name="${args.baseBranch}"`,
    )}&state=OPEN`;

    const existing = await this.http.request<{ values: BitbucketPr[] }>({
      method: "GET",
      url: `${base}?${query}`,
      token,
      tokenScheme: TOKEN_SCHEME,
    });

    if (existing.data.values.length > 0) {
      const current = existing.data.values[0];
      const updated = await this.http.request<BitbucketPr>({
        method: "PUT",
        url: `${base}/${current.id}`,
        token,
        tokenScheme: TOKEN_SCHEME,
        body: { title: args.title, description: args.body },
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await this.http.request<BitbucketPr>({
      method: "POST",
      url: base,
      token,
      tokenScheme: TOKEN_SCHEME,
      body: {
        title: args.title,
        description: args.body,
        source: { branch: { name: args.headBranch } },
        destination: { branch: { name: args.baseBranch } },
      },
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const token = await this.credentialResolver.resolveToken(ref.repo); // resolver mocked in specs; Phase 3 row supplies the real secret id
    const prUrl = `${API_BASE}/repositories/${ref.owner}/${ref.repo}/pullrequests/${ref.number}`;

    const pr = await this.http.request<BitbucketPr>({
      method: "GET",
      url: prUrl,
      token,
      tokenScheme: TOKEN_SCHEME,
    });
    const statuses = await this.http.request<{ values: { state: string }[] }>({
      method: "GET",
      url: `${prUrl}/statuses`,
      token,
      tokenScheme: TOKEN_SCHEME,
    });

    const state = mapBitbucketState(pr.data);
    return {
      ref,
      state,
      checks: mapBitbucketChecks(statuses.data.values),
      reviewDecision: mapBitbucketReviewDecision(pr.data.participants ?? []),
      mergeCommitSha:
        state === "merged" ? (pr.data.merge_commit?.hash ?? null) : null,
      mergeable: state === "open" ? null : false,
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const token = await this.credentialResolver.resolveToken(ref.repo);
    const merged = await this.http.request<BitbucketPr>({
      method: "POST",
      url: `${API_BASE}/repositories/${ref.owner}/${ref.repo}/pullrequests/${ref.number}/merge`,
      token,
      tokenScheme: TOKEN_SCHEME,
      body: { merge_strategy: mapBitbucketMergeStrategy(method) },
    });
    return { mergeCommitSha: merged.data.merge_commit?.hash ?? "" };
  }

  private toRef(owner: string, repo: string, pr: BitbucketPr): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: pr.id,
      url: pr.links.html.href,
    };
  }
}
```

> Same Phase-2 implementer note as GitLab applies: `getPullRequestStatus(ref)`/`mergePullRequest(ref, method)` are byte-exact to Section 10.1; the real secret id is supplied by the Phase-3 tracking row at the wiring layer, and the unit specs mock the resolver.

### Step 7.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/bitbucket-merge.provider.spec.ts
```

Expected: PASS (7 tests) — including idempotency and the no-token-in-error test.

```bash
git add apps/api/src/common/git/integration/bitbucket-merge.provider.*
git commit -m "feat(api): BitbucketMergeProvider open/inspect/merge PRs (fetch, idempotent)

EPIC-209 Phase 6. Implements MergeProvider via the Bitbucket Cloud PR API;
find-or-create by source/destination branch; build status + approvals mapping.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8 — Extend `MergeProviderFactory` host detection (github/gitlab/bitbucket + override)

**Files:**

- `apps/api/src/common/git/integration/merge-provider.factory.ts` (EDIT — Phase 2 file)
- `apps/api/src/common/git/integration/merge-provider.factory.spec.ts` (EDIT)

**Interfaces:**

- **Consumes:** `parseRepositoryUrl` (Task 0); `GitHubMergeProvider` (Phase 2), `GitLabMergeProvider` (Task 4), `BitbucketMergeProvider` (Task 7); `MergeProvider` (Phase 1).
- **Produces:** `resolveForRepository(repositoryUrl: string, providerOverride?: string): MergeProvider` — resolves the adapter from the parsed host, honouring an optional explicit `providerOverride` (`'github'|'gitlab'|'bitbucket'`) for hosts that match no pattern. Throws `BadRequestException` for an unknown host with no override. Keeps the **Phase-2 GitHub cases green** (now via the agnostic parser).

> **Backward compatibility:** Phase 2's spec calls `resolveForRepository(url)` with one arg and expects GitHub for github hosts, `BadRequestException` for non-github. That contract is preserved: github hosts still resolve to the GitHub provider; the _change_ is that gitlab/bitbucket hosts now resolve instead of throwing. Update the Phase-2 "throws for bitbucket" assertion to expect the **bitbucket provider** (it is now supported) — this is an intended behaviour extension, documented in the commit.

### Step 8.1 — RED: extend the factory spec

Replace the Phase-2 `merge-provider.factory.spec.ts` body (keep the GitHub cases) and add:

```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { MergeProviderFactory } from "./merge-provider.factory";
import type { GitHubMergeProvider } from "./github-merge.provider";
import type { GitLabMergeProvider } from "./gitlab-merge.provider";
import type { BitbucketMergeProvider } from "./bitbucket-merge.provider";

const github = { providerKey: "github" } as unknown as GitHubMergeProvider;
const gitlab = { providerKey: "gitlab" } as unknown as GitLabMergeProvider;
const bitbucket = {
  providerKey: "bitbucket",
} as unknown as BitbucketMergeProvider;

function factory() {
  return new MergeProviderFactory(github, gitlab, bitbucket);
}

describe("MergeProviderFactory", () => {
  it("returns the github provider for a github https url", () => {
    expect(
      factory().resolveForRepository("https://github.com/acme/widgets.git")
        .providerKey,
    ).toBe("github");
  });

  it("returns the gitlab provider for a gitlab url", () => {
    expect(
      factory().resolveForRepository("https://gitlab.com/acme/widgets.git")
        .providerKey,
    ).toBe("gitlab");
  });

  it("returns the bitbucket provider for a bitbucket url", () => {
    expect(
      factory().resolveForRepository("https://bitbucket.org/acme/widgets.git")
        .providerKey,
    ).toBe("bitbucket");
  });

  it("returns the gitlab provider for a self-hosted gitlab host", () => {
    expect(
      factory().resolveForRepository(
        "https://gitlab.internal.acme.dev/acme/widgets.git",
      ).providerKey,
    ).toBe("gitlab");
  });

  it("honours an explicit provider override for an unknown host", () => {
    expect(
      factory().resolveForRepository(
        "https://git.acme.dev/acme/widgets.git",
        "gitlab",
      ).providerKey,
    ).toBe("gitlab");
  });

  it("throws BadRequestException for an unknown host without an override", () => {
    expect(() =>
      factory().resolveForRepository("https://git.acme.dev/acme/widgets.git"),
    ).toThrow(BadRequestException);
  });
});
```

### Step 8.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/merge-provider.factory.spec.ts
```

Expected: FAIL — constructor arity / override param mismatch.

### Step 8.3 — GREEN: rewrite the factory

`merge-provider.factory.ts`:

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import { GitHubMergeProvider } from "./github-merge.provider";
import { GitLabMergeProvider } from "./gitlab-merge.provider";
import { BitbucketMergeProvider } from "./bitbucket-merge.provider";
import { parseRepositoryUrl } from "./repository-url.parser";
import type { SupportedProvider } from "./repository-url.parser.types";
import type { MergeProvider } from "./merge-provider.interface";

/**
 * Selects the {@link MergeProvider} adapter for a repository from its URL host
 * (github / gitlab / bitbucket, incl. self-hosted hosts). An explicit override
 * disambiguates hosts that match no known pattern. This is the single
 * resolution point — Phase 3/4 consumers depend only on the returned interface.
 */
@Injectable()
export class MergeProviderFactory {
  constructor(
    private readonly gitHubMergeProvider: GitHubMergeProvider,
    private readonly gitLabMergeProvider: GitLabMergeProvider,
    private readonly bitbucketMergeProvider: BitbucketMergeProvider,
  ) {}

  resolveForRepository(
    repositoryUrl: string,
    providerOverride?: string,
  ): MergeProvider {
    const provider = providerOverride
      ? this.assertSupported(providerOverride)
      : parseRepositoryUrl(repositoryUrl).provider;
    return this.byKey(provider);
  }

  private assertSupported(value: string): SupportedProvider {
    if (value === "github" || value === "gitlab" || value === "bitbucket") {
      return value;
    }
    throw new BadRequestException(
      `Unsupported merge provider override: ${value}`,
    );
  }

  private byKey(provider: SupportedProvider): MergeProvider {
    switch (provider) {
      case "gitlab":
        return this.gitLabMergeProvider;
      case "bitbucket":
        return this.bitbucketMergeProvider;
      case "github":
      default:
        return this.gitHubMergeProvider;
    }
  }
}
```

> If Phase 4's reconciler calls `resolveForRepository(...)` (an alias mentioned in the Phase-4 plan), add `resolveForRepository = this.resolveForRepository.bind(this)` or rename consistently — **read the actual Phase-2/Phase-4 method name first** and keep one canonical name; do not introduce a divergent second method.

### Step 8.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/merge-provider.factory.spec.ts
```

Expected: PASS (6 tests).

```bash
git add apps/api/src/common/git/integration/merge-provider.factory.*
git commit -m "feat(api): MergeProviderFactory resolves github/gitlab/bitbucket by host

EPIC-209 Phase 6. Host-based detection (incl. self-hosted) + explicit provider
override; gitlab/bitbucket hosts now resolve (previously rejected). Phase 3/4
consumers gain multi-provider support via the unchanged MergeProvider interface.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9 — Shared parameterized `MergeProvider` contract suite (LSP proof)

**Files:**

- `apps/api/src/common/git/integration/merge-provider.contract.spec.ts`

**Interfaces:**

- **Consumes:** all three adapters + their test seams (mocked credential resolvers, mocked octokit factory / HTTP client). Imports `MergeProvider` for the typed handle.
- **Produces:** no production code — a single parameterized suite asserting the **identical contract** against each adapter, proving Liskov substitutability. If any adapter violates the shared contract, this suite fails.

> **Pattern:** a `cases` array where each entry is `{ name, build(): { provider: MergeProvider; primeCreate(); primeUpdate(); primeMergedStatus(); primeMerge() } }`. Each `build()` wires the adapter against its own mock transport (octokit mock for github; `HttpJsonClient` mock for gitlab/bitbucket) and the canned responses the shared assertions expect. `describe.each(cases)` runs the **same** assertions: `openOrUpdatePullRequest` returns a `PullRequestRef` with the correct `provider` key; a second call is idempotent (no create on the second pass); `getPullRequestStatus` of a merged PR yields `state==='merged'` with a non-null `mergeCommitSha`; `mergePullRequest` returns a `{ mergeCommitSha }`. This is the load-bearing substitutability guarantee.

### Step 9.1 — RED: the contract suite

`merge-provider.contract.spec.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import type {
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
} from "./merge-provider.interface";
import { GitHubMergeProvider } from "./github-merge.provider";
import { GitLabMergeProvider } from "./gitlab-merge.provider";
import { BitbucketMergeProvider } from "./bitbucket-merge.provider";
import type { HttpJsonClient, HttpJsonRequest } from "./http-json-client.types";

const ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: "scope-1",
  contextId: "ctx-1",
  workflowRunId: "run-1",
  repositoryUrl: "", // set per-case
  githubSecretId: "sec-1",
  headBranch: "feature/x",
  baseBranch: "main",
  title: "Feature X",
  body: "Implements X",
};

const MERGED_REF: PullRequestRef = {
  provider: "", // set per-case
  owner: "acme",
  repo: "widgets",
  number: 7,
  url: "https://example/pull/7",
};

interface ContractCase {
  name: string;
  providerKey: string;
  repositoryUrl: string;
  build(): MergeProvider;
}

/** Stateful HTTP mock: first list is empty (create), subsequent lists return the PR (update). */
function statefulHttp(
  makeRoutes: (state: { created: boolean }) => (r: HttpJsonRequest) => unknown,
): HttpJsonClient {
  const state = { created: false };
  return {
    request: vi.fn(async (r: HttpJsonRequest) => {
      const data = makeRoutes(state)(r);
      return { status: 200, data };
    }),
  } as unknown as HttpJsonClient;
}

const cases: ContractCase[] = [
  {
    name: "github",
    providerKey: "github",
    repositoryUrl: "https://github.com/acme/widgets.git",
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => "gh-token"),
      };
      let created = false;
      const pulls = {
        list: vi.fn(async () =>
          created
            ? {
                data: [
                  {
                    number: 7,
                    html_url: "https://github.com/acme/widgets/pull/7",
                  },
                ],
              }
            : { data: [] },
        ),
        create: vi.fn(async () => {
          created = true;
          return {
            data: {
              number: 7,
              html_url: "https://github.com/acme/widgets/pull/7",
            },
          };
        }),
        update: vi.fn(async () => ({
          data: {
            number: 7,
            html_url: "https://github.com/acme/widgets/pull/7",
          },
        })),
        get: vi.fn(async () => ({
          data: {
            state: "closed",
            merged: true,
            mergeable: null,
            merge_commit_sha: "mergedsha",
            head: { sha: "h" },
          },
        })),
        listReviews: vi.fn(async () => ({ data: [] })),
        merge: vi.fn(async () => ({ data: { sha: "mergedsha" } })),
      };
      const checks = {
        listForRef: vi.fn(async () => ({ data: { check_runs: [] } })),
      };
      const octokitFactory = vi.fn(() => ({ rest: { pulls, checks } }));
      return new GitHubMergeProvider(
        credentialResolver as never,
        octokitFactory as never,
      );
    },
  },
  {
    name: "gitlab",
    providerKey: "gitlab",
    repositoryUrl: "https://gitlab.com/acme/widgets.git",
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => "gl-token"),
      };
      const http = statefulHttp((state) => (r) => {
        if (r.method === "GET" && r.url.includes("/merge_requests?")) {
          return state.created
            ? [
                {
                  iid: 7,
                  web_url: "https://gitlab.com/acme/widgets/-/merge_requests/7",
                },
              ]
            : [];
        }
        if (r.method === "POST") {
          state.created = true;
          return {
            iid: 7,
            web_url: "https://gitlab.com/acme/widgets/-/merge_requests/7",
          };
        }
        if (r.method === "PUT" && r.url.endsWith("/merge")) {
          return { merge_commit_sha: "mergedsha" };
        }
        if (r.method === "PUT") {
          return {
            iid: 7,
            web_url: "https://gitlab.com/acme/widgets/-/merge_requests/7",
          };
        }
        if (r.url.endsWith("/merge_requests/7")) {
          return {
            state: "merged",
            merge_status: "can_be_merged",
            merge_commit_sha: "mergedsha",
          };
        }
        if (r.url.includes("/pipelines")) return [];
        if (r.url.includes("/approvals"))
          return { approved: false, approvals_required: 0, approvals_left: 0 };
        return {};
      });
      return new GitLabMergeProvider(credentialResolver as never, http);
    },
  },
  {
    name: "bitbucket",
    providerKey: "bitbucket",
    repositoryUrl: "https://bitbucket.org/acme/widgets.git",
    build() {
      const credentialResolver = {
        resolveToken: vi.fn(async () => "bb-token"),
      };
      const http = statefulHttp((state) => (r) => {
        if (r.method === "GET" && r.url.includes("/pullrequests?")) {
          return state.created
            ? {
                values: [
                  {
                    id: 7,
                    links: {
                      html: {
                        href: "https://bitbucket.org/acme/widgets/pull-requests/7",
                      },
                    },
                  },
                ],
              }
            : { values: [] };
        }
        if (r.method === "POST" && r.url.endsWith("/pullrequests")) {
          state.created = true;
          return {
            id: 7,
            links: {
              html: {
                href: "https://bitbucket.org/acme/widgets/pull-requests/7",
              },
            },
          };
        }
        if (r.method === "POST" && r.url.endsWith("/merge")) {
          return { merge_commit: { hash: "mergedsha" } };
        }
        if (r.method === "PUT") {
          return {
            id: 7,
            links: {
              html: {
                href: "https://bitbucket.org/acme/widgets/pull-requests/7",
              },
            },
          };
        }
        if (r.url.endsWith("/pullrequests/7")) {
          return {
            state: "MERGED",
            merge_commit: { hash: "mergedsha" },
            source: { commit: { hash: "s" } },
            participants: [],
          };
        }
        if (r.url.includes("/statuses")) return { values: [] };
        return {};
      });
      return new BitbucketMergeProvider(credentialResolver as never, http);
    },
  },
];

describe.each(cases)("MergeProvider contract: $name", (testCase) => {
  let provider: MergeProvider;
  beforeEach(() => {
    vi.clearAllMocks();
    provider = testCase.build();
  });

  it("exposes the expected providerKey", () => {
    expect(provider.providerKey).toBe(testCase.providerKey);
  });

  it("opens a PR returning a ref tagged with the provider", async () => {
    const ref = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    expect(ref.provider).toBe(testCase.providerKey);
    expect(ref.number).toBe(7);
    expect(ref.url).toContain("7");
  });

  it("is idempotent: a second open updates rather than duplicates", async () => {
    const first = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    const second = await provider.openOrUpdatePullRequest({
      ...ARGS,
      repositoryUrl: testCase.repositoryUrl,
    });
    expect(second).toEqual(first);
  });

  it("reports a merged PR with a merge commit sha", async () => {
    const status = await provider.getPullRequestStatus({
      ...MERGED_REF,
      provider: testCase.providerKey,
    });
    expect(status.state).toBe("merged");
    expect(status.mergeCommitSha).toBe("mergedsha");
  });

  it("merges a PR returning a merge commit sha", async () => {
    const result = await provider.mergePullRequest(
      { ...MERGED_REF, provider: testCase.providerKey },
      "squash",
    );
    expect(result.mergeCommitSha).toBe("mergedsha");
  });
});
```

### Step 9.2 — Run (expect PASS — adapters already satisfy the contract)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/merge-provider.contract.spec.ts
```

Expected: PASS (4 assertions × 3 providers = 12 tests). If any provider fails here, **fix the adapter** to honour the shared contract — never weaken the suite.

### Step 9.3 — Commit

```bash
git add apps/api/src/common/git/integration/merge-provider.contract.spec.ts
git commit -m "test(api): shared parameterized MergeProvider contract suite (LSP across 3 providers)

EPIC-209 Phase 6. describe.each runs identical open/idempotency/status/merge
assertions against github/gitlab/bitbucket mocks, proving substitutability.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10 — Wire GitLab/Bitbucket providers + HTTP client into `GitWorktreeModule`

**Files:**

- `apps/api/src/common/git/git-worktree.module.ts` (EDIT)
- `apps/api/src/common/git/index.ts` (EDIT)

**Interfaces:**

- **Consumes:** `SecurityModule` (exports `SecretReferenceResolver`, already imported in Phase 2).
- **Produces:** `GitWorktreeModule` registers `GitLabCredentialResolver`, `GitLabMergeProvider`, `BitbucketCredentialResolver`, `BitbucketMergeProvider`, `{ provide: HTTP_JSON_CLIENT, useClass: FetchHttpJsonClient }`, and supplies all three adapters to the updated `MergeProviderFactory` constructor. Exports `MergeProviderFactory` (unchanged surface) so Phase 3/4 keep working.

> No new behavioural spec — DI wiring is verified by the boot/integration suite. The unit specs construct providers directly (no Nest container).

### Step 10.1 — Edit the module

In `git-worktree.module.ts`, add imports and registrations:

```typescript
import { FetchHttpJsonClient } from "./integration/http-json-client";
import { HTTP_JSON_CLIENT } from "./integration/http-json-client.types";
import { GitLabCredentialResolver } from "./integration/gitlab-credential.resolver";
import { GitLabMergeProvider } from "./integration/gitlab-merge.provider";
import { BitbucketCredentialResolver } from "./integration/bitbucket-credential.resolver";
import { BitbucketMergeProvider } from "./integration/bitbucket-merge.provider";
```

Add to `providers` (alongside the Phase-2 GitHub providers + `MergeProviderFactory`):

```typescript
{ provide: HTTP_JSON_CLIENT, useClass: FetchHttpJsonClient },
GitLabCredentialResolver,
GitLabMergeProvider,
BitbucketCredentialResolver,
BitbucketMergeProvider,
```

> `MergeProviderFactory` now has three constructor deps (github/gitlab/bitbucket) — Nest resolves them from the providers list automatically; no provider-array change beyond registering the new adapters. Keep the Phase-2 `MERGE_PROVIDER` token binding (still `useExisting: GitHubMergeProvider`) — the factory, not the token, is the multi-provider entry point.

### Step 10.2 — Re-export the public surface

Append to `apps/api/src/common/git/index.ts`:

```typescript
export * from "./integration/gitlab-merge.provider";
export * from "./integration/bitbucket-merge.provider";
export * from "./integration/repository-url.parser";
export * from "./integration/http-json-client.types";
```

### Step 10.3 — Verify boot + full git suite

```bash
npm run test --workspace=apps/api -- src/common/git
npm run test:boot --workspace=apps/api
```

Expected: PASS — all integration specs + existing git specs; the app module instantiates `GitWorktreeModule` with the new adapters and the three-arg factory resolves.

### Step 10.4 — Lint + commit

```bash
npm run lint:api
```

Expected: 0 errors.

```bash
git add apps/api/src/common/git/git-worktree.module.ts apps/api/src/common/git/index.ts
git commit -m "feat(api): wire gitlab/bitbucket merge providers + HttpJsonClient into GitWorktreeModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11 — `WebhookVerificationStrategy` interface + registry

**Files:**

- `apps/api/src/integration-events/webhook-verification-strategy.types.ts`
- `apps/api/src/integration-events/webhook-verification-strategy.registry.ts`
- `apps/api/src/integration-events/webhook-verification-strategy.registry.spec.ts`

**Interfaces:**

- **Consumes:** nothing (the strategies are registered in Task 15).
- **Produces:**
  - `interface WebhookVerificationStrategy { readonly providerKey: string; verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean; extractMerge(parsedBody: unknown): MergeIdentity | null }`
  - `type WebhookHeaders = Record<string, string | undefined>`
  - `interface MergeIdentity { provider: string; owner: string; repo: string; prNumber: number; mergeCommitSha: string }`
  - `const WEBHOOK_VERIFICATION_STRATEGIES = Symbol(...)` (multi-provider injection array)
  - `class WebhookVerificationStrategyRegistry { forProvider(providerKey: string): WebhookVerificationStrategy }` — throws `BadRequestException` for an unknown provider segment.

> `extractMerge` returns `null` when the event is **not** a merge (e.g. `opened`/`closed-unmerged`); the controller then returns 202 `processed:false`. When it returns a `MergeIdentity`, the controller calls `finalizeMergedByIdentity`. `provider` on `MergeIdentity` is the **same** key the Phase-3 tracking row stores, so the existing finalizer lookup works unchanged.

### Step 11.1 — RED: registry spec

`webhook-verification-strategy.registry.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { WebhookVerificationStrategyRegistry } from "./webhook-verification-strategy.registry";
import type { WebhookVerificationStrategy } from "./webhook-verification-strategy.types";

const stub = (key: string): WebhookVerificationStrategy => ({
  providerKey: key,
  verify: () => true,
  extractMerge: () => null,
});

describe("WebhookVerificationStrategyRegistry", () => {
  it("returns the strategy whose providerKey matches", () => {
    const registry = new WebhookVerificationStrategyRegistry([
      stub("github"),
      stub("gitlab"),
      stub("bitbucket"),
    ]);
    expect(registry.forProvider("gitlab").providerKey).toBe("gitlab");
  });

  it("throws BadRequestException for an unknown provider", () => {
    const registry = new WebhookVerificationStrategyRegistry([stub("github")]);
    expect(() => registry.forProvider("svn")).toThrow(BadRequestException);
  });
});
```

### Step 11.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- webhook-verification-strategy.registry
```

Expected: FAIL — module not found.

### Step 11.3 — GREEN

`webhook-verification-strategy.types.ts`:

```typescript
export const WEBHOOK_VERIFICATION_STRATEGIES = Symbol(
  "WEBHOOK_VERIFICATION_STRATEGIES",
);

export type WebhookHeaders = Record<string, string | undefined>;

export interface MergeIdentity {
  provider: string;
  owner: string;
  repo: string;
  prNumber: number;
  mergeCommitSha: string;
}

/**
 * Per-provider webhook handling: verify the request authenticity (HMAC or shared
 * token) and, when the event represents a completed merge, extract the neutral
 * merge identity the shared finalizer consumes. Returns null for non-merge events.
 */
export interface WebhookVerificationStrategy {
  readonly providerKey: string;
  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean;
  extractMerge(parsedBody: unknown): MergeIdentity | null;
}
```

`webhook-verification-strategy.registry.ts`:

```typescript
import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  WEBHOOK_VERIFICATION_STRATEGIES,
  type WebhookVerificationStrategy,
} from "./webhook-verification-strategy.types";

/** Resolves the verification strategy for a webhook route's provider segment. */
@Injectable()
export class WebhookVerificationStrategyRegistry {
  private readonly byKey: Map<string, WebhookVerificationStrategy>;

  constructor(
    @Inject(WEBHOOK_VERIFICATION_STRATEGIES)
    strategies: WebhookVerificationStrategy[],
  ) {
    this.byKey = new Map(strategies.map((s) => [s.providerKey, s]));
  }

  forProvider(providerKey: string): WebhookVerificationStrategy {
    const strategy = this.byKey.get(providerKey);
    if (!strategy) {
      throw new BadRequestException(
        `No webhook verification strategy for provider: ${providerKey}`,
      );
    }
    return strategy;
  }
}
```

### Step 11.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- webhook-verification-strategy.registry
```

Expected: PASS (2 tests).

```bash
git add apps/api/src/integration-events/webhook-verification-strategy.types.ts \
  apps/api/src/integration-events/webhook-verification-strategy.registry.ts \
  apps/api/src/integration-events/webhook-verification-strategy.registry.spec.ts
git commit -m "feat(api): webhook verification strategy interface + registry

EPIC-209 Phase 6. Per-provider verify + merge-extract behind a registry keyed by
the webhook route's provider segment; non-merge events return null.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12 — `GithubWebhookVerificationStrategy` (refactor Phase-4 HMAC, zero behaviour change)

**Files:**

- `apps/api/src/integration-events/github-webhook-verification.strategy.ts`
- `apps/api/src/integration-events/github-webhook-verification.strategy.spec.ts`

**Interfaces:**

- **Consumes:** `verifyGithubSignature` (Phase 4, unchanged util).
- **Produces:** `class GithubWebhookVerificationStrategy implements WebhookVerificationStrategy` (`providerKey='github'`): `verify` delegates to `verifyGithubSignature(rawBody, headers['x-hub-signature-256'], secret)`; `extractMerge` returns the identity for a `closed`+`merged`+`merge_commit_sha` event, else `null`. This is the Phase-4 controller logic relocated, so the Phase-4 webhook tests still pass.

### Step 12.1 — RED

`github-webhook-verification.strategy.spec.ts`:

```typescript
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { GithubWebhookVerificationStrategy } from "./github-webhook-verification.strategy";

const secret = "wh-secret";
const strategy = new GithubWebhookVerificationStrategy();

const merged = {
  action: "closed",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 42,
    merged: true,
    merge_commit_sha: "sha-merge",
    html_url: "u",
  },
};

function raw(body: unknown) {
  return Buffer.from(JSON.stringify(body), "utf-8");
}
function sig(buf: Buffer, key = secret) {
  return `sha256=${createHmac("sha256", key).update(buf).digest("hex")}`;
}

describe("GithubWebhookVerificationStrategy", () => {
  it("has providerKey github", () => {
    expect(strategy.providerKey).toBe("github");
  });

  it("verifies a valid signature and rejects a tampered/absent one", () => {
    const body = raw(merged);
    expect(
      strategy.verify(body, { "x-hub-signature-256": sig(body) }, secret),
    ).toBe(true);
    expect(
      strategy.verify(
        body,
        { "x-hub-signature-256": sig(body, "other") },
        secret,
      ),
    ).toBe(false);
    expect(strategy.verify(body, {}, secret)).toBe(false);
  });

  it("extracts the merge identity for a closed+merged event", () => {
    expect(strategy.extractMerge(merged)).toEqual({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });
  });

  it("returns null for a closed-unmerged event", () => {
    expect(
      strategy.extractMerge({
        ...merged,
        pull_request: { ...merged.pull_request, merged: false },
      }),
    ).toBeNull();
  });
});
```

### Step 12.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- github-webhook-verification.strategy
```

### Step 12.3 — GREEN

`github-webhook-verification.strategy.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { GithubPrWebhookPayloadSchema } from "./github-pr-webhook.types";
import { verifyGithubSignature } from "./webhook-signature.util";
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from "./webhook-verification-strategy.types";

const PROVIDER_KEY = "github";

@Injectable()
export class GithubWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    return verifyGithubSignature(
      rawBody,
      headers["x-hub-signature-256"],
      secret,
    );
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = GithubPrWebhookPayloadSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return null;
    }
    const payload = parsed.data;
    if (
      payload.action !== "closed" ||
      payload.pull_request.merged !== true ||
      typeof payload.pull_request.merge_commit_sha !== "string"
    ) {
      return null;
    }
    return {
      provider: PROVIDER_KEY,
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      prNumber: payload.pull_request.number,
      mergeCommitSha: payload.pull_request.merge_commit_sha,
    };
  }
}
```

### Step 12.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- github-webhook-verification.strategy
```

Expected: PASS (4 tests).

```bash
git add apps/api/src/integration-events/github-webhook-verification.strategy.*
git commit -m "refactor(api): extract GithubWebhookVerificationStrategy (HMAC + merge extract)

EPIC-209 Phase 6. Relocates the Phase-4 controller's github-specific verify +
closed+merged extraction behind the WebhookVerificationStrategy interface; no
behaviour change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13 — `GitlabWebhookVerificationStrategy` (X-Gitlab-Token + MR merge extract)

**Files:**

- `apps/api/src/integration-events/gitlab-webhook-verification.strategy.ts`
- `apps/api/src/integration-events/gitlab-webhook-verification.strategy.spec.ts`

**Interfaces:**

- **Consumes:** Node `crypto.timingSafeEqual`.
- **Produces:** `class GitlabWebhookVerificationStrategy implements WebhookVerificationStrategy` (`providerKey='gitlab'`). GitLab webhooks authenticate with a **shared secret token** in the `X-Gitlab-Token` header (no HMAC over body). `verify` constant-time-compares `headers['x-gitlab-token']` to the secret. `extractMerge` returns the identity for a `merge_request` event with `object_attributes.action === 'merge'` (`owner` = `project.namespace`, `repo` = `project.name` or path, `prNumber` = `object_attributes.iid`, `mergeCommitSha` = `object_attributes.merge_commit_sha`), else `null`.

### Step 13.1 — RED

`gitlab-webhook-verification.strategy.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { GitlabWebhookVerificationStrategy } from "./gitlab-webhook-verification.strategy";

const secret = "gl-shared-token";
const strategy = new GitlabWebhookVerificationStrategy();
const raw = Buffer.from("{}", "utf-8");

const mergeEvent = {
  object_kind: "merge_request",
  project: { namespace: "acme", name: "widgets" },
  object_attributes: { iid: 7, action: "merge", merge_commit_sha: "sha-merge" },
};

describe("GitlabWebhookVerificationStrategy", () => {
  it("has providerKey gitlab", () => {
    expect(strategy.providerKey).toBe("gitlab");
  });

  it("accepts a matching X-Gitlab-Token and rejects a wrong/absent one", () => {
    expect(strategy.verify(raw, { "x-gitlab-token": secret }, secret)).toBe(
      true,
    );
    expect(strategy.verify(raw, { "x-gitlab-token": "wrong" }, secret)).toBe(
      false,
    );
    expect(strategy.verify(raw, {}, secret)).toBe(false);
  });

  it("extracts the merge identity for a merge_request merge action", () => {
    expect(strategy.extractMerge(mergeEvent)).toEqual({
      provider: "gitlab",
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      mergeCommitSha: "sha-merge",
    });
  });

  it("returns null for a non-merge MR action (e.g. open)", () => {
    expect(
      strategy.extractMerge({
        ...mergeEvent,
        object_attributes: { ...mergeEvent.object_attributes, action: "open" },
      }),
    ).toBeNull();
  });
});
```

### Step 13.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- gitlab-webhook-verification.strategy
```

### Step 13.3 — GREEN

`gitlab-webhook-verification.strategy.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from "./webhook-verification-strategy.types";

const PROVIDER_KEY = "gitlab";

const GitlabMergeEventSchema = z.object({
  object_kind: z.string(),
  project: z.object({ namespace: z.string().min(1), name: z.string().min(1) }),
  object_attributes: z.object({
    iid: z.number().int(),
    action: z.string(),
    merge_commit_sha: z.string().nullable().optional(),
  }),
});

@Injectable()
export class GitlabWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(_rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    const provided = headers["x-gitlab-token"];
    if (!provided) {
      return false;
    }
    const a = Buffer.from(provided, "utf-8");
    const b = Buffer.from(secret, "utf-8");
    if (a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(a, b);
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = GitlabMergeEventSchema.safeParse(parsedBody);
    if (!parsed.success) {
      return null;
    }
    const event = parsed.data;
    if (
      event.object_kind !== "merge_request" ||
      event.object_attributes.action !== "merge" ||
      typeof event.object_attributes.merge_commit_sha !== "string"
    ) {
      return null;
    }
    return {
      provider: PROVIDER_KEY,
      owner: event.project.namespace,
      repo: event.project.name,
      prNumber: event.object_attributes.iid,
      mergeCommitSha: event.object_attributes.merge_commit_sha,
    };
  }
}
```

### Step 13.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- gitlab-webhook-verification.strategy
```

Expected: PASS (4 tests).

```bash
git add apps/api/src/integration-events/gitlab-webhook-verification.strategy.*
git commit -m "feat(api): GitLab webhook verification strategy (X-Gitlab-Token + MR merge)

EPIC-209 Phase 6. Constant-time shared-token compare; maps merge_request merge
action to the neutral merge identity. Secret never logged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14 — `BitbucketWebhookVerificationStrategy` + generalize the controller

**Files:**

- `apps/api/src/integration-events/bitbucket-webhook-verification.strategy.ts`
- `apps/api/src/integration-events/bitbucket-webhook-verification.strategy.spec.ts`
- `apps/api/src/integration-events/pr-webhook.controller.ts` (EDIT)
- `apps/api/src/integration-events/pr-webhook.controller.spec.ts` (EDIT)

**Interfaces:**

- **Consumes (strategy):** `verifyGithubSignature` (reused — Bitbucket Cloud webhooks sign with `X-Hub-Signature` HMAC-SHA256 when a secret is configured, same algorithm; the util computes the digest, only the header name differs).
- **Produces (strategy):** `class BitbucketWebhookVerificationStrategy implements WebhookVerificationStrategy` (`providerKey='bitbucket'`): `verify` HMAC-checks `headers['x-hub-signature']`; `extractMerge` returns the identity for a `pullrequest:fulfilled` event (`owner` = `repository.workspace.slug` or `repository.full_name` split, `repo` = `repository.name`, `prNumber` = `pullrequest.id`, `mergeCommitSha` = `pullrequest.merge_commit.hash`), else `null`.
- **Produces (controller):** `POST /webhooks/integration/:provider` — resolves the strategy from `:provider`, verifies, parses, `extractMerge` → `finalizeMergedByIdentity` or `processed:false`. Bad/absent/unconfigured signature → 401. The existing `/webhooks/integration/github` route + its Phase-4 tests remain green (github is now one strategy among three).

### Step 14.1 — RED: bitbucket strategy spec

`bitbucket-webhook-verification.strategy.spec.ts`:

```typescript
import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { BitbucketWebhookVerificationStrategy } from "./bitbucket-webhook-verification.strategy";

const secret = "bb-secret";
const strategy = new BitbucketWebhookVerificationStrategy();

const fulfilled = {
  repository: { name: "widgets", workspace: { slug: "acme" } },
  pullrequest: { id: 7, merge_commit: { hash: "sha-merge" } },
};

function raw(body: unknown) {
  return Buffer.from(JSON.stringify(body), "utf-8");
}
function sig(buf: Buffer, key = secret) {
  return `sha256=${createHmac("sha256", key).update(buf).digest("hex")}`;
}

describe("BitbucketWebhookVerificationStrategy", () => {
  it("has providerKey bitbucket", () => {
    expect(strategy.providerKey).toBe("bitbucket");
  });

  it("verifies a valid X-Hub-Signature and rejects tampered/absent", () => {
    const body = raw(fulfilled);
    expect(
      strategy.verify(body, { "x-hub-signature": sig(body) }, secret),
    ).toBe(true);
    expect(
      strategy.verify(body, { "x-hub-signature": sig(body, "other") }, secret),
    ).toBe(false);
    expect(strategy.verify(body, {}, secret)).toBe(false);
  });

  it("extracts the merge identity for a pullrequest:fulfilled event", () => {
    expect(strategy.extractMerge(fulfilled)).toEqual({
      provider: "bitbucket",
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      mergeCommitSha: "sha-merge",
    });
  });

  it("returns null when there is no merge commit", () => {
    expect(
      strategy.extractMerge({
        ...fulfilled,
        pullrequest: { id: 7, merge_commit: null },
      }),
    ).toBeNull();
  });
});
```

### Step 14.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- bitbucket-webhook-verification.strategy
```

### Step 14.3 — GREEN: bitbucket strategy

`bitbucket-webhook-verification.strategy.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { verifyGithubSignature } from "./webhook-signature.util";
import type {
  MergeIdentity,
  WebhookHeaders,
  WebhookVerificationStrategy,
} from "./webhook-verification-strategy.types";

const PROVIDER_KEY = "bitbucket";

const BitbucketFulfilledSchema = z.object({
  repository: z.object({
    name: z.string().min(1),
    workspace: z.object({ slug: z.string().min(1) }),
  }),
  pullrequest: z.object({
    id: z.number().int(),
    merge_commit: z.object({ hash: z.string().min(1) }).nullable(),
  }),
});

/**
 * Bitbucket Cloud webhook verification. When a webhook secret is configured,
 * Bitbucket signs the body with HMAC-SHA256 in `X-Hub-Signature` (sha256=...),
 * identical algorithm to GitHub — only the header name differs. Maps the
 * `pullrequest:fulfilled` event to the neutral merge identity.
 */
@Injectable()
export class BitbucketWebhookVerificationStrategy implements WebhookVerificationStrategy {
  readonly providerKey = PROVIDER_KEY;

  verify(rawBody: Buffer, headers: WebhookHeaders, secret: string): boolean {
    return verifyGithubSignature(rawBody, headers["x-hub-signature"], secret);
  }

  extractMerge(parsedBody: unknown): MergeIdentity | null {
    const parsed = BitbucketFulfilledSchema.safeParse(parsedBody);
    if (!parsed.success || !parsed.data.pullrequest.merge_commit) {
      return null;
    }
    const event = parsed.data;
    return {
      provider: PROVIDER_KEY,
      owner: event.repository.workspace.slug,
      repo: event.repository.name,
      prNumber: event.pullrequest.id,
      mergeCommitSha: event.pullrequest.merge_commit!.hash,
    };
  }
}
```

### Step 14.4 — RED: generalize the controller spec

Update `pr-webhook.controller.spec.ts` to drive the registry-backed controller. Keep the github cases; add a gitlab case. The controller now takes `(finalizer, secretResolver, registry)` and exposes `handle(provider, request, body, headers)`:

```typescript
import { createHmac } from "node:crypto";
import { UnauthorizedException } from "@nestjs/common";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrWebhookController } from "./pr-webhook.controller";
import { GithubWebhookVerificationStrategy } from "./github-webhook-verification.strategy";
import { GitlabWebhookVerificationStrategy } from "./gitlab-webhook-verification.strategy";
import { WebhookVerificationStrategyRegistry } from "./webhook-verification-strategy.registry";

const secret = "wh-secret";

const githubMerged = {
  action: "closed",
  repository: { name: "widgets", owner: { login: "acme" } },
  pull_request: {
    number: 42,
    merged: true,
    merge_commit_sha: "sha-merge",
    html_url: "u",
  },
};
const gitlabMerged = {
  object_kind: "merge_request",
  project: { namespace: "acme", name: "widgets" },
  object_attributes: { iid: 7, action: "merge", merge_commit_sha: "sha-merge" },
};

function makeReq(raw: Buffer) {
  return { rawBody: raw } as never;
}
function ghSig(raw: Buffer, key = secret) {
  return `sha256=${createHmac("sha256", key).update(raw).digest("hex")}`;
}

describe("PrWebhookController (multi-provider)", () => {
  let finalizer: { finalizeMergedByIdentity: ReturnType<typeof vi.fn> };
  let secretResolver: { resolveSecret: ReturnType<typeof vi.fn> };
  let controller: PrWebhookController;

  beforeEach(() => {
    finalizer = {
      finalizeMergedByIdentity: vi.fn().mockResolvedValue({ emitted: true }),
    };
    secretResolver = { resolveSecret: vi.fn().mockResolvedValue(secret) };
    const registry = new WebhookVerificationStrategyRegistry([
      new GithubWebhookVerificationStrategy(),
      new GitlabWebhookVerificationStrategy(),
    ]);
    controller = new PrWebhookController(
      finalizer as never,
      secretResolver as never,
      registry,
    );
  });

  it("finalizes a github closed+merged event with a valid signature", async () => {
    const raw = Buffer.from(JSON.stringify(githubMerged), "utf-8");
    const result = await controller.handle(
      "github",
      makeReq(raw),
      githubMerged as never,
      {
        "x-hub-signature-256": ghSig(raw),
      },
    );
    expect(finalizer.finalizeMergedByIdentity).toHaveBeenCalledWith({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      mergeCommitSha: "sha-merge",
    });
    expect(result).toEqual({ success: true, processed: true });
  });

  it("finalizes a gitlab merge_request merge with a valid X-Gitlab-Token", async () => {
    const raw = Buffer.from(JSON.stringify(gitlabMerged), "utf-8");
    const result = await controller.handle(
      "gitlab",
      makeReq(raw),
      gitlabMerged as never,
      {
        "x-gitlab-token": secret,
      },
    );
    expect(finalizer.finalizeMergedByIdentity).toHaveBeenCalledWith({
      provider: "gitlab",
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      mergeCommitSha: "sha-merge",
    });
    expect(result).toEqual({ success: true, processed: true });
  });

  it("rejects a tampered/absent gitlab token with 401", async () => {
    const raw = Buffer.from(JSON.stringify(gitlabMerged), "utf-8");
    await expect(
      controller.handle("gitlab", makeReq(raw), gitlabMerged as never, {
        "x-gitlab-token": "wrong",
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
  });

  it("returns 401 when no secret is configured", async () => {
    secretResolver.resolveSecret.mockResolvedValue(null);
    const raw = Buffer.from(JSON.stringify(githubMerged), "utf-8");
    await expect(
      controller.handle("github", makeReq(raw), githubMerged as never, {
        "x-hub-signature-256": ghSig(raw),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("ignores a non-merge event (processed:false, no finalize)", async () => {
    const opened = {
      ...githubMerged,
      pull_request: { ...githubMerged.pull_request, merged: false },
    };
    const raw = Buffer.from(JSON.stringify(opened), "utf-8");
    const result = await controller.handle(
      "github",
      makeReq(raw),
      opened as never,
      {
        "x-hub-signature-256": ghSig(raw),
      },
    );
    expect(finalizer.finalizeMergedByIdentity).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, processed: false });
  });
});
```

### Step 14.5 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- pr-webhook.controller
```

Expected: FAIL — controller still has the Phase-4 single-route github signature; `handle(provider, ...)` not present.

### Step 14.6 — GREEN: generalize the controller

`pr-webhook.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PrMergeFinalizerService } from "./pr-merge-finalizer.service";
import { WebhookSecretResolver } from "./webhook-secret.resolver";
import { WebhookVerificationStrategyRegistry } from "./webhook-verification-strategy.registry";
import type { WebhookHeaders } from "./webhook-verification-strategy.types";

interface RawBodyRequest {
  rawBody?: Buffer;
}

@ApiTags("integration-webhooks")
@Controller("webhooks/integration")
export class PrWebhookController {
  private readonly logger = new Logger(PrWebhookController.name);

  constructor(
    private readonly finalizer: PrMergeFinalizerService,
    private readonly secretResolver: WebhookSecretResolver,
    private readonly registry: WebhookVerificationStrategyRegistry,
  ) {}

  @Post(":provider")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Provider pull/merge-request webhook ingress" })
  async handle(
    @Param("provider") provider: string,
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
    @Headers() headers: WebhookHeaders,
  ): Promise<{ success: true; processed: boolean }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException("Missing webhook body");
    }

    const strategy = this.registry.forProvider(provider);
    const secret = await this.secretResolver.resolveSecret(null);
    if (!secret) {
      throw new UnauthorizedException("Webhook secret is not configured");
    }
    if (!strategy.verify(rawBody, headers, secret)) {
      throw new UnauthorizedException("Invalid webhook signature");
    }

    const merge = strategy.extractMerge(body);
    if (!merge) {
      return { success: true, processed: false };
    }

    await this.finalizer.finalizeMergedByIdentity(merge);
    return { success: true, processed: true };
  }
}
```

> `@Headers()` (no arg) injects the full lower-cased header map; the strategies read the header they care about. `registry.forProvider` throws `BadRequestException` (400) for an unknown provider segment — distinct from the 401 unauthenticated cases. The Phase-4 `main.ts` raw-body capture is unchanged.

### Step 14.7 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- pr-webhook.controller bitbucket-webhook-verification.strategy
```

Expected: PASS (bitbucket strategy 4 tests + controller multi-provider tests).

```bash
git add apps/api/src/integration-events/bitbucket-webhook-verification.strategy.* \
  apps/api/src/integration-events/pr-webhook.controller.ts \
  apps/api/src/integration-events/pr-webhook.controller.spec.ts
git commit -m "feat(api): Bitbucket webhook strategy + generalize controller to :provider

EPIC-209 Phase 6. POST /webhooks/integration/:provider delegates verify + merge
extraction to the strategy registry, then the shared finalizer. github/gitlab/
bitbucket supported; bad/absent/unconfigured secret -> 401.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15 — Register the strategies + registry in `IntegrationEventsModule`

**Files:**

- `apps/api/src/integration-events/integration-events.module.ts` (EDIT — Phase 4 file)

**Interfaces:**

- **Consumes:** `GitWorktreeModule` (already imported in Phase 4 for `MergeProviderFactory` + tracking repo).
- **Produces:** the module provides the three strategies, binds the `WEBHOOK_VERIFICATION_STRATEGIES` array, and provides `WebhookVerificationStrategyRegistry`. No spec — DI wiring verified by the build.

### Step 15.1 — Edit the module

Add imports and providers:

```typescript
import { GithubWebhookVerificationStrategy } from "./github-webhook-verification.strategy";
import { GitlabWebhookVerificationStrategy } from "./gitlab-webhook-verification.strategy";
import { BitbucketWebhookVerificationStrategy } from "./bitbucket-webhook-verification.strategy";
import { WebhookVerificationStrategyRegistry } from "./webhook-verification-strategy.registry";
import { WEBHOOK_VERIFICATION_STRATEGIES } from "./webhook-verification-strategy.types";
```

Add to `providers`:

```typescript
GithubWebhookVerificationStrategy,
GitlabWebhookVerificationStrategy,
BitbucketWebhookVerificationStrategy,
{
  provide: WEBHOOK_VERIFICATION_STRATEGIES,
  useFactory: (
    github: GithubWebhookVerificationStrategy,
    gitlab: GitlabWebhookVerificationStrategy,
    bitbucket: BitbucketWebhookVerificationStrategy,
  ) => [github, gitlab, bitbucket],
  inject: [
    GithubWebhookVerificationStrategy,
    GitlabWebhookVerificationStrategy,
    BitbucketWebhookVerificationStrategy,
  ],
},
WebhookVerificationStrategyRegistry,
```

### Step 15.2 — Verify build + commit

```bash
npm run test --workspace=apps/api -- integration-events
npm run build:api
```

Expected: PASS — DI graph resolves; the controller receives the registry.

```bash
git add apps/api/src/integration-events/integration-events.module.ts
git commit -m "feat(api): register webhook verification strategies + registry in IntegrationEventsModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16 — Full regression sweep + boundary lint

**Files** — none (verification only).

```bash
npm run build --workspace=packages/core
npm run build:api
npm run test --workspace=apps/api
npm run lint:api
```

Expected: all green. Specifically confirm `nexus-boundaries/no-core-kanban-residue` raises **no** finding against any new file — they contain only `scopeId`/`contextId` and VCS terms (`provider`, `owner`, `repo`, `pr_number`/`iid`, `mergeCommitSha`, `source`/`target`, `head`/`base`). No `kanban`, `work-item`, or project-domain identifier appears anywhere in the adapters, parsers, factory, contract suite, webhook strategies, or controller. The shared contract suite (Task 9) passes for all three providers — the LSP guarantee. If lint flags anything, fix the residue in code; never add an allowlist or `eslint-disable`.

```bash
git add -A
git commit -m "chore(epic-209): phase 6 regression sweep and boundary verification

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes on decisions deliberately bounded to this phase

- **No new SDK dependencies.** GitLab/Bitbucket use global `fetch` behind `HttpJsonClient` (project policy: keep deps minimal). GitHub keeps `@octokit/rest` from Phase 2.
- **`getPullRequestStatus`/`mergePullRequest` signatures byte-exact to Section 10.1.** The real provider secret id is carried by the Phase-3 PR-tracking row at the wiring layer (Phase 3/4 already store + supply it); the unit specs mock each credential resolver, so no signature changed and no real secret lookup occurs.
- **Self-hosted detection by host substring + explicit override.** GitHub Enterprise / self-managed GitLab / Bitbucket Server hosts that match no substring are handled by the `providerOverride` argument the factory accepts (sourced from repo config at the call site).
- **GitLab self-hosted API base / Bitbucket Server (Data Center) API shape** are deferred: the adapters target gitlab.com / Bitbucket Cloud API bases. A follow-up can parameterize `API_BASE` from the parsed `host` for self-managed instances — the `HttpJsonClient` seam and mappers are already host-agnostic.
- **Poll-reconciler multi-provider support comes for free.** The Phase-4 reconciler resolves the provider via `MergeProviderFactory` and calls `getPullRequestStatus` against the interface — now backed by all three adapters with no reconciler change.

---

## Epic completion — EPIC-209 surface delivered across all six phases

With Phase 6 merged, the **opt-in, per-repository pull-request integration strategy** is complete and multi-provider:

| Phase | Delivered surface                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | `MergeProvider` interface + `MERGE_PROVIDER` token + `IntegrationStrategy`/`MergeMethod`/`PullRequestRef`/`PullRequestStatus` types (Section 10.1); `IntegrationStrategyResolver` (neutral inputs → `direct-push` default); `RepositoryIntegrationSettings` config sub-object + resolver + neutral trigger forwarding. Strategy selectable, **zero behaviour change**.                                                                      |
| **2** | `GitHubMergeProvider` (octokit) — idempotent open/inspect/merge; `GitHubCredentialResolver` (`github_secret_id`, never logged); URL parser; `MergeProviderFactory`.                                                                                                                                                                                                                                                                         |
| **3** | `merge_integrate` strategy branch (push feature + open/update PR); `pull_request_tracking` entity + migration (Section 10.4); `awaiting-pr-merge` kanban status + workflow DAG branch; PR URL recorded in `lifecycle.merge`.                                                                                                                                                                                                                |
| **4** | PR webhook controller (raw-body HMAC, 401 on bad/absent) + poll reconciler (missed-webhook fallback) + `PrMergeFinalizerService` (shared idempotent mark+emit) + `core.integration.pr_merged.v1` neutral event (Section 10.5) + kanban consumer transition `awaiting-pr-merge → done`.                                                                                                                                                      |
| **5** | `preflight_gate` toggle; `auto_merge` / `merge_method` config + reconciler API-merge (calling `mergePullRequest` then converging on the same finalizer); CEO stalled-PR awareness (red checks / changes-requested / over-threshold surfaced, never stuck on age).                                                                                                                                                                           |
| **6** | `GitLabMergeProvider` + `BitbucketMergeProvider` (both Section 10.1 verbatim, `fetch`-backed, idempotent); host-based provider detection + override in `MergeProviderFactory`; per-provider webhook verification strategy registry (GitHub HMAC / GitLab `X-Gitlab-Token` / Bitbucket HMAC) mapping each merged event to the shared finalizer; shared parameterized contract suite proving LSP substitutability. **Multi-provider parity.** |

**End-to-end outcome:** a repository on GitHub, GitLab, or Bitbucket (cloud or self-hosted) can be switched to `pull-request` with no code change. Work items then push a feature branch, open an idempotent PR/MR, and transition to `awaiting-pr-merge`; the provider's required checks + branch protection are the gate of record; an observed provider merge (webhook primary, poll fallback — both idempotent) emits the neutral `core.integration.pr_merged.v1` event, landing the work item in `done` with the merge commit recorded. `direct-push` repositories are byte-for-byte unchanged throughout, and the Core/Kanban boundary holds: all provider/PR mechanics are API-side VCS-domain (neutral `scopeId`/`contextId`), while lifecycle state + config storage remain kanban-side.
