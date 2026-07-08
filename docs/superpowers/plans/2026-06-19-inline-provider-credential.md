# Inline Provider Credential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users create/edit an api_key LLM provider on one page — type an API key (plus optional custom headers and extra secret values), and the backend auto-creates/updates the encrypted secret with the correct resolver field name, while still allowing reuse of an existing secret.

**Architecture:** The provider create/update contract gains an optional `credential` object. A new server-side `ProviderCredentialService` (injected with the existing `SecretCrudService`) turns that credential into a managed secret, pins `runtime_env.api_key_field`, and merges custom headers into `runtime_env.providerConfig.headers` — atomically, inside the existing `AiConfigAdminService` create/update path. Sensitive header values use `{{KEY}}` placeholders resolved from the decrypted secret at runtime. The web form gains a Credential section that emits `credential` (create-new mode) or `secret_id` (use-existing mode).

**Tech Stack:** TypeScript, Zod (`@nexus/core`), NestJS + Vitest (`apps/api`), React + react-hook-form + Vitest/Testing Library (`apps/web`), TypeORM, `@earendil-works/pi-ai`.

## Global Constraints

- Build `packages/core` before the apps depend on it: `npm run build --workspace=packages/core`.
- Shared contracts live in `@nexus/core` — never redefine them locally (web re-exports `CreateProviderRequest`/`UpdateProviderRequest` from core).
- Strict lint policy: never use `eslint-disable`, `@ts-ignore`, `@ts-nocheck`, or rule downgrades. Fix findings in code.
- Never log or return secret values (api keys, extra values, resolved header tokens). The secret value is never read back to the client. (OWASP / "never log sensitive data".)
- API/core code must stay Kanban-neutral (not relevant here, but do not introduce domain identifiers).
- Controllers handle transport only; services own domain logic; repositories own persistence.
- Web components stay presentation-focused; payload assembly lives in `buildProviderPayload`.
- `credential` applies to `auth_type === "api_key"` only; `credential` and a user-supplied `secret_id` are mutually exclusive.
- Canonical field name fallback constant: `API_KEY`. Known-preset name: `<PROVIDER>_API_KEY` (uppercase, non-alphanumerics → `_`).
- Secret metadata tag for managed secrets: `{ managed_by_provider: true, fields: string[] }` where `fields` lists key NAMES only (never values).
- Typecheck and run the relevant unit tests after each task. Commit after each task.

---

### Task 1: Contract — add `credential` to provider schemas (`@nexus/core`)

**Files:**

- Modify: `packages/core/src/schemas/ai-config/providers.schema.ts`
- Modify: `packages/core/src/schemas/ai-config/providers.types.ts`
- Test: `packages/core/src/schemas/ai-config/providers.schema.spec.ts` (create)

**Interfaces:**

- Produces:
  - `ProviderCredentialSchema` (Zod) and type `ProviderCredentialInput = { api_key?: string; extra?: Record<string,string>; headers?: Array<{ name: string; value: string }> }`.
  - `CreateProviderSchema` / `UpdateProviderSchema` now include optional `credential`, with a cross-field refinement: if `credential` is present, `secret_id` must be absent and `auth_type` (when set) must equal `"api_key"`.
  - `CreateProviderRequest` / `UpdateProviderRequest` types (unchanged names) now carry `credential?`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/schemas/ai-config/providers.schema.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreateProviderSchema, UpdateProviderSchema } from "./providers.schema";

describe("CreateProviderSchema credential", () => {
  it("accepts a credential with api_key, extra and headers", () => {
    const parsed = CreateProviderSchema.parse({
      name: "OpenAI",
      provider_id: "openai",
      auth_type: "api_key",
      credential: {
        api_key: "sk-test",
        extra: { ORG_ID: "org_1" },
        headers: [{ name: "X-Title", value: "nexus" }],
      },
    });
    expect(parsed.credential?.api_key).toBe("sk-test");
  });

  it("rejects credential together with secret_id", () => {
    const result = CreateProviderSchema.safeParse({
      name: "OpenAI",
      auth_type: "api_key",
      secret_id: "11111111-1111-1111-1111-111111111111",
      credential: { api_key: "sk-test" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects credential when auth_type is oauth", () => {
    const result = CreateProviderSchema.safeParse({
      name: "OpenAI",
      auth_type: "oauth",
      credential: { api_key: "sk-test" },
    });
    expect(result.success).toBe(false);
  });

  it("UpdateProviderSchema allows a credential-only patch", () => {
    const parsed = UpdateProviderSchema.parse({
      credential: { api_key: "sk-new" },
    });
    expect(parsed.credential?.api_key).toBe("sk-new");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/core -- providers.schema.spec`
Expected: FAIL — `credential` not in schema (extra key stripped, or types missing).

- [ ] **Step 3: Implement minimal schema changes**

In `packages/core/src/schemas/ai-config/providers.schema.ts`, add the credential schema and refinement. Replace the existing `CreateProviderSchema` / `UpdateProviderSchema` block (lines 38-55) with:

```ts
export const ProviderCredentialSchema = z.object({
  api_key: z.string().optional(),
  extra: z.record(z.string(), z.string()).optional(),
  headers: z
    .array(z.object({ name: z.string().min(1), value: z.string() }))
    .optional(),
});

const CreateProviderObject = z.object({
  name: z.string().min(1),
  provider_id: z.string().optional().default("custom"),
  auth_type: z.string().optional(),
  secret_id: z.uuid().nullable().optional(),
  credential: ProviderCredentialSchema.optional(),
  runtime_env: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
  owner_type: providerOwnerTypeSchema.optional().default("global"),
  owner_id: z.string().min(1).nullable().optional(),
  oauth_authorization_url: nullableOptionalUrl,
  oauth_token_url: nullableOptionalUrl,
  oauth_client_id: z.string().min(1).nullable().optional(),
  oauth_client_secret_id: z.uuid().nullable().optional(),
  oauth_scopes: z.array(z.string().min(1)).nullable().optional(),
  oauth_redirect_uri: nullableOptionalUrl,
});

function refineCredential(
  data: { credential?: unknown; secret_id?: unknown; auth_type?: unknown },
  ctx: z.RefinementCtx,
): void {
  if (!data.credential) return;
  if (data.secret_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either an inline credential or a secret_id, not both",
      path: ["credential"],
    });
  }
  if (data.auth_type !== undefined && data.auth_type !== "api_key") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "credential is only valid for api_key auth",
      path: ["credential"],
    });
  }
}

export const CreateProviderSchema =
  CreateProviderObject.superRefine(refineCredential);

export const UpdateProviderSchema =
  CreateProviderObject.partial().superRefine(refineCredential);
```

In `packages/core/src/schemas/ai-config/providers.types.ts`, add after line 14:

```ts
export type ProviderCredentialInput = z.input<typeof ProviderCredentialSchema>;
```

and add `ProviderCredentialSchema` to the type-only import list at the top (lines 2-11) and export `ProviderCredentialInput` from `providers.schema.ts`'s `export type { ... }` block (lines 57-66) — add `ProviderCredentialInput,` to that list.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=packages/core -- providers.schema.spec`
Expected: PASS (4 tests).

- [ ] **Step 5: Build core so downstream workspaces see the new type**

Run: `npm run build --workspace=packages/core`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schemas/ai-config/providers.schema.ts packages/core/src/schemas/ai-config/providers.types.ts packages/core/src/schemas/ai-config/providers.schema.spec.ts
git commit -m "feat(core): add optional credential to provider create/update schemas"
```

---

### Task 2: API — `deriveApiKeyField` pure helper

**Files:**

- Create: `apps/api/src/ai-config/services/provider-credential.helpers.ts`
- Test: `apps/api/src/ai-config/services/provider-credential.helpers.spec.ts`

**Interfaces:**

- Produces: `deriveApiKeyField(providerId?: string | null): string`
  - Known preset (non-empty, not `"custom"`) → `<PROVIDER>_API_KEY` (uppercased, `[^A-Z0-9]` → `_`).
  - `"custom"`, empty, null, undefined → `"API_KEY"`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/ai-config/services/provider-credential.helpers.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveApiKeyField } from "./provider-credential.helpers";

describe("deriveApiKeyField", () => {
  it("uses the provider-scoped convention for a known preset", () => {
    expect(deriveApiKeyField("openai")).toBe("OPENAI_API_KEY");
    expect(deriveApiKeyField("anthropic")).toBe("ANTHROPIC_API_KEY");
  });

  it("normalizes non-alphanumeric characters to underscores", () => {
    expect(deriveApiKeyField("google-vertex")).toBe("GOOGLE_VERTEX_API_KEY");
  });

  it("falls back to API_KEY for custom or empty providers", () => {
    expect(deriveApiKeyField("custom")).toBe("API_KEY");
    expect(deriveApiKeyField("")).toBe("API_KEY");
    expect(deriveApiKeyField(undefined)).toBe("API_KEY");
    expect(deriveApiKeyField(null)).toBe("API_KEY");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- provider-credential.helpers.spec`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement minimal code**

Create `apps/api/src/ai-config/services/provider-credential.helpers.ts`:

```ts
const CANONICAL_API_KEY_FIELD = "API_KEY";

export function deriveApiKeyField(providerId?: string | null): string {
  if (!providerId || providerId === "custom") {
    return CANONICAL_API_KEY_FIELD;
  }
  const token = providerId.toUpperCase().replaceAll(/[^A-Z0-9]/g, "_");
  return `${token}_${CANONICAL_API_KEY_FIELD}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- provider-credential.helpers.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/services/provider-credential.helpers.ts apps/api/src/ai-config/services/provider-credential.helpers.spec.ts
git commit -m "feat(api): add deriveApiKeyField provider credential helper"
```

---

### Task 3: API — pure credential transform helpers (secret value, headers, runtime_env)

**Files:**

- Modify: `apps/api/src/ai-config/services/provider-credential.helpers.ts`
- Modify: `apps/api/src/ai-config/services/provider-credential.helpers.spec.ts`

**Interfaces:**

- Consumes: `deriveApiKeyField` (Task 2).
- Produces:
  - `buildSecretValueMap(params: { apiKeyField: string; apiKey?: string; extra?: Record<string, string> }): Record<string, string>` — includes `apiKeyField` only when `apiKey` is a non-empty string; spreads `extra`. Returns `{}` when nothing provided.
  - `headersToRecord(headers?: Array<{ name: string; value: string }>): Record<string, string> | undefined` — array → object; `undefined` when empty/absent; later entries win on duplicate names.
  - `applyCredentialRuntimeEnv(params: { runtimeEnv?: Record<string, unknown>; apiKeyField: string; headerRecord?: Record<string, string> }): Record<string, unknown>` — returns a new runtime_env that sets `api_key_field` and, when `headerRecord` is provided, merges it into `providerConfig.headers` while preserving any existing `providerConfig` keys and headers.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/ai-config/services/provider-credential.helpers.spec.ts`:

```ts
import {
  buildSecretValueMap,
  headersToRecord,
  applyCredentialRuntimeEnv,
} from "./provider-credential.helpers";

describe("buildSecretValueMap", () => {
  it("includes the api key under the derived field and spreads extra", () => {
    expect(
      buildSecretValueMap({
        apiKeyField: "OPENAI_API_KEY",
        apiKey: "sk-test",
        extra: { ORG_ID: "org_1" },
      }),
    ).toEqual({ OPENAI_API_KEY: "sk-test", ORG_ID: "org_1" });
  });

  it("omits the api key field when the key is blank (keep-existing on edit)", () => {
    expect(
      buildSecretValueMap({
        apiKeyField: "OPENAI_API_KEY",
        apiKey: "",
        extra: { ORG_ID: "org_1" },
      }),
    ).toEqual({ ORG_ID: "org_1" });
  });

  it("returns an empty object when nothing is supplied", () => {
    expect(buildSecretValueMap({ apiKeyField: "API_KEY" })).toEqual({});
  });
});

describe("headersToRecord", () => {
  it("converts pairs to a record", () => {
    expect(
      headersToRecord([
        { name: "X-Title", value: "nexus" },
        { name: "X-Auth", value: "{{TOKEN}}" },
      ]),
    ).toEqual({ "X-Title": "nexus", "X-Auth": "{{TOKEN}}" });
  });

  it("returns undefined for empty or missing input", () => {
    expect(headersToRecord(undefined)).toBeUndefined();
    expect(headersToRecord([])).toBeUndefined();
  });
});

describe("applyCredentialRuntimeEnv", () => {
  it("pins api_key_field and leaves providerConfig untouched without headers", () => {
    expect(
      applyCredentialRuntimeEnv({
        runtimeEnv: { pi_provider: "openai" },
        apiKeyField: "OPENAI_API_KEY",
      }),
    ).toEqual({ pi_provider: "openai", api_key_field: "OPENAI_API_KEY" });
  });

  it("merges headers into providerConfig without clobbering existing config", () => {
    expect(
      applyCredentialRuntimeEnv({
        runtimeEnv: {
          pi_provider: "openai",
          providerConfig: { name: "OpenAI", headers: { "X-Existing": "a" } },
        },
        apiKeyField: "OPENAI_API_KEY",
        headerRecord: { "X-Title": "nexus" },
      }),
    ).toEqual({
      pi_provider: "openai",
      api_key_field: "OPENAI_API_KEY",
      providerConfig: {
        name: "OpenAI",
        headers: { "X-Existing": "a", "X-Title": "nexus" },
      },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test --workspace=apps/api -- provider-credential.helpers.spec`
Expected: FAIL — new functions not exported.

- [ ] **Step 3: Implement minimal code**

Append to `apps/api/src/ai-config/services/provider-credential.helpers.ts`:

```ts
export function buildSecretValueMap(params: {
  apiKeyField: string;
  apiKey?: string;
  extra?: Record<string, string>;
}): Record<string, string> {
  const value: Record<string, string> = { ...(params.extra ?? {}) };
  if (typeof params.apiKey === "string" && params.apiKey.length > 0) {
    value[params.apiKeyField] = params.apiKey;
  }
  return value;
}

export function headersToRecord(
  headers?: Array<{ name: string; value: string }>,
): Record<string, string> | undefined {
  if (!headers || headers.length === 0) {
    return undefined;
  }
  return Object.fromEntries(headers.map((h) => [h.name, h.value]));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function applyCredentialRuntimeEnv(params: {
  runtimeEnv?: Record<string, unknown>;
  apiKeyField: string;
  headerRecord?: Record<string, string>;
}): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...(params.runtimeEnv ?? {}),
    api_key_field: params.apiKeyField,
  };

  if (params.headerRecord) {
    const existingConfig = asRecord(next.providerConfig);
    const existingHeaders = asRecord(existingConfig.headers) as Record<
      string,
      string
    >;
    next.providerConfig = {
      ...existingConfig,
      headers: { ...existingHeaders, ...params.headerRecord },
    };
  }

  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- provider-credential.helpers.spec`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/services/provider-credential.helpers.ts apps/api/src/ai-config/services/provider-credential.helpers.spec.ts
git commit -m "feat(api): add credential-to-secret/runtime_env transform helpers"
```

---

### Task 4: API — `ProviderCredentialService` orchestration

**Files:**

- Create: `apps/api/src/ai-config/services/provider-credential.service.ts`
- Create: `apps/api/src/ai-config/services/provider-credential.service.spec.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts` (register provider)

**Interfaces:**

- Consumes: `SecretCrudService` (`apps/api/src/security/services/secret-crud.service.ts`) methods `create(data)`, `update(id, data)`, `findByIdRaw(id)`; helpers from Task 2/3; `CreateProviderRequest`/`UpdateProviderRequest` from `@nexus/core`; `LlmProvider` entity.
- Produces:
  - `class ProviderCredentialService` with:
    - `applyOnCreate(data: CreateProviderRequest): Promise<CreateProviderRequest>` — when `data.credential` present, creates a managed secret, returns a copy with `credential` removed, `secret_id` set, and `runtime_env` enriched. Throws `BadRequestException` if the credential yields an empty secret value (no api_key and no extra) and no existing secret applies.
    - `applyOnUpdate(data: UpdateProviderRequest, existing: LlmProvider | null): Promise<UpdateProviderRequest>` — when `data.credential` present, merges changed keys into the existing managed secret (decrypt → merge → re-encrypt) or creates one if none exists; returns a copy with `credential` removed, `secret_id` set, `runtime_env` enriched.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/ai-config/services/provider-credential.service.spec.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderCredentialService } from "./provider-credential.service";
import type { LlmProvider } from "../database/entities/llm-provider.entity";

function makeSecrets() {
  return {
    create: vi.fn().mockResolvedValue({ id: "secret-1", name: "x" }),
    update: vi.fn().mockResolvedValue({ id: "secret-1", name: "x" }),
    findByIdRaw: vi.fn(),
  };
}

describe("ProviderCredentialService.applyOnCreate", () => {
  let secrets: ReturnType<typeof makeSecrets>;
  let service: ProviderCredentialService;

  beforeEach(() => {
    secrets = makeSecrets();
    service = new ProviderCredentialService(secrets as never);
  });

  it("passes through unchanged when no credential is present", async () => {
    const data = { name: "OpenAI", secret_id: "existing" } as never;
    expect(await service.applyOnCreate(data)).toBe(data);
    expect(secrets.create).not.toHaveBeenCalled();
  });

  it("creates a managed secret and wires secret_id + runtime_env", async () => {
    const result = await service.applyOnCreate({
      name: "OpenAI",
      provider_id: "openai",
      auth_type: "api_key",
      credential: {
        api_key: "sk-test",
        extra: { ORG_ID: "org_1" },
        headers: [{ name: "X-Title", value: "nexus" }],
      },
    } as never);

    expect(secrets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        value: { OPENAI_API_KEY: "sk-test", ORG_ID: "org_1" },
        metadata: {
          managed_by_provider: true,
          fields: ["ORG_ID", "OPENAI_API_KEY"],
        },
      }),
    );
    expect(result.secret_id).toBe("secret-1");
    expect(result.credential).toBeUndefined();
    expect(result.runtime_env).toEqual({
      api_key_field: "OPENAI_API_KEY",
      providerConfig: { headers: { "X-Title": "nexus" } },
    });
  });

  it("throws when the credential produces an empty secret", async () => {
    await expect(
      service.applyOnCreate({
        name: "OpenAI",
        provider_id: "openai",
        auth_type: "api_key",
        credential: {},
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("ProviderCredentialService.applyOnUpdate", () => {
  let secrets: ReturnType<typeof makeSecrets>;
  let service: ProviderCredentialService;

  beforeEach(() => {
    secrets = makeSecrets();
    service = new ProviderCredentialService(secrets as never);
  });

  it("merges changed keys into the existing secret, keeping the api key when blank", async () => {
    secrets.findByIdRaw.mockResolvedValue({
      id: "secret-1",
      decryptedValue: JSON.stringify({ OPENAI_API_KEY: "sk-old", ORG_ID: "a" }),
    });
    const existing = {
      id: "p1",
      provider_id: "openai",
      secret_id: "secret-1",
      runtime_env: { pi_provider: "openai" },
    } as unknown as LlmProvider;

    const result = await service.applyOnUpdate(
      { credential: { extra: { ORG_ID: "b" } } } as never,
      existing,
    );

    expect(secrets.update).toHaveBeenCalledWith(
      "secret-1",
      expect.objectContaining({
        value: { OPENAI_API_KEY: "sk-old", ORG_ID: "b" },
      }),
    );
    expect(result.secret_id).toBe("secret-1");
    expect(result.credential).toBeUndefined();
    expect(result.runtime_env).toMatchObject({
      api_key_field: "OPENAI_API_KEY",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- provider-credential.service.spec`
Expected: FAIL — service module not found.

- [ ] **Step 3: Implement minimal service**

Create `apps/api/src/ai-config/services/provider-credential.service.ts`:

```ts
import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  CreateProviderRequest,
  ProviderCredentialInput,
  UpdateProviderRequest,
} from "@nexus/core";
import { SecretCrudService } from "../../security/services/secret-crud.service";
import type { LlmProvider } from "../database/entities/llm-provider.entity";
import {
  applyCredentialRuntimeEnv,
  buildSecretValueMap,
  deriveApiKeyField,
  headersToRecord,
} from "./provider-credential.helpers";

const MANAGED_SECRET_SUFFIX = " credentials";

@Injectable()
export class ProviderCredentialService {
  constructor(private readonly secrets: SecretCrudService) {}

  async applyOnCreate(
    data: CreateProviderRequest,
  ): Promise<CreateProviderRequest> {
    if (!data.credential) {
      return data;
    }
    const apiKeyField = deriveApiKeyField(data.provider_id);
    const value = this.buildValue(apiKeyField, data.credential);
    if (Object.keys(value).length === 0) {
      throw new BadRequestException(
        "An inline credential must include an API key or at least one value",
      );
    }
    const secret = await this.secrets.create({
      name: `${data.name}${MANAGED_SECRET_SUFFIX}`,
      value,
      metadata: { managed_by_provider: true, fields: Object.keys(value) },
    });
    return this.finalize(data, secret.id, apiKeyField, data.credential);
  }

  async applyOnUpdate(
    data: UpdateProviderRequest,
    existing: LlmProvider | null,
  ): Promise<UpdateProviderRequest> {
    if (!data.credential) {
      return data;
    }
    const apiKeyField = deriveApiKeyField(
      data.provider_id ?? existing?.provider_id,
    );
    const changed = this.buildValue(apiKeyField, data.credential);
    const existingSecretId = existing?.secret_id ?? null;

    let secretId: string;
    if (existingSecretId) {
      const raw = await this.secrets.findByIdRaw(existingSecretId);
      const current = this.parse(raw?.decryptedValue);
      const merged = { ...current, ...changed };
      await this.secrets.update(existingSecretId, {
        value: merged,
        metadata: { managed_by_provider: true, fields: Object.keys(merged) },
      });
      secretId = existingSecretId;
    } else {
      if (Object.keys(changed).length === 0) {
        throw new BadRequestException(
          "An inline credential must include an API key or at least one value",
        );
      }
      const secret = await this.secrets.create({
        name: `${data.name ?? existing?.name ?? "provider"}${MANAGED_SECRET_SUFFIX}`,
        value: changed,
        metadata: { managed_by_provider: true, fields: Object.keys(changed) },
      });
      secretId = secret.id;
    }
    return this.finalize(
      data,
      secretId,
      apiKeyField,
      data.credential,
      existing?.runtime_env,
    );
  }

  private buildValue(
    apiKeyField: string,
    credential: ProviderCredentialInput,
  ): Record<string, string> {
    return buildSecretValueMap({
      apiKeyField,
      apiKey: credential.api_key,
      extra: credential.extra,
    });
  }

  private finalize<T extends CreateProviderRequest | UpdateProviderRequest>(
    data: T,
    secretId: string,
    apiKeyField: string,
    credential: ProviderCredentialInput,
    existingRuntimeEnv?: Record<string, unknown>,
  ): T {
    const { credential: _omit, ...rest } = data;
    return {
      ...(rest as T),
      secret_id: secretId,
      runtime_env: applyCredentialRuntimeEnv({
        runtimeEnv: data.runtime_env ?? existingRuntimeEnv,
        apiKeyField,
        headerRecord: headersToRecord(credential.headers),
      }),
    };
  }

  private parse(value?: string): Record<string, string> {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
```

- [ ] **Step 4: Register the service in the module**

In `apps/api/src/ai-config/ai-config.module.ts`, add the import after line 33:

```ts
import { ProviderCredentialService } from "./services/provider-credential.service";
```

and add `ProviderCredentialService,` to the `providers` array (after `ProviderCrudService,` on line 72).

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test --workspace=apps/api -- provider-credential.service.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/services/provider-credential.service.ts apps/api/src/ai-config/services/provider-credential.service.spec.ts apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(api): add ProviderCredentialService for inline credential orchestration"
```

---

### Task 5: API — wire credential orchestration into `AiConfigAdminService`

**Files:**

- Modify: `apps/api/src/ai-config/ai-config-admin.service.ts:72-82`
- Modify: `apps/api/src/ai-config/ai-config-admin.service.spec.ts`

**Interfaces:**

- Consumes: `ProviderCredentialService.applyOnCreate` / `applyOnUpdate` (Task 4); existing `ProviderCrudService.create` / `update` / `findById`.
- Produces: `AiConfigAdminService.createProvider` / `updateProvider` now run credential orchestration before persistence; `credential` never reaches the repository.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/src/ai-config/ai-config-admin.service.spec.ts` (follow the file's existing setup; the snippet below shows the new behaviors — adapt to the existing mock/provider construction in that file):

```ts
it("runs credential orchestration before creating a provider", async () => {
  // providerCredentialService.applyOnCreate is mocked to strip credential and set secret_id
  const spy = vi
    .spyOn(providerCredentialService, "applyOnCreate")
    .mockResolvedValue({
      name: "OpenAI",
      provider_id: "openai",
      auth_type: "api_key",
      secret_id: "secret-1",
      runtime_env: { api_key_field: "OPENAI_API_KEY" },
    } as never);

  await service.createProvider({
    name: "OpenAI",
    provider_id: "openai",
    auth_type: "api_key",
    credential: { api_key: "sk-test" },
  } as never);

  expect(spy).toHaveBeenCalled();
  expect(providerCrudService.create).toHaveBeenCalledWith(
    expect.not.objectContaining({ credential: expect.anything() }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- ai-config-admin.service.spec`
Expected: FAIL — `createProvider` does not call `applyOnCreate`; `providerCredentialService` not injected.

- [ ] **Step 3: Implement the wiring**

In `apps/api/src/ai-config/ai-config-admin.service.ts`:

Add the import after line 12:

```ts
import { ProviderCredentialService } from "./services/provider-credential.service";
```

Add the constructor dependency (after line 44, alongside `providerCrudService`):

```ts
    private readonly providerCredentialService: ProviderCredentialService,
```

Replace `createProvider` (lines 72-74):

```ts
  async createProvider(data: CreateProviderRequest) {
    const prepared = await this.providerCredentialService.applyOnCreate(data);
    return this.providerCrudService.create(prepared);
  }
```

Replace `updateProvider` (lines 76-82):

```ts
  async updateProvider(id: string, data: UpdateProviderRequest) {
    const existing = await this.providerCrudService.findById(id);
    const prepared = await this.providerCredentialService.applyOnUpdate(
      data,
      existing,
    );
    const updated = await this.providerCrudService.update(id, prepared);
    if (!updated) {
      throw new NotFoundException(`Provider with ID ${id} not found`);
    }
    return updated;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- ai-config-admin.service.spec`
Expected: PASS.

- [ ] **Step 5: Verify the module compiles (DI graph intact)**

Run: `npm run test --workspace=apps/api -- ai-config.module.spec`
Expected: PASS (module instantiates with the new provider).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ai-config/ai-config-admin.service.ts apps/api/src/ai-config/ai-config-admin.service.spec.ts
git commit -m "feat(api): orchestrate inline provider credential on create/update"
```

---

### Task 6: API — resolve `{{KEY}}` placeholders in provider headers at runtime

**Files:**

- Modify: `apps/api/src/ai-config/ai-configuration-runner-provider.helpers.ts:90-98` (and add helper near the other `as*` helpers)
- Create: `apps/api/src/ai-config/ai-configuration-runner-provider.helpers.spec.ts`

**Interfaces:**

- Consumes: existing `resolveProviderRegistrationConfig(params)` with `params.secretMap`.
- Produces: header values containing `{{KEY}}` are replaced with the matching string value from `secretMap`; unmatched placeholders are left intact (no value logged).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/ai-config/ai-configuration-runner-provider.helpers.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveProviderRegistrationConfig } from "./ai-configuration-runner-provider.helpers";

describe("resolveProviderRegistrationConfig header interpolation", () => {
  it("replaces {{KEY}} header tokens from the secret map", () => {
    const config = resolveProviderRegistrationConfig({
      auth: { type: "api_key", apiKey: "sk" },
      runtimeEnv: {
        providerConfig: {
          headers: { "X-Auth": "Bearer {{EDGE_TOKEN}}", "X-Title": "nexus" },
        },
      },
      secretMap: { EDGE_TOKEN: "tok_123" },
    });

    expect(config?.headers).toEqual({
      "X-Auth": "Bearer tok_123",
      "X-Title": "nexus",
    });
  });

  it("leaves unmatched placeholders intact", () => {
    const config = resolveProviderRegistrationConfig({
      auth: { type: "api_key", apiKey: "sk" },
      runtimeEnv: { providerConfig: { headers: { "X-Auth": "{{MISSING}}" } } },
      secretMap: {},
    });

    expect(config?.headers).toEqual({ "X-Auth": "{{MISSING}}" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- ai-configuration-runner-provider.helpers.spec`
Expected: FAIL — headers are returned verbatim (`Bearer {{EDGE_TOKEN}}`).

- [ ] **Step 3: Implement minimal interpolation**

In `apps/api/src/ai-config/ai-configuration-runner-provider.helpers.ts`, change line 94 inside `resolveProviderRegistrationConfig`'s `config` object from:

```ts
    headers: asStringRecord(source.headers),
```

to:

```ts
    headers: interpolateHeaders(asStringRecord(source.headers), params.secretMap),
```

Add this helper near the other `as*` helpers (e.g. after `asStringRecord`, around line 416):

```ts
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function interpolateHeaders(
  headers: Record<string, string> | undefined,
  secretMap: ProviderRawConfig,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      value.replaceAll(PLACEHOLDER_PATTERN, (match, token: string) => {
        const replacement = secretMap[token];
        return typeof replacement === "string" ? replacement : match;
      }),
    ]),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- ai-configuration-runner-provider.helpers.spec`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/ai-config/ai-configuration-runner-provider.helpers.ts apps/api/src/ai-config/ai-configuration-runner-provider.helpers.spec.ts
git commit -m "feat(api): interpolate {{KEY}} placeholders in provider headers from secret"
```

---

### Task 7: Web — extend form data + `buildProviderPayload` to emit `credential`

**Files:**

- Modify: `apps/web/src/pages/providers/ProviderFormFields.tsx:22-36` (FormData) + `apps/web/src/pages/providers/ProviderForm.tsx:22-36,64-99` (schema + defaults)
- Modify: `apps/web/src/pages/providers/ProviderSubcomponents.tsx:252-275` (buildProviderPayload)
- Create: `apps/web/src/pages/providers/buildProviderPayload.spec.ts`

**Interfaces:**

- Consumes: `CreateProviderRequest` (re-exported from `@nexus/core`, now with `credential`).
- Produces: `FormData` gains `credential_mode: "create" | "existing"`, `api_key?: string`, `headers?: Array<{ name: string; value: string }>`, `extra_values?: Array<{ name: string; value: string }>`. `buildProviderPayload` emits `credential` in create mode (omitting blank `api_key`), or `secret_id` in existing mode, for `auth_type === "api_key"`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/providers/buildProviderPayload.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProviderPayload } from "./ProviderSubcomponents";
import type { ProviderFormData } from "./ProviderForm";

const base: ProviderFormData = {
  name: "OpenAI",
  provider_id: "openai",
  auth_type: "api_key",
  credential_mode: "create",
  api_key: "",
  secret_id: "",
  owner_type: "global",
  owner_id: "",
  oauth_authorization_url: "",
  oauth_token_url: "",
  oauth_client_id: "",
  oauth_client_secret_id: "",
  oauth_scopes: "",
  oauth_redirect_uri: "",
  runtime_env: "",
  headers: [],
  extra_values: [],
};

describe("buildProviderPayload credential", () => {
  it("emits a credential in create mode", () => {
    const payload = buildProviderPayload({
      ...base,
      api_key: "sk-test",
      headers: [{ name: "X-Title", value: "nexus" }],
      extra_values: [{ name: "ORG_ID", value: "org_1" }],
    });
    expect(payload.credential).toEqual({
      api_key: "sk-test",
      extra: { ORG_ID: "org_1" },
      headers: [{ name: "X-Title", value: "nexus" }],
    });
    expect(payload.secret_id).toBeNull();
  });

  it("omits a blank api_key (keep-existing on edit) but keeps other credential fields", () => {
    const payload = buildProviderPayload({
      ...base,
      api_key: "",
      extra_values: [{ name: "ORG_ID", value: "org_2" }],
    });
    expect(payload.credential?.api_key).toBeUndefined();
    expect(payload.credential?.extra).toEqual({ ORG_ID: "org_2" });
  });

  it("emits secret_id (no credential) in existing mode", () => {
    const payload = buildProviderPayload({
      ...base,
      credential_mode: "existing",
      secret_id: "secret-1",
    });
    expect(payload.credential).toBeUndefined();
    expect(payload.secret_id).toBe("secret-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- buildProviderPayload.spec`
Expected: FAIL — `credential_mode`/`headers` not on `FormData`; payload has no `credential`.

- [ ] **Step 3: Extend `FormData`**

In `apps/web/src/pages/providers/ProviderFormFields.tsx`, add to the `FormData` interface (after line 35, before the closing brace):

```ts
  credential_mode?: "create" | "existing";
  api_key?: string;
  headers?: Array<{ name: string; value: string }>;
  extra_values?: Array<{ name: string; value: string }>;
```

- [ ] **Step 4: Extend the form schema + defaults**

In `apps/web/src/pages/providers/ProviderForm.tsx`, add to `formSchema` (after line 35, before the closing `})`):

```ts
  credential_mode: z.enum(["create", "existing"]).optional(),
  api_key: z.string().optional(),
  headers: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
  extra_values: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional(),
```

Add to `EMPTY_DEFAULTS` (after line 77 `runtime_env: ""`):

```ts
  credential_mode: "create",
  api_key: "",
  headers: [],
  extra_values: [],
```

Add to the `computeDefaults` return (after the `runtime_env` line, around line 97). On edit, default to "existing" only when the provider already has a secret that was NOT provider-managed; otherwise keep "create" so the masked key field shows. For simplicity, default edit to `"create"` with empty `api_key` (blank = keep) and pre-fill header names from `runtime_env.providerConfig.headers`:

```ts
    credential_mode: "create",
    api_key: "",
    headers: extractHeaderPairs(provider.runtime_env),
    extra_values: [],
```

Add this helper above `computeDefaults` (after line 78):

```ts
function extractHeaderPairs(
  runtimeEnv?: Record<string, unknown>,
): Array<{ name: string; value: string }> {
  const config = runtimeEnv?.providerConfig as
    | { headers?: Record<string, string> }
    | undefined;
  const headers = config?.headers ?? {};
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value),
  }));
}
```

- [ ] **Step 5: Update `buildProviderPayload`**

In `apps/web/src/pages/providers/ProviderSubcomponents.tsx`, add a credential builder above `buildProviderPayload` (after line 250):

```ts
function pairsToRecord(
  pairs?: Array<{ name: string; value: string }>,
): Record<string, string> | undefined {
  const entries = (pairs ?? []).filter((p) => p.name.trim().length > 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map((p) => [p.name, p.value]));
}

function buildCredential(
  data: ProviderFormData,
): CreateProviderRequest["credential"] | undefined {
  if (data.auth_type !== "api_key" || data.credential_mode === "existing") {
    return undefined;
  }
  const headers = (data.headers ?? []).filter((h) => h.name.trim().length > 0);
  const extra = pairsToRecord(data.extra_values);
  const apiKey = data.api_key?.trim() ? data.api_key : undefined;
  if (!apiKey && !extra && headers.length === 0) {
    return undefined;
  }
  return {
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(extra ? { extra } : {}),
    ...(headers.length > 0 ? { headers } : {}),
  };
}
```

Then modify the `buildProviderPayload` return (lines 260-274). Replace the `secret_id` line and add `credential`:

```ts
const credential = buildCredential(data);
const useExisting = data.credential_mode === "existing";

return {
  name: data.name,
  provider_id: data.provider_id || "custom",
  auth_type: data.auth_type,
  secret_id: useExisting ? data.secret_id || null : null,
  credential,
  runtime_env: runtimeEnv,
  owner_type: (data.owner_type as ConfigOwnerType) || "global",
  owner_id: data.owner_id || null,
  oauth_authorization_url: oauthField(data.oauth_authorization_url, isApiKey),
  oauth_token_url: oauthField(data.oauth_token_url, isApiKey),
  oauth_client_id: oauthField(data.oauth_client_id, isApiKey),
  oauth_client_secret_id: oauthField(data.oauth_client_secret_id, isApiKey),
  oauth_scopes: isApiKey ? null : parseScopes(data.oauth_scopes),
  oauth_redirect_uri: oauthField(data.oauth_redirect_uri, isApiKey),
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit:web -- buildProviderPayload.spec`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/providers/ProviderFormFields.tsx apps/web/src/pages/providers/ProviderForm.tsx apps/web/src/pages/providers/ProviderSubcomponents.tsx apps/web/src/pages/providers/buildProviderPayload.spec.ts
git commit -m "feat(web): emit inline credential from provider payload builder"
```

---

### Task 8: Web — Credential section UI (mode toggle, API key, headers, extra values)

**Files:**

- Create: `apps/web/src/pages/providers/CredentialSection.tsx`
- Modify: `apps/web/src/pages/providers/ProviderFormFields.tsx:325-356` (remove the always-on secret dropdown; the dropdown moves into CredentialSection's "existing" mode)
- Modify: `apps/web/src/pages/providers/ProviderForm.tsx:253-268` (render `CredentialSection` for api_key auth)
- Create: `apps/web/src/pages/providers/CredentialSection.spec.tsx`

**Interfaces:**

- Consumes: `UseFormReturn<FormData>` with the Task 7 fields; `Secret[]`; react-hook-form `useFieldArray` for `headers` and `extra_values`.
- Produces: `CredentialSection` component rendered only when `auth_type === "api_key"` and `!isDeviceFlow`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/providers/CredentialSection.spec.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { Form } from "@/components/ui/form";
import { CredentialSection } from "./CredentialSection";
import type { FormData } from "./ProviderFormFields";

function Harness({ secrets = [] as never[] }) {
  const form = useForm<FormData>({
    defaultValues: {
      name: "OpenAI",
      auth_type: "api_key",
      credential_mode: "create",
      api_key: "",
      headers: [],
      extra_values: [],
    } as FormData,
  });
  return (
    <Form {...form}>
      <CredentialSection form={form} secrets={secrets} isEdit={false} />
    </Form>
  );
}

describe("CredentialSection", () => {
  it("shows the API Key field in create mode", () => {
    render(<Harness />);
    expect(screen.getByLabelText(/API Key/i)).toBeInTheDocument();
  });

  it("lets the user add a custom header row", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /add header/i }));
    expect(screen.getByPlaceholderText(/header name/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit:web -- CredentialSection.spec`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement `CredentialSection`**

Create `apps/web/src/pages/providers/CredentialSection.tsx`:

```tsx
import { type UseFormReturn, useFieldArray } from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Secret } from "@/lib/api/types";
import type { FormData } from "./ProviderFormFields";

interface PairListProps {
  form: UseFormReturn<FormData>;
  name: "headers" | "extra_values";
  label: string;
  addLabel: string;
  namePlaceholder: string;
  valuePlaceholder: string;
}

function PairList({
  form,
  name,
  label,
  addLabel,
  namePlaceholder,
  valuePlaceholder,
}: Readonly<PairListProps>) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name,
  });
  return (
    <div className="space-y-2">
      <FormLabel>{label}</FormLabel>
      {fields.map((field, index) => (
        <div key={field.id} className="flex gap-2">
          <Input
            placeholder={namePlaceholder}
            {...form.register(`${name}.${index}.name` as const)}
          />
          <Input
            placeholder={valuePlaceholder}
            {...form.register(`${name}.${index}.value` as const)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => remove(index)}
            aria-label="Remove row"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ name: "", value: "" })}
      >
        <Plus className="h-4 w-4 mr-1" />
        {addLabel}
      </Button>
    </div>
  );
}

export function CredentialSection({
  form,
  secrets,
  isEdit,
}: Readonly<{
  form: UseFormReturn<FormData>;
  secrets: Secret[];
  isEdit: boolean;
}>) {
  const mode = form.watch("credential_mode") ?? "create";

  return (
    <div className="border rounded-md p-4 space-y-4 bg-muted/30">
      <FormField
        control={form.control}
        name="credential_mode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Credential</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value ?? "create"}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="create">Create new</SelectItem>
                <SelectItem value="existing">Use existing secret</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />

      {mode === "create" ? (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="api_key"
            render={({ field }) => (
              <FormItem>
                <FormLabel>API Key</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={
                      isEdit ? "•••• set — leave blank to keep" : "sk-..."
                    }
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <PairList
            form={form}
            name="headers"
            label="Custom headers"
            addLabel="Add header"
            namePlaceholder="Header name (e.g. X-Title)"
            valuePlaceholder="Value or {{SECRET_KEY}}"
          />
          <PairList
            form={form}
            name="extra_values"
            label="Additional secret values"
            addLabel="Add value"
            namePlaceholder="Name (e.g. ORG_ID)"
            valuePlaceholder="Value"
          />
        </div>
      ) : (
        <FormField
          control={form.control}
          name="secret_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Secret</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a secret" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {secrets.length === 0 ? (
                    <SelectItem value="no-secrets" disabled>
                      No secrets available
                    </SelectItem>
                  ) : (
                    secrets.map((secret) => (
                      <SelectItem key={secret.id} value={secret.id}>
                        {secret.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Remove the old always-on secret dropdown and render `CredentialSection`**

In `apps/web/src/pages/providers/ProviderFormFields.tsx`, delete the `secret_id` `FormField` block (lines 325-356) — the dropdown now lives in `CredentialSection`'s "existing" mode. (`ProviderBasicFields` keeps name/auth_type/owner fields.)

In `apps/web/src/pages/providers/ProviderForm.tsx`:

Add the import after line 20:

```ts
import { CredentialSection } from "./CredentialSection";
```

Render it after `ProviderBasicFields` (after line 264, before the `showOauth` block):

```tsx
{
  !isDeviceFlow && form.watch("auth_type") === "api_key" && (
    <CredentialSection
      form={form}
      secrets={secrets}
      isEdit={Boolean(provider)}
    />
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:unit:web -- CredentialSection.spec`
Expected: PASS (2 tests).

- [ ] **Step 6: Run the existing provider-form tests to catch regressions from removing the dropdown**

Run: `npm run test:unit:web -- ProviderForm.spec`
Expected: PASS. If a test asserted the old always-on "Secret" dropdown, update it to drive `credential_mode = "existing"` first (the dropdown now appears only in existing mode).

- [ ] **Step 7: Typecheck web**

Run: `npm run build:web`
Expected: Build succeeds (no type errors).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/providers/CredentialSection.tsx apps/web/src/pages/providers/CredentialSection.spec.tsx apps/web/src/pages/providers/ProviderFormFields.tsx apps/web/src/pages/providers/ProviderForm.tsx
git commit -m "feat(web): inline credential section on provider form"
```

---

### Task 9: Docs — provider setup guide

**Files:**

- Modify: `docs/guide/README.md` (provider/secret setup section — locate the existing provider-creation guidance and update it)
- Modify: `apps/api/README.md` (if it documents provider/secret creation) — only if a relevant section exists.

**Interfaces:** none (documentation).

- [ ] **Step 1: Locate the existing provider/secret docs**

Run: `grep -rn "secret_id\|create a provider\|llm_provider\|providers page" docs/guide/README.md`
Expected: Find the section describing provider creation (or the nearest AI-config/onboarding section).

- [ ] **Step 2: Update the guide**

Document the new flow in that section:

- Creating an api_key provider now accepts an inline **API Key**; the secret is created automatically with the correct field name — no need to pre-create a secret or guess the JSON key.
- Optional **custom headers** (values may reference secret entries via `{{KEY}}`) and **additional secret values**.
- **Use existing secret** mode for reuse.
- Editing: leave the API Key blank to keep the existing key; type a new value to rotate it.
- Note OAuth provider setup is unchanged.

- [ ] **Step 3: Commit**

```bash
git add docs/guide/README.md apps/api/README.md
git commit -m "docs(guide): document inline provider credential creation"
```

---

### Task 10: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Build core and apps**

Run: `npm run build --workspace=packages/core && npm run build:api && npm run build:web`
Expected: All builds succeed.

- [ ] **Step 2: Run the affected unit suites**

Run: `npm run test --workspace=packages/core && npm run test:api && npm run test:unit:web`
Expected: All pass. (If unrelated pre-existing failures appear, note them; do not fix out-of-scope failures here.)

- [ ] **Step 3: Lint the touched workspaces**

Run: `npm run lint:api && npm run lint:web`
Expected: No errors. Fix any findings in code (no suppressions).

- [ ] **Step 4: Commit any lint/format fixups**

```bash
git add -A
git commit -m "chore: lint and format inline provider credential changes"
```

---

## Self-Review

**1. Spec coverage**

- Decision 1 (field naming, pin `api_key_field`) → Task 2 (`deriveApiKeyField`), Task 3 (`applyCredentialRuntimeEnv` pins it), Task 4 (uses it).
- Decision 2 (custom headers, `{{KEY}}` placeholders) → Task 6 (interpolation), Task 7/8 (UI emits headers).
- Decision 3 (additional key/values in the secret JSON) → Task 3 (`buildSecretValueMap` spreads `extra`), Task 7/8 (extra_values UI).
- Decision 4 (edit/rotate, blank=keep, server-side merge) → Task 4 (`applyOnUpdate` merge; `buildSecretValueMap` omits blank key), Task 7 (omit blank api_key), Task 8 (masked field).
- Decision 5 (OAuth out of scope) → Tasks scope credential to `auth_type === "api_key"`; OAuth fields untouched.
- Decision 6 (use existing secret) → Task 8 "existing" mode + Task 7 emits `secret_id`.
- Contract `credential`, mutual exclusivity, auth_type guard → Task 1.
- Error handling (empty credential) → Task 4. Mutual-exclusivity/auth_type 400 → Task 1 (schema refine via `ZodBody`).
- Metadata tagging (`managed_by_provider`, `fields`) → Task 4.
- Testing strategy → tests in Tasks 1-8; gate in Task 10.

No uncovered spec requirements.

**2. Placeholder scan**

No "TBD"/"TODO"/"add validation"/"similar to Task N". Every code step shows complete code. Task 9 (docs) is inherently prose but specifies exact bullet content and the grep to locate the section.

**3. Type consistency**

- `deriveApiKeyField`, `buildSecretValueMap`, `headersToRecord`, `applyCredentialRuntimeEnv` signatures defined in Tasks 2-3 and consumed verbatim in Task 4.
- `ProviderCredentialService.applyOnCreate(data)` / `applyOnUpdate(data, existing)` defined in Task 4 and called identically in Task 5.
- `FormData` fields (`credential_mode`, `api_key`, `headers`, `extra_values`) defined in Task 7 and used in Tasks 7-8.
- `ProviderCredentialInput` / `credential` shape (`api_key`, `extra`, `headers: {name,value}[]`) is consistent across core (Task 1), API service (Task 4), and web payload (Task 7).

Note on edit-mode partial extra-value edits: `applyOnUpdate` merges only the keys present in the patch into the decrypted secret, so editing one extra value preserves the rest and the stored API key (blank key = untouched). This matches the spec's server-side-merge requirement.
