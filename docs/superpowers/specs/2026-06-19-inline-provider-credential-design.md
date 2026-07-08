# Inline Provider Credential — Design

**Date:** 2026-06-19
**Status:** Approved (design); implementation pending
**Scope:** `apps/web`, `apps/api`, `packages/core`

## Problem

Creating an LLM provider with API-key auth is a multi-step chore:

1. Go to the **Secrets** page and hand-author a JSON blob, guessing the exact key
   name the runtime resolver expects (e.g. `{"OPENAI_API_KEY": "sk-..."}`).
2. Return to the **Providers** page and select that secret by name from a dropdown.

The "what JSON field name do I use?" guess is the sharpest pain: if the name does
not match the resolver's expectations, the provider fails with unhelpful errors.
Custom HTTP headers (already supported end-to-end at runtime) have no UI at all —
they must be typed as raw JSON into the advanced `runtime_env` textarea.

## Goal

Make api_key provider creation a single-page action:

- Enter an **API Key** inline; the secret is created automatically with the
  correct field name and the resolver wired deterministically.
- Optionally add **custom headers** and **additional secret values** inline.
- Optionally **reuse an existing secret** instead of creating one.
- Editing a provider can rotate the key or adjust headers without ever exposing
  the stored secret value.

## Decisions (captured during brainstorming)

1. **Field naming:** provider-convention name for known presets
   (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`), canonical fallback (`API_KEY`) for
   `custom`. The API always pins `runtime_env.api_key_field` so the resolver's
   first-choice lookup is exact regardless of provider.
2. **Custom headers:** true end-to-end, reusing the existing
   `runtime_env.providerConfig.headers` plumbing (already flows through pi-ai onto
   every request). Sensitive header values use `{{KEY}}` placeholders resolved
   server-side from the secret at runtime, so tokens stay encrypted and unlogged.
3. **Additional key/values:** stored in the same encrypted secret JSON alongside
   the API key; they are the source for header `{{KEY}}` placeholders and for
   things like `ORG_ID`.
4. **Edit/rotate:** masked API-key field; blank = keep the existing secret
   untouched (same `secret_id`). A typed value updates the existing secret in
   place via server-side merge.
5. **OAuth:** out of scope. The OAuth client-secret path keeps its current
   select-a-secret UI unchanged.
6. **Use existing secret:** retained as an explicit alternative mode.

## Approaches considered (orchestration seam)

**A — Server-side inline credential (chosen).** Extend the provider
create/update contract with an optional `credential` object. When present, the
API creates/updates the secret with the correct field name, sets `secret_id`, and
writes `runtime_env.api_key_field` + `providerConfig.headers` atomically in one
call.

- Atomic (no orphaned secrets), field-naming logic co-located with the resolver,
  thin web layer, partial edits via server-side merge, single contract surface.
- Provider service gains a DI dependency on the secret service (acceptable).

**B — Client-side orchestration hook.** Web calls `createSecret` then
`createProvider`. Rejected: non-atomic, duplicates field-name logic in the web
layer (DRY violation), and the client cannot read the secret back to merge, so
partial edits are impossible.

**C — Dedicated `POST /providers/with-credential` endpoint.** Rejected:
atomic but proliferates create paths to maintain.

## Design

### 1. Contract (`packages/core`)

Add an optional `credential` to `CreateProviderSchema` / `UpdateProviderSchema`:

```ts
credential?: {
  api_key?: string;                          // omitted/blank on edit = keep existing
  extra?: Record<string, string>;            // extra secret values (e.g. ORG_ID)
  headers?: Array<{ name: string; value: string }>; // value may contain {{KEY}} placeholders
}
```

- `secret_id` remains for the "use existing secret" path.
- `credential` and a user-supplied `secret_id` are mutually exclusive
  (validated; supplying both is a 400).
- `credential` applies to `auth_type === "api_key"` only.

### 2. Field-name derivation (pure helper, API side)

`deriveApiKeyField(provider_id): string`

- Known preset → `<PROVIDER>_API_KEY` (uppercased, non-alphanumerics → `_`),
  matching the resolver's existing provider-scoped convention.
- `custom` / unknown → `API_KEY`.

The API always writes the derived value to `runtime_env.api_key_field` whenever a
`credential` is supplied, so `resolveApiKey` step 1 (configured field) hits
exactly and no guessing/wildcard search is needed.

### 3. Provider service orchestration (api_key auth only)

On create/update when `credential` is present:

- Build the secret JSON: `{ [apiKeyField]: api_key, ...extra }`.
- **Create:** create the secret via the secret service, auto-named (e.g.
  `"<provider name> credentials"`, de-duplicated), tagged
  `metadata: { managed_by_provider: true, fields: string[] }` where `fields`
  lists the non-sensitive key NAMES present (never values). Capture `secret_id`
  onto the provider.
- **Update:** decrypt the existing managed secret, merge changed keys, re-encrypt
  via the existing `PATCH /ai-config/secrets/:id`. Blank `api_key` keeps the
  existing key; supplied `extra`/header-referenced keys are merged in.
- Write `runtime_env.api_key_field` and merge `credential.headers` into
  `runtime_env.providerConfig.headers`, preserving any OAuth-synthesized
  `providerConfig` (no clobber).

Dependencies are injected via interface tokens per NestJS conventions; the
provider CRUD/admin service consumes the secret service abstraction.

### 4. Header placeholder resolution (runtime)

In `resolveProviderRegistrationConfig`
(`apps/api/src/ai-config/ai-configuration-runner-provider.helpers.ts`), after
extracting `headers` via `asStringRecord`, interpolate `{{KEY}}` tokens from the
decrypted `secretMap` (falling back to `providerEnv`). Unmatched placeholders are
left intact (or dropped) — decided in the plan; default: leave intact and log a
warning without the value. This keeps sensitive header values encrypted at rest
and absent from logs (OWASP / "never log sensitive data").

### 5. Web UI (`apps/web/src/pages/providers/`)

New **Credential** section, rendered only for `auth_type === "api_key"`, with a
segmented toggle:

- **Create new (default):**
  - Masked **API Key** field (password input). On edit, placeholder shows
    `•••• set`; leaving it blank keeps the existing value.
  - **Custom headers** repeater: `name` + `value` rows; value supports
    `{{KEY}}` references.
  - **Additional values** repeater: `name` + `value` rows (populate the secret
    JSON).
- **Use existing secret:** the current dropdown selector.

On edit, the `metadata.fields` list and the readable `runtime_env.providerConfig.headers`
let the form render existing field/header NAMES with blank-masked values
(blank = keep). The submit path stays a single `createProvider`/`updateProvider`
call — the new logic is a thin payload builder (`buildProviderPayload`
extension), not client-side secret juggling. The raw `runtime_env` textarea is
retained for power users.

Per the web quality gate, the form component stays presentation-focused; payload
assembly and mutation orchestration live in the existing hooks/`buildProviderPayload`
helper.

### 6. Out of scope

- OAuth client-secret inlining (keeps current select-a-secret UI).
- Any new request-time header plumbing — it already exists end-to-end via
  `providerConfig.headers` → pi-ai.

## Data flow (create, inline)

```
Provider form (api_key, "Create new")
  → buildProviderPayload → POST /ai-config/providers { ...provider, credential }
    → provider service:
        apiKeyField = deriveApiKeyField(provider_id)
        secret = createSecret({ name, value: { [apiKeyField]: api_key, ...extra },
                                metadata: { managed_by_provider, fields } })
        provider.secret_id = secret.id
        provider.runtime_env.api_key_field = apiKeyField
        provider.runtime_env.providerConfig.headers = fromPairs(headers)
        persist provider
  → runtime: resolveProviderRegistrationConfig interpolates {{KEY}} headers
             from decrypted secret; resolveApiKey hits api_key_field exactly
```

## Error handling

- Both `credential` and `secret_id` supplied → 400 (mutually exclusive).
- `credential` on `auth_type !== "api_key"` → 400.
- Empty `credential` on create (no api_key, no existing secret) → 400
  (a provider needs a credential source).
- Secret create/update failure aborts the provider write (atomic; no partial
  state) — because the work happens inside the single provider service call.
- Sensitive values (api_key, extra, resolved header tokens) are never logged or
  returned in responses; the secret value is never read back to the client.

## Testing (TDD)

**API (Vitest):**

- `deriveApiKeyField` — presets, custom, normalization.
- Provider service create — builds correct secret JSON, tags metadata, pins
  `api_key_field`, writes headers (mocked secret service).
- Provider service update — blank key keeps secret; typed key/extra merge into
  decrypted secret; headers merge preserves OAuth `providerConfig`.
- Validation — mutually-exclusive `credential`/`secret_id`, wrong auth_type,
  empty-credential create.
- Header placeholder interpolation — `{{KEY}}` resolved from secret; unmatched
  handling.
- Contract test — resolver finds the API key via the pinned `api_key_field`.

**Web (Vitest):**

- `buildProviderPayload` — emits `credential` in create-new mode, `secret_id` in
  use-existing mode, omits blank api_key on edit.
- Form behavior — section appears only for api_key; toggle switches modes; edit
  shows masked field + existing field/header names.

## Affected files (anticipated)

- `packages/core/src/schemas/ai-config/providers.schema.ts` — `credential` schema.
- `packages/core/src/interfaces/...` — `credential` type, exported.
- `apps/api/src/ai-config/services/crud/provider-crud.service.ts` (and/or
  `ai-config-admin.service.ts`) — orchestration.
- `apps/api/src/ai-config/.../deriveApiKeyField` helper (+ test).
- `apps/api/src/ai-config/ai-configuration-runner-provider.helpers.ts` —
  header placeholder interpolation.
- `apps/web/src/pages/providers/ProviderFormFields.tsx` — Credential section.
- `apps/web/src/pages/providers/ProviderSubcomponents.tsx` —
  `buildProviderPayload`.
- `apps/web/src/pages/providers/ProviderForm.tsx` — wiring/state.
- Docs: provider setup guide under `docs/guide`.
