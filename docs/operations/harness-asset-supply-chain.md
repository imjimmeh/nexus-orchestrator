# Harness Asset Supply-Chain Runbook

> Operator reference for harness asset provenance, checksum verification, trust model, secret handling, and runtime isolation guarantees.

---

## Overview

Harness assets (PI `ts-module` extensions and Claude Code plugins) are code units that run inside agent execution containers. EPIC-211 introduces an immutable `harness_assets` table and a multi-stage verification pipeline that spans API ingestion → DB storage → hydration → engine-side staging. This runbook describes each stage, its security controls, and the operational requirements operators must maintain.

---

## Provenance Pinning

### Authored assets

Assets authored inline (profile editor, workflow step `harness_contributions`) are serialized, bundled, and checksummed at creation time:

1. The bundle (a JSON-serialized object containing all asset fields) is written to `harness_assets.bundle`.
2. `computeAssetChecksum(bundle)` — SHA-256 over the bundle string (UTF-8 encoded), prefixed `sha256:` — is written to `harness_assets.checksum`.
3. The row is immutable after creation. "Updating" an asset creates a **new row** with a new `id` and new checksum; the old row is never modified.

### Imported assets (git source)

Imported assets pin to a resolved git commit SHA after fetch. The flow is:

1. **Option-injection guard** — the `repo`, `ref`, and `subdir` parameters are checked to reject values beginning with `-` (dashes), preventing shell option-injection into the underlying `git` invocation.
2. **Fetch** — the API shells out to `git clone` using the caller-supplied ref (which may be a branch, tag, or SHA).
3. **Vetting** — size cap and caller-supplied source denylist (see [Size caps and denylist](#size-caps-and-denylist)).
4. **Post-fetch SHA pinning** — after the clone succeeds, `git rev-parse HEAD` resolves the fetched ref to the actual full commit SHA. This resolved SHA is persisted as the asset's source ref, producing an immutable snapshot regardless of what ref was supplied.
5. **Bundle and checksum** — the same canonical bundle JSON as for authored assets is built and checksummed.
6. **Persist** — the bundle, checksum, and resolved (pinned) source are written to `harness_assets` immutably.

The preview response includes the `pinnedSource` (with the resolved SHA substituted for the original ref) so the operator can verify what will be persisted before confirming.

**Operational requirement: `git` must be on `PATH` in the `nexus-api` image.** Without `git`, the import preview endpoint returns `503 Service Unavailable` with `{ "error": "git_unavailable" }`. Authored-asset endpoints and all engine-side runtime paths are unaffected (they never invoke `git`). Add `git` to the image:

```dockerfile
RUN apt-get install -y --no-install-recommends git
```

---

## Canonical Checksum Function

The **single source of truth** for checksum computation is `computeAssetChecksum` in `@nexus/harness-runtime`:

```typescript
// packages/harness-runtime/src/asset-checksum.ts
import { createHash } from "node:crypto";

export function computeAssetChecksum(bundle: string): string {
  const hex = createHash("sha256").update(bundle, "utf8").digest("hex");
  return `sha256:${hex}`;
}
```

**Algorithm:** SHA-256 over the raw `bundle` string (UTF-8), hex-encoded, prefixed `sha256:`.

**Why a single function?** Both the API ingestion path and both engine-side staging paths (PI and Claude Code) import from `@nexus/harness-runtime`. There is no fork. This guarantees that the stored checksum always matches a correct recompute regardless of where the function runs.

Do not implement a parallel checksum function anywhere in the codebase. If the algorithm must change (e.g., to SHA-512), update `computeAssetChecksum` in one place and all callers inherit the change automatically. New algorithms should use a different prefix (e.g., `sha512:`) so stored checksums remain identifiable.

---

## Verification Pipeline

Harness assets pass through **two independent verification gates** before any code runs.

### Gate 1 — Hydration (API-side, resolve time)

`hydrateAssetReferences` in `apps/api/src/harness/harness-asset-hydration.ts`:

1. Loads the `harness_assets` rows for all referenced IDs.
2. For each row: `computeAssetChecksum(entity.bundle)` and compares to `entity.checksum`.
3. **On mismatch:** drops the asset with `reason: "checksum_mismatch"`, emits `harness_contribution_dropped` to the event ledger, and **never returns the tampered asset to the engine**.
4. **On match:** passes the asset (including `bundle`) to the resolved `HarnessContributions` object delivered to the engine via the `configure` handshake.

Gate 1 catches: storage corruption, tampered DB rows, or any mutation between persist and resolve.

### Gate 2 — Staging (engine-side, session creation)

Immediately before writing any file to disk:

- **PI extensions** (`stageExtensionAssetsWithDiagnostics` in `packages/harness-engine-pi/src/contribution-extension-staging.ts`):
  - Recomputes `computeAssetChecksum(ext.bundle)` and compares to `ext.checksum`.
  - On mismatch or missing `bundle`: drops the extension with `reason: "checksum_mismatch"`; sibling extensions continue staging. Never throws.

- **CC plugins** (`stagePlugins` in `packages/harness-engine-claude-code/src/plugin-staging.ts`):
  - Same guard: recomputes `computeAssetChecksum(plugin.bundle)` before any `writeFile` call.
  - On mismatch or missing `bundle`: drops the plugin with `reason: "checksum_mismatch"`; sibling plugins continue. Never throws.

Gate 2 catches: any tampering that might survive Gate 1 (memory corruption, man-in-the-middle on the WebSocket configure handshake, or bugs in the transmission path). This is the closest possible verification to where the code actually runs.

### Behavior on mismatch (both gates)

| What happens              | Detail                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| Asset is dropped          | No code is staged; no file is written                                   |
| Diagnostic emitted        | `harness_contribution_dropped` event with `reason: "checksum_mismatch"` |
| Sibling assets unaffected | Each asset is independently verified; one bad asset never blocks others |
| Session continues         | A session with zero staged assets behaves identically to pre-EPIC-211   |
| Never throws              | The staging functions are non-throwing by contract                      |

---

## Trust Tiers

### v1 trust model

In v1, **both authored and imported assets run at author trust** inside the existing execution container:

| Property              | Authored                     | Imported (v1)        |
| --------------------- | ---------------------------- | -------------------- |
| Origin                | Inline in profile/step/skill | External git repo    |
| Container             | Standard nexus-heavy         | Standard nexus-heavy |
| Isolation             | Author trust                 | Author trust         |
| Seccomp / namespacing | Container-level only         | Container-level only |

The distinction between authored and imported in v1 is **provenance tracking** (commit SHA, computed checksum), not execution isolation. Treat external imports as carrying third-party code at the same trust level as any authored profile hook or extension.

**Hardening follow-up (deferred):** Stricter per-asset sandbox (seccomp profile, reduced Linux capabilities, optional read-only mount for `moduleSource`) is documented in `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` Phase 5. Operators who require stricter isolation before v1 ships should deploy imported assets only after a full code review.

---

## No Live Network at Run Time

**Engines never fetch code from external sources during a session.** All asset content is:

1. Fetched and vetted at **import time** (API, synchronous git clone).
2. Stored immutably in the DB (`harness_assets.bundle`).
3. Delivered to the engine via the WebSocket `configure` handshake at session start.
4. Written to disk from `bundle` content only.

The execution container has no special network access to source hosts. A git server going down, changing the ref, or returning different bytes after import has zero effect on running sessions — the bytes are already in the DB.

---

## Secret Handling

### What counts as a secret

- API keys, OAuth tokens, bearer headers in MCP server config
- Any value in `env` fields that contains credentials

### Rules

| Rule                         | Where enforced                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| Secrets as secret-store refs | `env`/`headers` in hook or MCP config must reference `secret_store(id)`, never inline values  |
| Resolved server-side only    | `HarnessCredentialResolverService` resolves secret refs before delivery via `configure`       |
| WebSocket delivery only      | Resolved secrets travel over the WebSocket `configure` handshake, never as container env vars |
| Never logged                 | Staging code (`stagePlugins`, `stageExtensionAssets`) never logs file contents                |
| `.mcp.json` cleanup          | Plugin `.mcp.json` (which carries resolved MCP env/headers) is deleted on session `dispose()` |

Secrets that appear in `harness_assets.bundle` (e.g., a test asset authored with a literal key) are stored encrypted in the DB via standard secret-store AES-256-GCM. However, the canonical rule is: **do not inline secrets in asset bundles** — always reference them through the secret store.

---

## Size Caps and Denylist

### Size cap

The default size cap is **5 MiB** total across all fetched files (`DEFAULT_SIZE_CAP_BYTES = 5 * 1024 * 1024` in `apps/api/src/harness/import/asset-vetting.ts`). Assets whose combined byte size exceeds this are refused at the preview stage with `{ error: "size_cap_exceeded" }`. This prevents runaway memory usage in the execution container.

Operators can override the cap per-import by passing `sizeCap` in the preview request body.

### Denylist

The import vetter (`asset-vetting.ts: checkDenylist`) refuses sources whose **identifier** (repo URL for git sources, package name for registry sources) matches any entry in the caller-supplied `denylist` array. The comparison is case-insensitive.

The denylist operates on the **source identifier only** — it is not a file-path or file-content scanner.

Operators should review imported asset contents before confirming. See "Planned hardening" below for controls that are not yet enforced.

### v1 CC plugin import boundary

The following CC plugin components are **rejected at import time** so that an unsupported plugin never silently imports green but runs inert:

- `hooks/hooks.json` — **supported**: parsed and mapped to neutral `HarnessHookAsset[]`; Phase-3 staging re-emits them faithfully.
- `commands/` — **rejected** (v1 has no command authoring model; import each command separately if needed).
- `agents/` — **rejected** (v1 has no sub-agent authoring model).
- `skills/` — **rejected** (v1 has no skill-YAML authoring model).
- `.mcp.json` (inline MCP server definitions) — **rejected**; v1 uses `mcpServerRefs` into the API MCP runtime instead.

An import that carries any of the rejected components returns `422 Unprocessable Entity` with a message identifying the offending component.

---

## Planned hardening (NOT yet enforced)

The following controls are documented as hardening goals but are **not currently implemented** in the codebase. Operators must not rely on them.

| Control                                                 | Status           | Notes                                                                                                                                          |
| ------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutable-ref refusal at input                            | **Not enforced** | The fetcher accepts any ref and pins post-fetch to the resolved SHA. A branch name supplied as `ref` is accepted; the SHA is what gets stored. |
| File-path denylist (e.g. `.env`, `*.pem`, `Dockerfile`) | **Not enforced** | No per-file path or content scanning occurs today. Operators must audit fetched content manually before confirming.                            |
| Path-traversal rejection (e.g. `../`)                   | **Not enforced** | The option-injection guard only blocks leading-dash identifiers, not path-traversal sequences.                                                 |
| Secrets-file content scanning                           | **Not enforced** | The vetter does not scan file contents for credentials or private keys.                                                                        |

These controls are planned for a hardening phase (see `docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md` Phase 5). Until implemented, treat imported assets with the same level of trust as authored code and review them manually before production deployment.

---

## Operational Checklist

### Before enabling git-source imports

- [ ] Verify `git` is on `PATH` in the deployed `nexus-api` image: `docker exec <api-container> git --version`
- [ ] Confirm the API container can reach your git hosts (firewall, proxy, etc.)
- [ ] Prefer pinning import refs to full commit SHAs for maximum reproducibility — mutable refs (branch names, tags) are accepted but the resolved SHA is what gets stored; supplying a SHA upfront avoids ambiguity
- [ ] Manually review the plugin's file tree before confirming — file-path and content denylist controls are planned but not yet enforced (see "Planned hardening" above)

### After a suspicious `checksum_mismatch` drop

1. Query the event ledger for `harness_contribution_dropped` events with `reason: "checksum_mismatch"` and the affected asset `id`.
2. Retrieve the `harness_assets` row and recompute: `computeAssetChecksum(row.bundle)`. If it does not match `row.checksum`, the row was modified after creation — escalate immediately.
3. If the row is clean, the mismatch was in transit (configure handshake corruption or a bug in the transmission path). File a diagnostic report including the session id, step id, and asset id.
4. Never re-enable a tampered asset. Create a new asset row from a verified source and update all profile references.

### Routine integrity audit

There is no automated audit scheduled by default. To run a manual spot-check:

```sql
-- Find any harness_assets row where the stored checksum does not match
-- a re-computation (requires a DB function or external script):
SELECT id, name, kind, checksum
FROM harness_assets
WHERE checksum != 'sha256:' || encode(sha256(convert_to(bundle, 'UTF8')), 'hex');
```

This query uses PostgreSQL's built-in SHA-256; the result should be the empty set. Any rows returned indicate storage corruption or tampering.

---

## Cross-links

- [`docs/guide/41-harness-runtime.md#importing-harness-assets-from-external-sources`](../guide/41-harness-runtime.md#importing-harness-assets-from-external-sources) — guide section covering the import flow
- [`docs/guide/19-security.md`](../guide/19-security.md) — secret store, AES-256-GCM, delivery guarantees
- [`docs/superpowers/specs/2026-06-23-harness-plugins-extensions-design.md`](../superpowers/specs/2026-06-23-harness-plugins-extensions-design.md) — EPIC-211 full design, phase plans, hardening roadmap
- `apps/api/src/harness/assets/` — asset service, repository, bundle builders
- `apps/api/src/harness/import/` — import flow: source fetcher, vetting, preview, confirm
- `packages/harness-runtime/src/asset-checksum.ts` — canonical `computeAssetChecksum`
- `packages/harness-engine-pi/src/contribution-extension-staging.ts` — engine-side Gate 2 for PI
- `packages/harness-engine-claude-code/src/plugin-staging.ts` — engine-side Gate 2 for CC
