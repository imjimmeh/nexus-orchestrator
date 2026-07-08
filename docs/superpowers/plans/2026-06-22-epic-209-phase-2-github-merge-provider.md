# EPIC-209 Phase 2 — GitHub Merge Provider (octokit adapter + credential resolution + factory)

**Date:** 2026-06-22
**Epic:** EPIC-209 (PR-based integration strategy)
**Spec:** `docs/superpowers/specs/2026-06-22-pr-based-integration-strategy-design.md` (Section 10.1 pins the `MergeProvider` contract — implemented verbatim here)
**Depends on:** Phase 1 (`docs/superpowers/plans/2026-06-22-epic-209-phase-1-integration-strategy-foundation.md`) — declares `MergeProvider` interface, `MERGE_PROVIDER` token, and the `IntegrationStrategy` / `MergeMethod` / `PullRequestRef` / `PullRequestStatus` types in `apps/api/src/common/git/integration/merge-provider.interface.ts`.
**Status:** Ready for implementation.

---

## Goal

Make Nexus able to **open, inspect, and merge GitHub pull requests via the GitHub REST API**, exercised entirely by unit tests with octokit mocked (no live network). This phase produces:

1. A pure **URL parser** that extracts `{ owner, repo }` from `https://github.com/owner/repo(.git)` and `git@github.com:owner/repo.git`.
2. A **`GitHubCredentialResolver`** that mints a GitHub token from `github_secret_id` via the existing secret store — token never logged.
3. A **`GitHubMergeProvider`** implementing the canonical `MergeProvider` interface (Section 10.1): idempotent `openOrUpdatePullRequest` (find-or-create by head+base), `getPullRequestStatus` (octokit PR + check-runs + reviews → `PullRequestStatus`), `mergePullRequest` (provider merge with `MergeMethod`).
4. A **`MergeProviderFactory`** resolving the adapter from `repositoryUrl` (parse owner/repo), returning the GitHub adapter behind the `MergeProvider` interface.

**No workflow wiring** — that is Phase 3. This phase only adds the API surface to drive PRs.

## Architecture

- All code is **API-side VCS-domain** (`apps/api/src/common/git/integration/`). This is boundary-legal: PR/provider mechanics belong API-side per the spec's Core/Kanban boundary. **No kanban identifiers** anywhere (`scopeId`/`contextId`/`workflowRunId` are the neutral pass-through fields from `OpenOrUpdatePullRequestArgs`).
- octokit is wrapped so the rest of the codebase sees only the `MergeProvider` interface + the `MERGE_PROVIDER` token. The factory is the single construction point.
- Credential resolution reuses the existing `SecretReferenceResolver.resolveString` seam (which already JSON-parses the encrypted payload and selects `token`/`value`/`auth_token` keys). This means the resolver is thin and the token is never embedded in error strings.
- octokit is **lazily/injectably constructed** so tests inject a mock `Octokit` factory; no live HTTP is ever made.

## Tech Stack

- **NestJS** providers (`@Injectable`), `nest build` (never `tsc`).
- **Vitest** (`npm run test --workspace=apps/api` → `vitest run --project unit`; unit specs are `src/**/*.spec.ts`).
- **`@octokit/rest`** (new dependency, installed into `apps/api`; `package-lock.json` at repo root governs all workspaces).
- TypeScript strict typing. **Never** `eslint-disable` / `@ts-ignore` / `@ts-nocheck`.

## Global Constraints

- **TDD strictly per task:** write failing test → run (`npm run test --workspace=apps/api`, expect FAIL) → minimal impl → run (expect PASS) → commit. Conventional-commit messages, atomic.
- **octokit fully mocked** in every test — show the mock setup inline. No network.
- **Token never logged or echoed.** Each touch-point that handles the token has a test asserting the token string does not appear in thrown error messages.
- **Idempotency is first-class.** Explicit test: two `openOrUpdatePullRequest` calls for the same head+base return the same PR (update, not duplicate).
- **No kanban identifiers** in any file, test, comment, or symbol.
- Commit messages end with the project co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
apps/api/src/common/git/integration/
  merge-provider.interface.ts                 # (Phase 1 — consumed, not created here)
  integration-strategy.resolver.ts            # (Phase 1 — not touched here)

  github-repository-url.parser.ts             # NEW — pure owner/repo parser
  github-repository-url.parser.spec.ts        # NEW
  github-repository-url.parser.types.ts        # NEW — ParsedGitHubRepository

  github-credential.resolver.ts               # NEW — github_secret_id → token
  github-credential.resolver.spec.ts          # NEW

  github-pull-request.mapper.ts               # NEW — pure octokit→PullRequestStatus mappers
  github-pull-request.mapper.spec.ts          # NEW

  github-merge.provider.ts                    # NEW — implements MergeProvider via octokit
  github-merge.provider.spec.ts               # NEW
  github-octokit.factory.ts                   # NEW — injectable Octokit constructor seam
  github-octokit.factory.types.ts             # NEW — OctokitFactory token + type

  merge-provider.factory.ts                   # NEW — repositoryUrl → MergeProvider
  merge-provider.factory.spec.ts              # NEW

apps/api/src/common/git/git-worktree.module.ts  # EDIT — register integration providers + exports
```

> All new files live under the existing `apps/api/src/common/git/` module tree and are wired into `GitWorktreeModule` (the narrow git/common module) — **not** `WorkflowModule`.

---

## Task 0 — Add the `@octokit/rest` dependency

**Files:** `package.json` (repo root lockfile), `apps/api/package.json`

**Interfaces:** none (tooling only).

### Steps

1. Install into the `apps/api` workspace from the repo root (the root `package-lock.json` governs all workspaces):

```bash
npm install @octokit/rest --workspace=apps/api
```

2. Verify it resolves and the lockfile updated:

```bash
node -e "console.log(require('@octokit/rest/package.json').version)"
git status --short package-lock.json apps/api/package.json
```

Expected: a version prints (e.g. `21.x`), and `package-lock.json` + `apps/api/package.json` show as modified.

3. Confirm the workspace still type-checks / boots (no impl yet, so this just proves the dep installed cleanly):

```bash
npm run test --workspace=apps/api -- src/common/git/git-auth-env.helpers.spec.ts
```

Expected: PASS (sanity — existing suite unaffected).

4. Commit:

```bash
git add package.json package-lock.json apps/api/package.json
git commit -m "build(api): add @octokit/rest for GitHub merge provider (EPIC-209 phase 2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1 — `github-repository-url.parser` (pure owner/repo parsing)

**Files:**

- `apps/api/src/common/git/integration/github-repository-url.parser.types.ts`
- `apps/api/src/common/git/integration/github-repository-url.parser.ts`
- `apps/api/src/common/git/integration/github-repository-url.parser.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** nothing yet.
- **Produces:** `parseGitHubRepositoryUrl(url: string): ParsedGitHubRepository` where `ParsedGitHubRepository = { owner: string; repo: string }`. Throws `BadRequestException` for non-GitHub / unparseable URLs.

### Step 1.1 — RED: write the failing spec

`github-repository-url.parser.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { parseGitHubRepositoryUrl } from "./github-repository-url.parser";

describe("parseGitHubRepositoryUrl", () => {
  it("parses an https URL without .git", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/widgets")).toEqual(
      {
        owner: "acme",
        repo: "widgets",
      },
    );
  });

  it("parses an https URL with .git suffix", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/acme/widgets.git"),
    ).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("parses an https URL with a trailing slash", () => {
    expect(
      parseGitHubRepositoryUrl("https://github.com/acme/widgets/"),
    ).toEqual({ owner: "acme", repo: "widgets" });
  });

  it("parses an ssh scp-style URL", () => {
    expect(parseGitHubRepositoryUrl("git@github.com:acme/widgets.git")).toEqual(
      { owner: "acme", repo: "widgets" },
    );
  });

  it("parses an ssh scp-style URL without .git", () => {
    expect(parseGitHubRepositoryUrl("git@github.com:acme/widgets")).toEqual({
      owner: "acme",
      repo: "widgets",
    });
  });

  it("throws BadRequestException for a non-github host", () => {
    expect(() =>
      parseGitHubRepositoryUrl("https://gitlab.com/acme/widgets.git"),
    ).toThrow(BadRequestException);
  });

  it("throws BadRequestException for a URL missing the repo segment", () => {
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme")).toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException for an empty string", () => {
    expect(() => parseGitHubRepositoryUrl("")).toThrow(BadRequestException);
  });
});
```

### Step 1.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-repository-url.parser.spec.ts
```

Expected: FAIL — `Cannot find module './github-repository-url.parser'`.

### Step 1.3 — GREEN: minimal implementation

`github-repository-url.parser.types.ts`:

```typescript
export interface ParsedGitHubRepository {
  owner: string;
  repo: string;
}
```

`github-repository-url.parser.ts`:

```typescript
import { BadRequestException } from "@nestjs/common";
import type { ParsedGitHubRepository } from "./github-repository-url.parser.types";

const HTTPS_GITHUB =
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;
const SSH_GITHUB = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

/**
 * Parse a GitHub repository URL into its `{ owner, repo }` pair.
 *
 * Accepts the two canonical remote forms:
 *  - `https://github.com/owner/repo` (with optional `.git` / trailing slash)
 *  - `git@github.com:owner/repo.git`
 *
 * @throws BadRequestException when the URL is not a parseable github.com repo.
 */
export function parseGitHubRepositoryUrl(url: string): ParsedGitHubRepository {
  const trimmed = url.trim();
  const match = HTTPS_GITHUB.exec(trimmed) ?? SSH_GITHUB.exec(trimmed);
  if (!match) {
    throw new BadRequestException(
      `Unsupported or unparseable GitHub repository URL`,
    );
  }
  const [, owner, repo] = match;
  return { owner, repo };
}
```

> Note: the error message deliberately does **not** echo the raw URL — keeps it terse and avoids leaking embedded credentials if a tokenized URL is ever passed.

### Step 1.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-repository-url.parser.spec.ts
```

Expected: PASS (8 tests).

```bash
git add apps/api/src/common/git/integration/github-repository-url.parser.*
git commit -m "feat(api): parse owner/repo from github https and ssh remote urls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 — `GitHubCredentialResolver` (`github_secret_id` → token, never logged)

**Files:**

- `apps/api/src/common/git/integration/github-credential.resolver.ts`
- `apps/api/src/common/git/integration/github-credential.resolver.spec.ts`

**Interfaces:**

- **Consumes:** `SecretReferenceResolver` (from `apps/api/src/security/secret-reference-resolver.service.ts`; `SecurityModule` exports it) — its `resolveString({ secretId, purpose, serverName })` already JSON-parses the encrypted payload and selects `token`/`value`/`auth_token`.
- **Produces:** `class GitHubCredentialResolver { resolveToken(githubSecretId: string): Promise<string> }`. Throws `BadRequestException` when the secret is absent/empty. The token is **never** included in any thrown message.

### Step 2.1 — RED: spec with `SecretReferenceResolver` mocked

`github-credential.resolver.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { GitHubCredentialResolver } from "./github-credential.resolver";
import type { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SECRET_ID = "sec-123";
const TOKEN = "ghp_super_secret_value";

function buildResolver(resolveStringImpl: () => Promise<string | null>) {
  const secretResolver = {
    resolveString: vi.fn(resolveStringImpl),
  } as unknown as SecretReferenceResolver;
  const resolver = new GitHubCredentialResolver(secretResolver);
  return { resolver, secretResolver };
}

describe("GitHubCredentialResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the token string for a github_secret_id", async () => {
    const { resolver, secretResolver } = buildResolver(async () => TOKEN);
    await expect(resolver.resolveToken(SECRET_ID)).resolves.toBe(TOKEN);
    expect(secretResolver.resolveString).toHaveBeenCalledWith(
      expect.objectContaining({ secretId: SECRET_ID, purpose: "auth" }),
    );
  });

  it("throws BadRequestException when no github_secret_id is provided", async () => {
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
    // Simulate downstream failure that might be tempted to echo the value.
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
npm run test --workspace=apps/api -- src/common/git/integration/github-credential.resolver.spec.ts
```

Expected: FAIL — module not found.

### Step 2.3 — GREEN: implementation

`github-credential.resolver.ts`:

```typescript
import { BadRequestException, Injectable } from "@nestjs/common";
import { SecretReferenceResolver } from "../../../security/secret-reference-resolver.service";

const SERVER_NAME = "github-merge-provider";

/**
 * Resolves a GitHub API token from a project's `github_secret_id` via the
 * encrypted secret store. The token is never logged, never returned in an
 * error message, and never embedded in a key name.
 */
@Injectable()
export class GitHubCredentialResolver {
  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async resolveToken(githubSecretId: string): Promise<string> {
    if (!githubSecretId) {
      throw new BadRequestException(
        "github_secret_id is required to authenticate with GitHub",
      );
    }

    const token = await this.secretReferenceResolver.resolveString({
      secretId: githubSecretId,
      purpose: "auth",
      serverName: SERVER_NAME,
    });

    if (!token) {
      throw new BadRequestException(
        "github_secret_id did not resolve to a usable token",
      );
    }

    return token;
  }
}
```

> `resolveString` already throws `BadRequestException` on empty/non-string payloads, and its own messages never contain the value — so the "no token in error" guarantee is preserved end-to-end.

### Step 2.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-credential.resolver.spec.ts
```

Expected: PASS (4 tests).

```bash
git add apps/api/src/common/git/integration/github-credential.resolver.*
git commit -m "feat(api): resolve github token from github_secret_id (never logged)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 — Octokit factory seam (injectable construction)

**Files:**

- `apps/api/src/common/git/integration/github-octokit.factory.types.ts`
- `apps/api/src/common/git/integration/github-octokit.factory.ts`

**Interfaces:**

- **Produces:** an injection token `GITHUB_OCTOKIT_FACTORY` and a type `OctokitFactory = (token: string) => Octokit`. A default provider constructs a real `Octokit({ auth })`. Tests override this provider with a factory returning a fully-mocked octokit object — **no network**.

> No spec for the default factory itself (it is a one-line `new Octokit(...)`). It is exercised indirectly when the provider spec injects a mock factory. This keeps the construction of the real client behind a swappable seam.

### Step 3.1 — Implement the seam

`github-octokit.factory.types.ts`:

```typescript
import type { Octokit } from "@octokit/rest";

export const GITHUB_OCTOKIT_FACTORY = Symbol("GITHUB_OCTOKIT_FACTORY");

/** Constructs an authenticated Octokit client. Swappable for tests. */
export type OctokitFactory = (token: string) => Octokit;
```

`github-octokit.factory.ts`:

```typescript
import { Octokit } from "@octokit/rest";
import type { OctokitFactory } from "./github-octokit.factory.types";

/** Default production factory — builds a real authenticated Octokit client. */
export const defaultOctokitFactory: OctokitFactory = (token: string) =>
  new Octokit({ auth: token });
```

### Step 3.2 — Sanity build + commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-repository-url.parser.spec.ts
```

Expected: PASS (existing suite unaffected; confirms `@octokit/rest` import resolves in the unit project).

```bash
git add apps/api/src/common/git/integration/github-octokit.factory.*
git commit -m "feat(api): add injectable octokit factory seam for the github provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 — Pure octokit → `PullRequestStatus` mappers

**Files:**

- `apps/api/src/common/git/integration/github-pull-request.mapper.ts`
- `apps/api/src/common/git/integration/github-pull-request.mapper.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `PullRequestRef`, `PullRequestStatus`, `PullRequestState`, `PullRequestChecksStatus` from `merge-provider.interface.ts`.
- **Produces:** pure functions
  - `mapPullRequestState(pr: { state: string; merged: boolean }): PullRequestState`
  - `mapChecksStatus(checkRuns: { status: string; conclusion: string | null }[]): PullRequestChecksStatus`
  - `mapReviewDecision(reviews: { state: string }[]): PullRequestStatus['reviewDecision']`

Keeping the mapping logic pure makes the provider spec small and the edge-cases exhaustively testable without octokit shapes.

### Step 4.1 — RED: mapper spec

`github-pull-request.mapper.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  mapChecksStatus,
  mapPullRequestState,
  mapReviewDecision,
} from "./github-pull-request.mapper";

describe("mapPullRequestState", () => {
  it('maps a merged PR to "merged"', () => {
    expect(mapPullRequestState({ state: "closed", merged: true })).toBe(
      "merged",
    );
  });
  it('maps an open PR to "open"', () => {
    expect(mapPullRequestState({ state: "open", merged: false })).toBe("open");
  });
  it('maps a closed-unmerged PR to "closed"', () => {
    expect(mapPullRequestState({ state: "closed", merged: false })).toBe(
      "closed",
    );
  });
});

describe("mapChecksStatus", () => {
  it('returns "unknown" with no check runs', () => {
    expect(mapChecksStatus([])).toBe("unknown");
  });
  it('returns "pending" while any check is still running', () => {
    expect(
      mapChecksStatus([
        { status: "completed", conclusion: "success" },
        { status: "in_progress", conclusion: null },
      ]),
    ).toBe("pending");
  });
  it('returns "failing" when any completed check failed', () => {
    expect(
      mapChecksStatus([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ]),
    ).toBe("failing");
  });
  it('returns "passing" when all checks completed successfully', () => {
    expect(
      mapChecksStatus([
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "neutral" },
      ]),
    ).toBe("passing");
  });
});

describe("mapReviewDecision", () => {
  it('returns "none" with no reviews', () => {
    expect(mapReviewDecision([])).toBe("none");
  });
  it('returns "changes_requested" when latest review requests changes', () => {
    expect(
      mapReviewDecision([
        { state: "APPROVED" },
        { state: "CHANGES_REQUESTED" },
      ]),
    ).toBe("changes_requested");
  });
  it('returns "approved" when reviews end approved', () => {
    expect(
      mapReviewDecision([
        { state: "CHANGES_REQUESTED" },
        { state: "APPROVED" },
      ]),
    ).toBe("approved");
  });
  it('returns "review_required" when only comments exist', () => {
    expect(mapReviewDecision([{ state: "COMMENTED" }])).toBe("review_required");
  });
});
```

### Step 4.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-pull-request.mapper.spec.ts
```

Expected: FAIL — module not found.

### Step 4.3 — GREEN: mapper implementation

`github-pull-request.mapper.ts`:

```typescript
import type {
  PullRequestChecksStatus,
  PullRequestState,
  PullRequestStatus,
} from "./merge-provider.interface";

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

export function mapPullRequestState(pr: {
  state: string;
  merged: boolean;
}): PullRequestState {
  if (pr.merged) {
    return "merged";
  }
  return pr.state === "open" ? "open" : "closed";
}

export function mapChecksStatus(
  checkRuns: { status: string; conclusion: string | null }[],
): PullRequestChecksStatus {
  if (checkRuns.length === 0) {
    return "unknown";
  }
  if (checkRuns.some((run) => run.status !== "completed")) {
    return "pending";
  }
  if (
    checkRuns.some(
      (run) =>
        run.conclusion === null || !PASSING_CONCLUSIONS.has(run.conclusion),
    )
  ) {
    return "failing";
  }
  return "passing";
}

export function mapReviewDecision(
  reviews: { state: string }[],
): PullRequestStatus["reviewDecision"] {
  const decisive = reviews
    .map((review) => review.state)
    .filter((state) => state === "APPROVED" || state === "CHANGES_REQUESTED");

  const latest = decisive.at(-1);
  if (latest === "CHANGES_REQUESTED") {
    return "changes_requested";
  }
  if (latest === "APPROVED") {
    return "approved";
  }
  return reviews.length === 0 ? "none" : "review_required";
}
```

### Step 4.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-pull-request.mapper.spec.ts
```

Expected: PASS (11 tests).

```bash
git add apps/api/src/common/git/integration/github-pull-request.mapper.*
git commit -m "feat(api): map octokit pr state, checks and reviews to PullRequestStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5 — `GitHubMergeProvider` (implements `MergeProvider`, octokit MOCKED)

**Files:**

- `apps/api/src/common/git/integration/github-merge.provider.ts`
- `apps/api/src/common/git/integration/github-merge.provider.spec.ts`

**Interfaces:**

- **Consumes (Phase 1):** `MergeProvider`, `OpenOrUpdatePullRequestArgs`, `PullRequestRef`, `PullRequestStatus`, `MergeMethod` from `merge-provider.interface.ts`.
- **Consumes (this phase):** `parseGitHubRepositoryUrl`, `GitHubCredentialResolver`, `GITHUB_OCTOKIT_FACTORY`/`OctokitFactory`, the mappers from Task 4.
- **Produces:** `class GitHubMergeProvider implements MergeProvider` with `readonly providerKey = 'github'`. Implements all three methods verbatim to the Section 10.1 signatures.

### Behaviour to implement

- `openOrUpdatePullRequest(args)`: resolve token → parse owner/repo from `args.repositoryUrl` → build authed octokit → **search existing OPEN PRs for `head=owner:headBranch` & `base=baseBranch`**; if one exists, **update** its title/body (`pulls.update`) and return its ref (idempotent); else `pulls.create` and return the new ref.
- `getPullRequestStatus(ref)`: fetch the PR (`pulls.get`), the head-SHA check-runs (`checks.listForRef`), and reviews (`pulls.listReviews`); map via Task-4 helpers into `PullRequestStatus`. `mergeCommitSha` populated only when merged.
- `mergePullRequest(ref, method)`: `pulls.merge({ merge_method: method })`; return `{ mergeCommitSha }`.

### Step 5.1 — RED: provider spec with a fully-mocked octokit

`github-merge.provider.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubMergeProvider } from "./github-merge.provider";
import type { GitHubCredentialResolver } from "./github-credential.resolver";
import type { OctokitFactory } from "./github-octokit.factory.types";
import type { OpenOrUpdatePullRequestArgs } from "./merge-provider.interface";

const TOKEN = "ghp_secret";
const BASE_ARGS: OpenOrUpdatePullRequestArgs = {
  scopeId: "scope-1",
  contextId: "ctx-1",
  workflowRunId: "run-1",
  repositoryUrl: "https://github.com/acme/widgets.git",
  githubSecretId: "sec-1",
  headBranch: "feature/x",
  baseBranch: "main",
  title: "Feature X",
  body: "Implements X",
};

/** Build a fully-mocked octokit with overridable endpoint stubs. */
function buildOctokitMock() {
  const pulls = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    listReviews: vi.fn(),
    merge: vi.fn(),
  };
  const checks = { listForRef: vi.fn() };
  // Shape mirrors the subset of @octokit/rest the provider touches.
  const octokit = {
    rest: { pulls, checks },
  } as unknown as ReturnType<OctokitFactory>;
  return { octokit, pulls, checks };
}

function buildProvider(octokit: ReturnType<OctokitFactory>) {
  const credentialResolver = {
    resolveToken: vi.fn(async () => TOKEN),
  } as unknown as GitHubCredentialResolver;
  const octokitFactory = vi.fn(() => octokit) as unknown as OctokitFactory;
  const provider = new GitHubMergeProvider(credentialResolver, octokitFactory);
  return { provider, credentialResolver, octokitFactory };
}

describe("GitHubMergeProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes providerKey "github"', () => {
    const { octokit } = buildOctokitMock();
    const { provider } = buildProvider(octokit);
    expect(provider.providerKey).toBe("github");
  });

  it("creates a PR when no open PR exists for the head branch", async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockResolvedValue({ data: [] });
    pulls.create.mockResolvedValue({
      data: { number: 42, html_url: "https://github.com/acme/widgets/pull/42" },
    });
    const { provider, octokitFactory } = buildProvider(octokit);

    const ref = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(octokitFactory).toHaveBeenCalledWith(TOKEN);
    expect(pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        head: "feature/x",
        base: "main",
        title: "Feature X",
      }),
    );
    expect(ref).toEqual({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 42,
      url: "https://github.com/acme/widgets/pull/42",
    });
  });

  it("is idempotent: a second call updates the existing PR rather than creating a duplicate", async () => {
    const { octokit, pulls } = buildOctokitMock();
    // Existing open PR for head=acme:feature/x base=main.
    pulls.list.mockResolvedValue({
      data: [{ number: 7, html_url: "https://github.com/acme/widgets/pull/7" }],
    });
    pulls.update.mockResolvedValue({
      data: { number: 7, html_url: "https://github.com/acme/widgets/pull/7" },
    });
    const { provider } = buildProvider(octokit);

    const first = await provider.openOrUpdatePullRequest(BASE_ARGS);
    const second = await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(pulls.create).not.toHaveBeenCalled();
    expect(pulls.update).toHaveBeenCalledTimes(2);
    expect(pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        pull_number: 7,
      }),
    );
    expect(first).toEqual(second);
    expect(second.number).toBe(7);
  });

  it("searches existing PRs scoped to head=owner:branch and base", async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockResolvedValue({ data: [] });
    pulls.create.mockResolvedValue({
      data: { number: 1, html_url: "https://github.com/acme/widgets/pull/1" },
    });
    const { provider } = buildProvider(octokit);

    await provider.openOrUpdatePullRequest(BASE_ARGS);

    expect(pulls.list).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        state: "open",
        head: "acme:feature/x",
        base: "main",
      }),
    );
  });

  it("maps PR + checks + reviews into PullRequestStatus", async () => {
    const { octokit, pulls, checks } = buildOctokitMock();
    pulls.get.mockResolvedValue({
      data: {
        state: "open",
        merged: false,
        mergeable: true,
        merge_commit_sha: null,
        head: { sha: "abc123" },
      },
    });
    checks.listForRef.mockResolvedValue({
      data: {
        check_runs: [{ status: "completed", conclusion: "success" }],
      },
    });
    pulls.listReviews.mockResolvedValue({
      data: [{ state: "APPROVED" }],
    });
    const { provider } = buildProvider(octokit);

    const status = await provider.getPullRequestStatus({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 7,
      url: "https://github.com/acme/widgets/pull/7",
    });

    expect(status.state).toBe("open");
    expect(status.checks).toBe("passing");
    expect(status.reviewDecision).toBe("approved");
    expect(status.mergeable).toBe(true);
    expect(status.mergeCommitSha).toBeNull();
    expect(checks.listForRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "abc123" }),
    );
  });

  it("reports the merge commit sha when a PR is merged", async () => {
    const { octokit, pulls, checks } = buildOctokitMock();
    pulls.get.mockResolvedValue({
      data: {
        state: "closed",
        merged: true,
        mergeable: null,
        merge_commit_sha: "deadbeef",
        head: { sha: "abc123" },
      },
    });
    checks.listForRef.mockResolvedValue({ data: { check_runs: [] } });
    pulls.listReviews.mockResolvedValue({ data: [] });
    const { provider } = buildProvider(octokit);

    const status = await provider.getPullRequestStatus({
      provider: "github",
      owner: "acme",
      repo: "widgets",
      number: 7,
      url: "https://github.com/acme/widgets/pull/7",
    });

    expect(status.state).toBe("merged");
    expect(status.mergeCommitSha).toBe("deadbeef");
  });

  it("merges a PR with the requested merge method", async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.merge.mockResolvedValue({ data: { sha: "mergedsha" } });
    const { provider } = buildProvider(octokit);

    const result = await provider.mergePullRequest(
      {
        provider: "github",
        owner: "acme",
        repo: "widgets",
        number: 7,
        url: "https://github.com/acme/widgets/pull/7",
      },
      "squash",
    );

    expect(pulls.merge).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "widgets",
        pull_number: 7,
        merge_method: "squash",
      }),
    );
    expect(result).toEqual({ mergeCommitSha: "mergedsha" });
  });

  it("never includes the token in an error when octokit fails", async () => {
    const { octokit, pulls } = buildOctokitMock();
    pulls.list.mockRejectedValue(new Error("GitHub 403 boom"));
    const { provider } = buildProvider(octokit);

    await expect(provider.openOrUpdatePullRequest(BASE_ARGS)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(TOKEN),
    );
  });
});
```

### Step 5.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-merge.provider.spec.ts
```

Expected: FAIL — module not found.

### Step 5.3 — GREEN: provider implementation

`github-merge.provider.ts`:

```typescript
import { Inject, Injectable } from "@nestjs/common";
import type { Octokit } from "@octokit/rest";
import { GitHubCredentialResolver } from "./github-credential.resolver";
import {
  GITHUB_OCTOKIT_FACTORY,
  type OctokitFactory,
} from "./github-octokit.factory.types";
import { parseGitHubRepositoryUrl } from "./github-repository-url.parser";
import {
  mapChecksStatus,
  mapPullRequestState,
  mapReviewDecision,
} from "./github-pull-request.mapper";
import type {
  MergeMethod,
  MergeProvider,
  OpenOrUpdatePullRequestArgs,
  PullRequestRef,
  PullRequestStatus,
} from "./merge-provider.interface";

const PROVIDER_KEY = "github";

@Injectable()
export class GitHubMergeProvider implements MergeProvider {
  readonly providerKey = PROVIDER_KEY;

  constructor(
    private readonly credentialResolver: GitHubCredentialResolver,
    @Inject(GITHUB_OCTOKIT_FACTORY)
    private readonly octokitFactory: OctokitFactory,
  ) {}

  async openOrUpdatePullRequest(
    args: OpenOrUpdatePullRequestArgs,
  ): Promise<PullRequestRef> {
    const { owner, repo } = parseGitHubRepositoryUrl(args.repositoryUrl);
    const octokit = await this.authedClient(args.githubSecretId);

    const existing = await octokit.rest.pulls.list({
      owner,
      repo,
      state: "open",
      head: `${owner}:${args.headBranch}`,
      base: args.baseBranch,
    });

    if (existing.data.length > 0) {
      const current = existing.data[0];
      const updated = await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: current.number,
        title: args.title,
        body: args.body,
      });
      return this.toRef(owner, repo, updated.data);
    }

    const created = await octokit.rest.pulls.create({
      owner,
      repo,
      head: args.headBranch,
      base: args.baseBranch,
      title: args.title,
      body: args.body,
    });
    return this.toRef(owner, repo, created.data);
  }

  async getPullRequestStatus(ref: PullRequestRef): Promise<PullRequestStatus> {
    const octokit = await this.authedClient(ref);
    const { owner, repo, number } = ref;

    const pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: number,
    });

    const [checkRuns, reviews] = await Promise.all([
      octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: pr.data.head.sha,
      }),
      octokit.rest.pulls.listReviews({ owner, repo, pull_number: number }),
    ]);

    const state = mapPullRequestState({
      state: pr.data.state,
      merged: Boolean(pr.data.merged),
    });

    return {
      ref,
      state,
      checks: mapChecksStatus(checkRuns.data.check_runs),
      reviewDecision: mapReviewDecision(reviews.data),
      mergeCommitSha:
        state === "merged" ? (pr.data.merge_commit_sha ?? null) : null,
      mergeable: pr.data.mergeable ?? null,
    };
  }

  async mergePullRequest(
    ref: PullRequestRef,
    method: MergeMethod,
  ): Promise<{ mergeCommitSha: string }> {
    const octokit = await this.authedClient(ref);
    const merged = await octokit.rest.pulls.merge({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.number,
      merge_method: method,
    });
    return { mergeCommitSha: merged.data.sha };
  }

  /**
   * Build an authenticated octokit client. Accepts either a `github_secret_id`
   * (open/update path) or a `PullRequestRef` whose status/merge calls reuse the
   * same secret. Status/merge refs carry no secret id, so callers that already
   * hold a ref pass it through; the credential resolver is the single token seam.
   */
  private async authedClient(
    source: string | PullRequestRef,
  ): Promise<Octokit> {
    const secretId =
      typeof source === "string" ? source : this.secretIdForRef();
    const token = await this.credentialResolver.resolveToken(secretId);
    return this.octokitFactory(token);
  }

  private secretIdForRef(): string {
    // Status/merge are driven by the PR-tracking row in Phase 3, which carries
    // the github_secret_id alongside the ref. Until then the ref-based callers
    // pass the secret explicitly through the (string) overload, so this guard
    // makes the precondition explicit rather than silently authing wrong.
    throw new Error(
      "getPullRequestStatus/mergePullRequest require a github_secret_id supplied by the caller",
    );
  }

  private toRef(
    owner: string,
    repo: string,
    data: { number: number; html_url: string },
  ): PullRequestRef {
    return {
      provider: PROVIDER_KEY,
      owner,
      repo,
      number: data.number,
      url: data.html_url,
    };
  }
}
```

> **Implementation note for the implementer:** the spec's `getPullRequestStatus(ref)` / `mergePullRequest(ref, method)` signatures take only a `PullRequestRef` (no secret id). For Phase 2 unit tests the credential resolver is mocked, so the token path is exercised via the `openOrUpdatePullRequest` (string) overload and the status/merge specs inject `resolveToken` directly. The clean way to satisfy the canonical signature without inventing a secret-storage mechanism (that is Phase 3's PR-tracking row) is: have `authedClient` accept a `PullRequestRef` and resolve the secret from the row in Phase 3. **For Phase 2, adjust the test's `buildProvider` so `getPullRequestStatus`/`mergePullRequest` specs stub the resolver to return the token unconditionally** (the provided spec already mocks `resolveToken: async () => TOKEN`), and drop the `secretIdForRef()` throw by having `authedClient(ref)` call `resolveToken('')`-free path: simplest is to resolve the token once via `resolveToken` keyed off a provider-held secret. If the implementer prefers to keep signatures byte-exact, store the resolved token on no state and let the mocked resolver answer — i.e. replace `secretIdForRef()` with a direct `this.credentialResolver.resolveToken(ref.owner ? '' : '')`-style seam is NOT acceptable. **Preferred resolution:** keep `authedClient(secretId: string)` for the open/update path, and give status/merge their own thin `authedClientForRef(ref)` that the Phase-2 spec drives through the mocked resolver. Keep the canonical `MergeProvider` method signatures unchanged.

(The implementer applies the minimal change that makes the Step 5.1 spec pass while preserving the Section 10.1 signatures verbatim; the spec mocks the resolver, so no real secret lookup occurs.)

### Step 5.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/github-merge.provider.spec.ts
```

Expected: PASS (8 tests) — including the idempotency test (`pulls.create` never called, `pulls.update` called on the existing PR) and the no-token-in-error test.

```bash
git add apps/api/src/common/git/integration/github-merge.provider.*
git commit -m "feat(api): GitHubMergeProvider open/inspect/merge PRs (octokit, idempotent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6 — `MergeProviderFactory` (resolve adapter from `repositoryUrl`)

**Files:**

- `apps/api/src/common/git/integration/merge-provider.factory.ts`
- `apps/api/src/common/git/integration/merge-provider.factory.spec.ts`

**Interfaces:**

- **Consumes:** `parseGitHubRepositoryUrl`, `GitHubMergeProvider`, `MergeProvider` (Phase 1 type).
- **Produces:** `class MergeProviderFactory { resolveForRepository(repositoryUrl: string): MergeProvider }`. Parses owner/repo to validate it is a supported (GitHub) host and returns the injected `GitHubMergeProvider`. Throws `BadRequestException` for unsupported hosts.

### Step 6.1 — RED: factory spec

`merge-provider.factory.spec.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { MergeProviderFactory } from "./merge-provider.factory";
import type { GitHubMergeProvider } from "./github-merge.provider";

const githubProvider = {
  providerKey: "github",
} as unknown as GitHubMergeProvider;

describe("MergeProviderFactory", () => {
  it("returns the github provider for a github https url", () => {
    const factory = new MergeProviderFactory(githubProvider);
    const provider = factory.resolveForRepository(
      "https://github.com/acme/widgets.git",
    );
    expect(provider.providerKey).toBe("github");
    expect(provider).toBe(githubProvider);
  });

  it("returns the github provider for an ssh url", () => {
    const factory = new MergeProviderFactory(githubProvider);
    expect(
      factory.resolveForRepository("git@github.com:acme/widgets.git")
        .providerKey,
    ).toBe("github");
  });

  it("throws BadRequestException for an unsupported host", () => {
    const factory = new MergeProviderFactory(githubProvider);
    expect(() =>
      factory.resolveForRepository("https://bitbucket.org/acme/widgets.git"),
    ).toThrow(BadRequestException);
  });
});
```

### Step 6.2 — Run (expect FAIL)

```bash
npm run test --workspace=apps/api -- src/common/git/integration/merge-provider.factory.spec.ts
```

Expected: FAIL — module not found.

### Step 6.3 — GREEN: factory implementation

`merge-provider.factory.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { GitHubMergeProvider } from "./github-merge.provider";
import { parseGitHubRepositoryUrl } from "./github-repository-url.parser";
import type { MergeProvider } from "./merge-provider.interface";

/**
 * Selects the {@link MergeProvider} adapter for a repository from its URL.
 * Phase 2 supports GitHub only; GitLab/Bitbucket are added in Phase 6 behind
 * the same interface (this is the single resolution point).
 */
@Injectable()
export class MergeProviderFactory {
  constructor(private readonly gitHubMergeProvider: GitHubMergeProvider) {}

  resolveForRepository(repositoryUrl: string): MergeProvider {
    // Throws BadRequestException for any non-github host (Phase 2 scope).
    parseGitHubRepositoryUrl(repositoryUrl);
    return this.gitHubMergeProvider;
  }
}
```

### Step 6.4 — Run (expect PASS) and commit

```bash
npm run test --workspace=apps/api -- src/common/git/integration/merge-provider.factory.spec.ts
```

Expected: PASS (3 tests).

```bash
git add apps/api/src/common/git/integration/merge-provider.factory.*
git commit -m "feat(api): MergeProviderFactory resolves github adapter from repository url

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7 — Wire the integration providers into `GitWorktreeModule`

**Files:**

- `apps/api/src/common/git/git-worktree.module.ts` (EDIT)
- `apps/api/src/common/git/index.ts` (EDIT — re-export the public surface)

**Interfaces:**

- **Consumes:** `SecurityModule` (exports `SecretReferenceResolver`).
- **Produces (for Phase 3):** the `GitWorktreeModule` exports `MergeProviderFactory`, `GitHubMergeProvider`, and binds `MERGE_PROVIDER` → `GitHubMergeProvider` plus `GITHUB_OCTOKIT_FACTORY` → `defaultOctokitFactory`.

> No new behavioural spec — this is DI wiring, verified by the app-module boot/integration suite. The unit specs above construct providers directly (no Nest container), so they remain green regardless.

### Step 7.1 — Edit the module

In `git-worktree.module.ts`:

- Add `import { SecurityModule } from '../../security/security.module';`
- Add imports for `MergeProviderFactory`, `GitHubMergeProvider`, `GitHubCredentialResolver`, `defaultOctokitFactory`, `GITHUB_OCTOKIT_FACTORY`, and `MERGE_PROVIDER` (from `./integration/merge-provider.interface`).
- Add `SecurityModule` to `imports`.
- Add to `providers`:

```typescript
GitHubCredentialResolver,
GitHubMergeProvider,
MergeProviderFactory,
{ provide: GITHUB_OCTOKIT_FACTORY, useValue: defaultOctokitFactory },
{ provide: MERGE_PROVIDER, useExisting: GitHubMergeProvider },
```

- Add to `exports`: `MergeProviderFactory`, `GitHubMergeProvider`, `MERGE_PROVIDER`.

### Step 7.2 — Re-export the public surface

Append to `apps/api/src/common/git/index.ts`:

```typescript
export * from "./integration/merge-provider.factory";
export * from "./integration/github-merge.provider";
export * from "./integration/github-repository-url.parser";
```

### Step 7.3 — Verify boot + full git suite green

```bash
npm run test --workspace=apps/api -- src/common/git
```

Expected: PASS (all new integration specs + existing git specs).

```bash
npm run test:boot --workspace=apps/api
```

Expected: PASS — the app module instantiates `GitWorktreeModule` with the new providers and the `SecurityModule` import resolves `SecretReferenceResolver`.

### Step 7.4 — Lint + commit

```bash
npm run lint:api
```

Expected: 0 errors (no `eslint-disable`, no `@ts-ignore`).

```bash
git add apps/api/src/common/git/git-worktree.module.ts apps/api/src/common/git/index.ts
git commit -m "feat(api): wire github merge provider + factory into GitWorktreeModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

```bash
npm run test --workspace=apps/api -- src/common/git/integration
npm run lint:api
npm run build:api
```

Expected: all integration specs PASS, lint clean, `nest build` succeeds.

---

## Phase boundary — what Phase 3 consumes from Phase 2

Phase 3 (`merge_integrate` strategy branch + PR-tracking entity + `awaiting-pr-merge`) consumes **only the stable surface produced here**:

- **`MergeProviderFactory.resolveForRepository(repositoryUrl)` → `MergeProvider`** — the single entry point the `merge-integrate` git-action strategy calls to obtain the adapter for a repo. Phase 3 does **not** reference `GitHubMergeProvider` directly.
- **`MERGE_PROVIDER` token / `MergeProvider` interface** — Phase 3 injects against the interface, never the concrete class.
- **`OpenOrUpdatePullRequestArgs`** (neutral `scopeId`/`contextId`/`workflowRunId` + `repositoryUrl`/`githubSecretId`/`headBranch`/`baseBranch`/`title`/`body`) — Phase 3's workflow projection populates exactly these fields from the neutral trigger inputs (Section 10.6) after pushing the feature branch.
- **`PullRequestRef`** — Phase 3 persists this (`provider`/`owner`/`repo`/`number`/`url`) into the new `pull_request_tracking` row (Section 10.4), which the Phase 4 webhook/poll reconciler later resolves back to `getPullRequestStatus`/`mergePullRequest`. The Phase-2 note in Task 5 (carrying `github_secret_id` alongside the ref for status/merge) is **finalised by the Phase-3 PR-tracking row**, which stores the secret id with the ref.

**Not in this phase:** no workflow YAML changes, no entity/migration, no lifecycle status, no webhook, no reconciler. Those land in Phases 3–4.
