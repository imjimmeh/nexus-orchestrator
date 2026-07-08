# EPIC-201 Remaining Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining EPIC-201 workstreams: fix two parameter gaps, add `ModelCapability` to the model registry, implement W5 real-embedding strategy (OpenAI-compatible via existing provider infrastructure), and add W6 DB-backed pipeline configuration.

**Architecture:**
- Tasks 1–2: Fix `offset` not applied in the pipeline, and expose `includeScores`/`minScore` in the wire schema.
- Task 3: Add a `ModelCapability` string-backed enum (`completions | embeddings | reranking`) to `LlmModel`. Default `'completions'` — fully backward-compatible. Admins tag embedding models at registration time.
- Task 4: Make `ISkillSearchStrategy.search()` return `Promise<ScoredSkillResult[]>` so the embedding strategy can do async HTTP calls. All existing strategies get a trivial `async` keyword; the call chain up to `SearchSkillsTool.execute()` (already async) gains `await`.
- Task 5: `EmbeddingProviderService` resolves provider config via `AiConfigurationService.resolveRunnerProviderConfig()`, calls `POST /embeddings` (OpenAI-compatible, generic base URL from provider's `runtime_env`), returns `Float32Array[]`.
- Task 6: `EmbeddingMatchStrategy` — pre-caches skill embeddings keyed by `${name}:${version}`, caches query embeddings by string, computes cosine similarity. Gated by `NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED=true`; gracefully returns `[]` on any error.
- Tasks 7–10: W6 — `SkillSearchConfig` TypeORM entity (singleton row) + service (sync cache, `OnModuleInit`) + admin API + pipeline reads enabled strategies and default min score from config. Embedding provider/model names stored in config as override for env vars.

**Tech Stack:** NestJS, TypeORM, Zod, Vitest, native `fetch`, `@nexus/core` shared schema package

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Modify** | `apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts` | Add `offset?` to `SkillSearchParams`; make `search()` return `Promise` |
| **Modify** | `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts` | `async search()`; apply offset; add embedding strategy; use config |
| **Modify** | `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts` | Add `includeScores`, `minScore` to `searchSkillsSchema` |
| **Modify** | `apps/api/src/workflow/workflow-internal-tools/tools/skill/search-skills.tool.ts` | Forward new params; surface `_score` in response |
| **Modify** | `packages/core/src/schemas/ai-config/models.schema.ts` | Add `ModelCapabilitySchema` enum + `capability` field |
| **Modify** | `packages/core/src/schemas/ai-config/models.types.ts` | Export `ModelCapability` type |
| **Modify** | `apps/api/src/ai-config/database/entities/llm-model.entity.ts` | Add `capability` varchar column (default `'completions'`) |
| **Modify** | all three `*.strategy.ts` files (token, fuzzy, tfidf) | `async search()` |
| **Modify** | all three `*.strategy.spec.ts` files | `await strategy.search()` |
| **Modify** | `apps/api/src/ai-config/services/agent-skills.service.ts` | `async searchSkills()` |
| **Modify** | `apps/api/src/ai-config/services/agent-skills.service.spec.ts` | `await service.searchSkills()` |
| **Create** | `apps/api/src/ai-config/services/skill-search/embedding-provider.service.ts` | Resolves provider; calls `/embeddings`; returns `Float32Array[]` |
| **Create** | `apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts` | Unit tests (mocked `AiConfigurationService` + `fetch`) |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts` | Cosine similarity on real embeddings; skill/query cache |
| **Create** | `apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts` | Unit tests (mocked provider) |
| **Modify** | `apps/api/src/ai-config/ai-config.module.ts` | Register new providers + controller |
| **Create** | `apps/api/src/ai-config/database/entities/skill-search-config.entity.ts` | Singleton TypeORM entity for pipeline config |
| **Modify** | `apps/api/src/database/database.module.ts` | Register `SkillSearchConfig` entity |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-search-config.service.ts` | Sync-cached config (seeded `OnModuleInit`) |
| **Create** | `apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts` | Unit tests |
| **Create** | `packages/core/src/schemas/ai-config/skill-search-config.schemas.ts` | Zod schemas + types for admin API |
| **Create** | `apps/api/src/ai-config/controllers/skill-search-config.controller.ts` | `GET`/`PATCH` `/api/ai-config/skill-search-config` |
| **Modify** | `packages/core/src/index.ts` | Re-export new schemas |

---

## Task 1: Fix offset in SkillSearchParams and Pipeline

**Files:**
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts`
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts`
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`

- [ ] **Step 1.1: Write the failing test**

Add inside `describe('SkillSearchPipelineService', ...)` in `skill-search-pipeline.service.spec.ts`:

```typescript
    it('applies offset before limit, returning the correct page', () => {
      const fullResults = pipeline.search({ query: 'tool' });
      const page0 = pipeline.search({ query: 'tool', limit: 1, offset: 0 });
      const page1 = pipeline.search({ query: 'tool', limit: 1, offset: 1 });
      expect(page0[0].skill.name).toBe(fullResults[0].skill.name);
      expect(page1[0].skill.name).toBe(fullResults[1].skill.name);
    });
```

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: FAIL — `offset` is unknown on `SkillSearchParams`.

- [ ] **Step 1.2: Add `offset` to `SkillSearchParams`**

In `skill-search-strategy.interface.ts`, add to `SkillSearchParams`:

```typescript
export interface SkillSearchParams {
  query?: string;
  category?: string;
  tags?: string[];
  includeScores?: boolean;
  minScore?: number;
  limit?: number;
  offset?: number;   // ← add
}
```

- [ ] **Step 1.3: Apply offset in the pipeline**

In `skill-search-pipeline.service.ts`, replace lines 55–57:

```typescript
    // BEFORE:
    if (params.limit !== undefined) {
      results = results.slice(0, params.limit);
    }

    // AFTER:
    const offset = params.offset ?? 0;
    results = results.slice(
      offset,
      params.limit !== undefined ? offset + params.limit : undefined,
    );
```

- [ ] **Step 1.4: Run test — must pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: PASS (all tests green including new offset test).

- [ ] **Step 1.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts
git commit -m "fix(skill-search): apply offset parameter in pipeline slice"
```

---

## Task 2: Align Wire Schema with SkillSearchParams

**Files:**
- Modify: `packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts`
- Modify: `apps/api/src/workflow/workflow-internal-tools/tools/skill/search-skills.tool.ts`

- [ ] **Step 2.1: Extend `searchSkillsSchema`**

Find `searchSkillsSchema` (lines 201–207) and replace:

```typescript
export const searchSkillsSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  includeScores: z.boolean().optional(),
  minScore: z.number().min(0).max(1).optional(),
});
```

- [ ] **Step 2.2: Update `SearchSkillsTool` body mapping and response**

Replace the full file `apps/api/src/workflow/workflow-internal-tools/tools/skill/search-skills.tool.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { SearchSkillsInput, searchSkillsSchema } from '@nexus/core';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { AgentSkillsService } from '../../../../ai-config/services/agent-skills.service';

@Injectable()
export class SearchSkillsTool implements IInternalToolHandler<SearchSkillsInput> {
  constructor(private readonly skills: AgentSkillsService) {}

  getName(): string {
    return 'search_skills';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      name: this.getName(),
      tierRestriction: 1,
      transport: 'api_callback',
      runtimeOwner: 'api',
      policyTags: ['read_only', 'context', 'skills'],
      description: 'Search active skills by query, category, and tags.',
      apiCallback: {
        method: 'POST',
        pathTemplate: '/api/workflow-runtime/skills/search',
        bodyMapping: {
          workflow_run_id: 'workflow_run_id',
          job_id: 'job_id',
          query: 'query',
          category: 'category',
          tags: 'tags',
          limit: 'limit',
          offset: 'offset',
          includeScores: 'includeScores',
          minScore: 'minScore',
        },
      },
      inputSchema: searchSkillsSchema,
    };
  }

  async execute(
    _context: InternalToolExecutionContext,
    params: SearchSkillsInput,
  ) {
    const skills = await this.skills.searchSkills(params);

    const results = skills.map((skill) => {
      const base = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
      };

      if (params.includeScores) {
        const s = skill as typeof skill & { _score?: number; _matchDetails?: unknown };
        return { ...base, _score: s._score, _matchDetails: s._matchDetails };
      }

      return base;
    });

    return { results };
  }
}
```

- [ ] **Step 2.3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 2.4: Commit**

```bash
git add packages/core/src/schemas/workflow-runtime/workflow-runtime-inputs.schemas.ts \
        apps/api/src/workflow/workflow-internal-tools/tools/skill/search-skills.tool.ts
git commit -m "feat(skill-search): expose includeScores and minScore in wire schema and search tool"
```

---

## Task 3: Add ModelCapability to LlmModel

**Files:**
- Modify: `packages/core/src/schemas/ai-config/models.schema.ts`
- Modify: `packages/core/src/schemas/ai-config/models.types.ts`
- Modify: `apps/api/src/ai-config/database/entities/llm-model.entity.ts`

`ModelCapability` is a string-backed Zod enum — adding new values later (e.g. `'reranking'`) only requires extending the enum; no DB migration needed since the column is a plain varchar.

The `capability` column defaults to `'completions'` at the DB level, so all existing rows are unaffected by the migration.

- [ ] **Step 3.1: Add `ModelCapabilitySchema` and `capability` to the core schemas**

In `packages/core/src/schemas/ai-config/models.schema.ts`, replace the full file:

```typescript
import { z } from 'zod';

export const ModelCapabilitySchema = z.enum(['completions', 'embeddings', 'reranking']);

export const CreateModelSchema = z.object({
  name: z.string().min(1),
  provider_name: z.string().optional(),
  token_limit: z.number().int().min(1).optional(),
  input_token_cents_per_million: z.number().int().min(0).nullable().optional(),
  output_token_cents_per_million: z.number().int().min(0).nullable().optional(),
  default_for_execution: z.boolean().optional(),
  default_for_distillation: z.boolean().optional(),
  default_for_summarization: z.boolean().optional(),
  default_for_session: z.boolean().optional(),
  is_active: z.boolean().optional(),
  capability: ModelCapabilitySchema.optional(),
});

export const UpdateModelSchema = CreateModelSchema.partial();

export * from './models.types';
```

- [ ] **Step 3.2: Export `ModelCapability` type**

In `packages/core/src/schemas/ai-config/models.types.ts`, add:

```typescript
import { CreateModelSchema, ModelCapabilitySchema, UpdateModelSchema } from './models.schema';

export type CreateModelRequest = z.infer<typeof CreateModelSchema>;
export type UpdateModelRequest = z.infer<typeof UpdateModelSchema>;
export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
```

Export from `packages/core/src/index.ts` (find the ai-config block and add):

```typescript
export { ModelCapabilitySchema, type ModelCapability } from './schemas/ai-config/models.schema';
```

- [ ] **Step 3.3: Write the failing test for the entity column**

Add a test in `apps/api/src/ai-config/controllers/models.controller.spec.ts` (or create a small standalone spec):

```typescript
// In the existing models controller spec, inside describe('createModel'):
    it('forwards capability field when provided', async () => {
      mockAdminService.createModel.mockResolvedValue({ id: '1', name: 'embed-model', capability: 'embeddings' });
      const result = await controller.createModel({ name: 'embed-model', capability: 'embeddings' });
      expect(mockAdminService.createModel).toHaveBeenCalledWith(
        expect.objectContaining({ capability: 'embeddings' }),
      );
    });
```

Run: `npx vitest run apps/api/src/ai-config/controllers/models.controller.spec.ts`
Expected: FAIL — `capability` not in schema yet (TypeScript error) OR test fails because `createModel` mock assertion fails.

- [ ] **Step 3.4: Add `capability` column to `LlmModel` entity**

In `apps/api/src/ai-config/database/entities/llm-model.entity.ts`, add the column after `supports_vision`:

```typescript
  @Column({ type: 'varchar', length: 32, default: 'completions' })
  capability: string; // ModelCapability — stored as varchar for forward compatibility
```

- [ ] **Step 3.5: Run the test — must pass**

Run: `npx vitest run apps/api/src/ai-config/controllers/models.controller.spec.ts`
Expected: PASS.

- [ ] **Step 3.6: Run the full ai-config test suite to check for regressions**

Run: `npx vitest run apps/api/src/ai-config/`
Expected: All tests green. Existing model tests unaffected (`capability` defaults to `'completions'`).

- [ ] **Step 3.7: Commit**

```bash
git add packages/core/src/schemas/ai-config/models.schema.ts \
        packages/core/src/schemas/ai-config/models.types.ts \
        packages/core/src/index.ts \
        apps/api/src/ai-config/database/entities/llm-model.entity.ts \
        apps/api/src/ai-config/controllers/models.controller.spec.ts
git commit -m "feat(models): add ModelCapability enum (completions|embeddings|reranking) to LlmModel"
```

---

## Task 4: Make Strategy Interface Async

**Files:**
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-strategy.interface.ts`
- Modify: three strategy `.ts` files (token, fuzzy, tfidf)
- Modify: three strategy `.spec.ts` files
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts`
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
- Modify: `apps/api/src/ai-config/services/agent-skills.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-skills.service.spec.ts`

The embedding strategy requires async HTTP calls. Rather than a mixed sync/async interface, make `search()` return `Promise<ScoredSkillResult[]>` uniformly. Existing strategies use `async`/`return` — TypeScript compiles sync logic to resolved promises with zero overhead.

- [ ] **Step 4.1: Update the interface**

In `skill-search-strategy.interface.ts`, change `ISkillSearchStrategy`:

```typescript
export interface ISkillSearchStrategy {
  readonly name: string;
  search(query: string, skills: SkillLibraryRecord[]): Promise<ScoredSkillResult[]>;
}
```

- [ ] **Step 4.2: Make TokenMatchStrategy async**

In `token-match.strategy.ts`, add `async` to `search()` and prefix the return:

```typescript
  async search(query: string, skills: SkillLibraryRecord[]): Promise<ScoredSkillResult[]> {
    const tokens = tokenize(query);
    if (!tokens.length || !skills.length) return [];
    // ... rest unchanged
  }
```

- [ ] **Step 4.3: Make FuzzyMatchStrategy async**

Same change in `fuzzy-match.strategy.ts` — add `async` and `Promise<ScoredSkillResult[]>` to signature only. Body unchanged.

- [ ] **Step 4.4: Make TfIdfMatchStrategy async**

Same change in `tfidf-match.strategy.ts`.

- [ ] **Step 4.5: Make the pipeline `search()` async**

In `skill-search-pipeline.service.ts`, update the `search()` method signature and `await` each strategy:

```typescript
  async search(params: SkillSearchParams, fallbackSkills?: SkillLibraryRecord[]): Promise<ScoredSkillResult[]> {
    // ... setup unchanged ...

    const resultMap = new Map<string, ScoredSkillResult>();
    for (const strategy of [this.tokenMatch, this.fuzzyMatch, this.tfIdf]) {
      for (const result of await strategy.search(query, candidates)) {  // ← await
        const existing = resultMap.get(result.skill.name);
        if (!existing || result.score > existing.score) {
          resultMap.set(result.skill.name, result);
        }
      }
    }
    // ... rest unchanged ...
  }
```

- [ ] **Step 4.6: Make `AgentSkillsService.searchSkills()` async**

In `agent-skills.service.ts`, update `searchSkills()`:

```typescript
  async searchSkills(params: SkillSearchParams): Promise<SkillLibraryRecord[]> {
    const allSkills = this.skillLibrary.listSkills({ includeInactive: false });
    const scored = await this.pipeline.search(params, allSkills);  // ← await

    if (params.includeScores) {
      return scored.map(({ skill, score, matchDetails }) =>
        Object.assign(skill, { _score: score, _matchDetails: matchDetails }),
      );
    }

    return scored.map(({ skill }) => skill);
  }
```

- [ ] **Step 4.7: Update spec files — add `await` to all `search()` calls**

In each spec file, find calls of the form `strategy.search(...)` or `pipeline.search(...)` or `service.searchSkills(...)` and prefix with `await`. Each `it(...)` block must be `async`:

```typescript
// BEFORE:
it('returns empty for empty query', () => {
  expect(strategy.search('', [makeSkill()])).toEqual([]);
});

// AFTER:
it('returns empty for empty query', async () => {
  expect(await strategy.search('', [makeSkill()])).toEqual([]);
});
```

Apply this pattern to:
- `token-match.strategy.spec.ts` — all `strategy.search(...)` calls
- `fuzzy-match.strategy.spec.ts` — all `strategy.search(...)` calls
- `tfidf-match.strategy.spec.ts` — all `strategy.search(...)` calls
- `skill-search-pipeline.service.spec.ts` — all `pipeline.search(...)` calls
- `agent-skills.service.spec.ts` — all `service.searchSkills(...)` calls

- [ ] **Step 4.8: Run the full skill-search test suite — must pass**

Run: `npx vitest run apps/api/src/ai-config/`
Expected: All tests green.

- [ ] **Step 4.9: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/ \
        apps/api/src/ai-config/services/agent-skills.service.ts \
        apps/api/src/ai-config/services/agent-skills.service.spec.ts
git commit -m "refactor(skill-search): make ISkillSearchStrategy.search() async throughout the call chain"
```

---

## Task 5: EmbeddingProviderService

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/embedding-provider.service.ts`
- Create: `apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts`

Resolves provider config via `AiConfigurationService`, sends a batched `POST /embeddings` request (OpenAI-compatible format), returns `Float32Array[]`. Any error (provider missing, HTTP failure) throws — callers are responsible for graceful degradation.

- [ ] **Step 5.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingProviderService } from './embedding-provider.service';

const mockResolve = vi.fn();
const mockAiConfig = { resolveRunnerProviderConfig: mockResolve };

function mockFetch(embedding: number[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ embedding }],
    }),
  });
}

describe('EmbeddingProviderService', () => {
  let service: EmbeddingProviderService;

  beforeEach(() => {
    service = new EmbeddingProviderService(mockAiConfig as any);
    mockResolve.mockReset();
  });

  it('calls the embeddings endpoint with the correct payload', async () => {
    mockResolve.mockResolvedValue({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    });
    const fetchMock = mockFetch([0.1, 0.2, 0.3]);
    vi.stubGlobal('fetch', fetchMock);

    await service.embed(['hello world'], 'my-openai-provider', 'text-embedding-3-small');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ input: ['hello world'], model: 'text-embedding-3-small' }),
      }),
    );

    vi.unstubAllGlobals();
  });

  it('returns Float32Array[] matching the number of input texts', async () => {
    mockResolve.mockResolvedValue({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const results = await service.embed(['text a', 'text b'], 'provider', 'model');
    expect(results).toHaveLength(2);
    expect(results[0]).toBeInstanceOf(Float32Array);
    expect(Array.from(results[0])).toEqual([0.1, 0.2]);
    expect(Array.from(results[1])).toEqual([0.3, 0.4]);

    vi.unstubAllGlobals();
  });

  it('uses https://api.openai.com/v1 as default base URL when provider has none', async () => {
    mockResolve.mockResolvedValue({ apiKey: 'sk-test' }); // no baseUrl
    const fetchMock = mockFetch([0.5]);
    vi.stubGlobal('fetch', fetchMock);

    await service.embed(['hi'], 'provider', 'model');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/embeddings');

    vi.unstubAllGlobals();
  });

  it('throws when the HTTP response is not ok', async () => {
    mockResolve.mockResolvedValue({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' }));

    await expect(service.embed(['hi'], 'provider', 'model')).rejects.toThrow('401');

    vi.unstubAllGlobals();
  });

  it('throws when provider resolution fails', async () => {
    mockResolve.mockRejectedValue(new Error('Provider not found'));
    vi.stubGlobal('fetch', vi.fn());

    await expect(service.embed(['hi'], 'provider', 'model')).rejects.toThrow('Provider not found');

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 5.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement EmbeddingProviderService**

```typescript
// apps/api/src/ai-config/services/skill-search/embedding-provider.service.ts
import { Injectable } from '@nestjs/common';
import { AiConfigurationService } from '../../ai-configuration.service';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

@Injectable()
export class EmbeddingProviderService {
  constructor(private readonly aiConfig: AiConfigurationService) {}

  async embed(texts: string[], providerName: string, modelName: string): Promise<Float32Array[]> {
    const config = await this.aiConfig.resolveRunnerProviderConfig({
      providerName,
      modelName,
    });

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const apiKey = config.apiKey;

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: texts, model: modelName }),
    });

    if (!response.ok) {
      throw new Error(
        `Embedding API error ${response.status}: ${response.statusText}`,
      );
    }

    const body = (await response.json()) as { data: Array<{ embedding: number[] }> };
    return body.data.map((item) => new Float32Array(item.embedding));
  }
}
```

- [ ] **Step 5.4: Run tests — must pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts`
Expected: PASS (all 5 tests green).

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/embedding-provider.service.ts \
        apps/api/src/ai-config/services/skill-search/embedding-provider.service.spec.ts
git commit -m "feat(skill-search): add EmbeddingProviderService for OpenAI-compatible embeddings API"
```

---

## Task 6: Implement EmbeddingMatchStrategy

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts`
- Create: `apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts`

Enabled by `NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED=true`. Provider and model resolved from env vars (`NEXUS_SKILL_SEARCH_EMBEDDING_PROVIDER`, `NEXUS_SKILL_SEARCH_EMBEDDING_MODEL`) — W6 DB config overrides these later. Caches skill embeddings by `${name}:${version}` so re-indexing recomputes stale entries; caches query embeddings by query string (last 100 queries). Returns `[]` on any error so other strategies always run.

- [ ] **Step 6.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingMatchStrategy } from './embedding-match.strategy';
import type { EmbeddingProviderService } from '../embedding-provider.service';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';

function makeSkill(overrides: Partial<SkillLibraryRecord> = {}): SkillLibraryRecord {
  return {
    id: 'id',
    name: 'my-skill',
    description: 'A useful skill',
    skillMarkdown: '',
    compatibility: null,
    category: null,
    tags: [],
    metadata: null,
    isActive: true,
    version: 1,
    source: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    rootPath: '/tmp',
    ...overrides,
  };
}

// Two orthogonal unit vectors — cosine similarity = 0
const vecA = new Float32Array([1, 0]);
const vecB = new Float32Array([0, 1]);
// Two identical vectors — cosine similarity = 1
const vecC = new Float32Array([1, 0]);

describe('EmbeddingMatchStrategy', () => {
  let strategy: EmbeddingMatchStrategy;
  let mockProvider: { embed: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED = 'true';
    process.env.NEXUS_SKILL_SEARCH_EMBEDDING_PROVIDER = 'test-provider';
    process.env.NEXUS_SKILL_SEARCH_EMBEDDING_MODEL = 'test-model';
    mockProvider = { embed: vi.fn() };
    strategy = new EmbeddingMatchStrategy(mockProvider as unknown as EmbeddingProviderService);
  });

  afterEach(() => {
    delete process.env.NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED;
    delete process.env.NEXUS_SKILL_SEARCH_EMBEDDING_PROVIDER;
    delete process.env.NEXUS_SKILL_SEARCH_EMBEDDING_MODEL;
  });

  it('has name "embedding"', () => {
    expect(strategy.name).toBe('embedding');
  });

  it('returns [] when NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED is not set', async () => {
    delete process.env.NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED;
    const results = await strategy.search('query', [makeSkill()]);
    expect(results).toEqual([]);
    expect(mockProvider.embed).not.toHaveBeenCalled();
  });

  it('returns [] for empty query', async () => {
    const results = await strategy.search('', [makeSkill()]);
    expect(results).toEqual([]);
  });

  it('returns [] for empty skills list', async () => {
    const results = await strategy.search('query', []);
    expect(results).toEqual([]);
  });

  it('returns [] and does not throw when embed() rejects', async () => {
    mockProvider.embed.mockRejectedValue(new Error('API down'));
    const results = await strategy.search('query', [makeSkill()]);
    expect(results).toEqual([]);
  });

  it('scores skills by cosine similarity between query and skill embeddings', async () => {
    const skillA = makeSkill({ name: 'skill-a', version: 1 });
    const skillB = makeSkill({ name: 'skill-b', version: 1 });

    // First call: embed query + skill-a + skill-b (3 texts)
    mockProvider.embed
      .mockResolvedValueOnce([vecC]) // query embedding = [1, 0]
      .mockResolvedValueOnce([vecA, vecB]); // skill-a=[1,0], skill-b=[0,1]

    const results = await strategy.search('query', [skillA, skillB]);

    expect(results).toHaveLength(1); // only skill-a has non-zero cosine similarity
    expect(results[0].skill.name).toBe('skill-a');
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it('uses cached skill embeddings on second search (no re-embed)', async () => {
    const skill = makeSkill({ name: 'cached-skill', version: 1 });
    mockProvider.embed
      .mockResolvedValueOnce([vecA]) // query
      .mockResolvedValueOnce([vecA]); // skill (first search)

    await strategy.search('first query', [skill]);
    await strategy.search('second query', [skill]); // skill cached — only query is re-embedded

    // embed() called twice: once with skill + query combined (1st search), once query-only (2nd search)
    expect(mockProvider.embed).toHaveBeenCalledTimes(2);
  });

  it('re-embeds a skill when its version changes', async () => {
    const v1 = makeSkill({ name: 'versioned', version: 1 });
    const v2 = makeSkill({ name: 'versioned', version: 2 });

    mockProvider.embed
      .mockResolvedValue([vecA]); // all calls return same vector for simplicity

    await strategy.search('query', [v1]);
    await strategy.search('query', [v2]); // version changed — skill must be re-embedded

    // Skill embedded twice: once per version
    const allCalls = mockProvider.embed.mock.calls;
    const skillEmbedCalls = allCalls.filter((call) => (call[0] as string[]).some((t) => t.includes('versioned')));
    expect(skillEmbedCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('returns results sorted by score descending', async () => {
    const skills = [
      makeSkill({ name: 'low', version: 1 }),
      makeSkill({ name: 'high', version: 1 }),
    ];
    // query = [1, 0]; high skill = [1, 0] (similarity 1.0); low skill = [0.6, 0.8] (similarity 0.6)
    const highVec = new Float32Array([1, 0]);
    const lowVec = new Float32Array([0.6, 0.8]);
    mockProvider.embed
      .mockResolvedValueOnce([new Float32Array([1, 0])]) // query
      .mockResolvedValueOnce([lowVec, highVec]); // skills in order

    const results = await strategy.search('query', skills);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
  });
});
```

- [ ] **Step 6.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement EmbeddingMatchStrategy**

```typescript
// apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts
import { Injectable, Optional } from '@nestjs/common';
import type { SkillLibraryRecord } from '../../agent-skill-library.service.types';
import { ISkillSearchStrategy, ScoredSkillResult, tokenize } from '../skill-search-strategy.interface';
import { EmbeddingProviderService } from '../embedding-provider.service';

const MAX_QUERY_CACHE = 100;

@Injectable()
export class EmbeddingMatchStrategy implements ISkillSearchStrategy {
  readonly name = 'embedding';

  private readonly skillEmbeddings = new Map<string, Float32Array>();
  private readonly queryEmbeddings = new Map<string, Float32Array>();

  constructor(
    @Optional() private readonly provider?: EmbeddingProviderService,
  ) {}

  async search(query: string, skills: SkillLibraryRecord[]): Promise<ScoredSkillResult[]> {
    if (!this.isEnabled() || !this.provider || !query.trim() || !skills.length) {
      return [];
    }

    try {
      const [queryEmbedding, skillEmbeddings] = await Promise.all([
        this.getQueryEmbedding(query),
        this.getSkillEmbeddings(skills),
      ]);

      return skills
        .map((skill) => {
          const vec = skillEmbeddings.get(this.skillKey(skill));
          if (!vec) return null;
          const score = cosineSimilarity(queryEmbedding, vec);
          return score > 0
            ? { skill, score, matchDetails: { strategy: this.name, matchedFields: ['semantic'] } }
            : null;
        })
        .filter((r): r is ScoredSkillResult => r !== null)
        .sort((a, b) => b.score - a.score);
    } catch {
      return [];
    }
  }

  clearCache(): void {
    this.skillEmbeddings.clear();
    this.queryEmbeddings.clear();
  }

  private isEnabled(): boolean {
    return process.env.NEXUS_SKILL_SEARCH_EMBEDDINGS_ENABLED === 'true';
  }

  private providerName(): string {
    return process.env.NEXUS_SKILL_SEARCH_EMBEDDING_PROVIDER ?? 'openai';
  }

  private modelName(): string {
    return process.env.NEXUS_SKILL_SEARCH_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  }

  private skillKey(skill: SkillLibraryRecord): string {
    return `${skill.name}:${skill.version}`;
  }

  private buildDocText(skill: SkillLibraryRecord): string {
    return [
      skill.name,
      skill.description,
      ...(skill.tags ?? []),
      skill.category ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  private async getQueryEmbedding(query: string): Promise<Float32Array> {
    const cached = this.queryEmbeddings.get(query);
    if (cached) return cached;

    const [embedding] = await this.provider!.embed([query], this.providerName(), this.modelName());

    if (this.queryEmbeddings.size >= MAX_QUERY_CACHE) {
      const firstKey = this.queryEmbeddings.keys().next().value;
      if (firstKey !== undefined) this.queryEmbeddings.delete(firstKey);
    }

    this.queryEmbeddings.set(query, embedding);
    return embedding;
  }

  private async getSkillEmbeddings(
    skills: SkillLibraryRecord[],
  ): Promise<Map<string, Float32Array>> {
    const uncached = skills.filter((s) => !this.skillEmbeddings.has(this.skillKey(s)));

    if (uncached.length > 0) {
      const texts = uncached.map((s) => this.buildDocText(s));
      const vectors = await this.provider!.embed(texts, this.providerName(), this.modelName());
      uncached.forEach((skill, i) => {
        this.skillEmbeddings.set(this.skillKey(skill), vectors[i]);
      });
    }

    return this.skillEmbeddings;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}
```

- [ ] **Step 6.4: Run tests — must pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts`
Expected: PASS (all tests green).

- [ ] **Step 6.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts \
        apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.spec.ts
git commit -m "feat(skill-search): add EmbeddingMatchStrategy with cosine similarity and skill/query caching"
```

---

## Task 7: Register EmbeddingProviderService + EmbeddingMatchStrategy

**Files:**
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts`
- Modify: `apps/api/src/ai-config/services/agent-skill-library.service.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts`

- [ ] **Step 7.1: Add EmbeddingMatchStrategy to the pipeline**

In `skill-search-pipeline.service.ts`, add imports and constructor parameter:

```typescript
import { EmbeddingMatchStrategy } from './strategies/embedding-match.strategy';

// Add to constructor:
    private readonly embeddingMatch: EmbeddingMatchStrategy,
```

Update the strategy loop to include embedding:

```typescript
    for (const strategy of [this.tokenMatch, this.fuzzyMatch, this.tfIdf, this.embeddingMatch]) {
      for (const result of await strategy.search(query, candidates)) {
```

- [ ] **Step 7.2: Clear embedding cache on skill invalidation**

`AgentSkillLibraryService` already calls `this.skillIndex.invalidateAll()` after writes. Inject `EmbeddingMatchStrategy` as `@Optional()` and call `clearCache()` in the same places:

In `agent-skill-library.service.ts`, update the constructor:

```typescript
import { EmbeddingMatchStrategy } from './skill-search/strategies/embedding-match.strategy';

// Add to constructor:
    @Optional() private readonly embeddingStrategy?: EmbeddingMatchStrategy,
```

After every existing `this.skillIndex.invalidateAll()` call, add:

```typescript
this.embeddingStrategy?.clearCache();
```

- [ ] **Step 7.3: Register in ai-config.module.ts**

Add imports:

```typescript
import { EmbeddingProviderService } from './services/skill-search/embedding-provider.service';
import { EmbeddingMatchStrategy } from './services/skill-search/strategies/embedding-match.strategy';
```

Add to `providers` array (after `TfIdfMatchStrategy`):

```typescript
    EmbeddingProviderService,
    EmbeddingMatchStrategy,
```

- [ ] **Step 7.4: Update pipeline spec to inject EmbeddingMatchStrategy**

In `skill-search-pipeline.service.spec.ts`:

```typescript
import { EmbeddingMatchStrategy } from './strategies/embedding-match.strategy';

// In beforeEach:
    pipeline = new SkillSearchPipelineService(
      index,
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
      new EmbeddingMatchStrategy(), // no provider injected — strategy returns [] silently
    );
```

- [ ] **Step 7.5: Run full ai-config test suite — must pass**

Run: `npx vitest run apps/api/src/ai-config/`
Expected: All tests green (embedding returns `[]` without provider/env var set — no interference).

- [ ] **Step 7.6: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts \
        apps/api/src/ai-config/services/agent-skill-library.service.ts \
        apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(skill-search): wire EmbeddingProviderService and EmbeddingMatchStrategy into pipeline"
```

---

## Task 8: Create SkillSearchConfig Entity (W6)

**Files:**
- Create: `apps/api/src/ai-config/database/entities/skill-search-config.entity.ts`
- Modify: `apps/api/src/database/database.module.ts`

Singleton row (`id = 'singleton'`). Includes embedding provider/model name overrides so admins can change the embedding backend without redeploying env vars.

- [ ] **Step 8.1: Create the entity**

```typescript
// apps/api/src/ai-config/database/entities/skill-search-config.entity.ts
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('skill_search_config')
export class SkillSearchConfig {
  @PrimaryColumn({ type: 'varchar', length: 16 })
  id: string; // Always 'singleton'

  @Column({ type: 'simple-array', default: 'token-match,fuzzy-match,tfidf,embedding' })
  enabled_strategies: string[];

  @Column({ type: 'float', default: 0.0 })
  min_score_default: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  embedding_provider_name: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  embedding_model_name: string | null;

  @UpdateDateColumn()
  updated_at: Date;
}
```

- [ ] **Step 8.2: Register entity in database.module.ts**

Add import after the last `ai-config` entity import (~line 47):

```typescript
import { SkillSearchConfig } from '../ai-config/database/entities/skill-search-config.entity';
```

Add to the `entities` array after `AgentProfileSkill`:

```typescript
    SkillSearchConfig,
```

- [ ] **Step 8.3: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 8.4: Commit**

```bash
git add apps/api/src/ai-config/database/entities/skill-search-config.entity.ts \
        apps/api/src/database/database.module.ts
git commit -m "feat(skill-search): add SkillSearchConfig TypeORM entity for W6 pipeline configuration"
```

---

## Task 9: Implement SkillSearchConfigService (W6)

**Files:**
- Create: `apps/api/src/ai-config/services/skill-search/skill-search-config.service.ts`
- Create: `apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts`

Sync-readable via `getConfigSync()` — the pipeline calls this without `await` so `search()` stays a clean async boundary around I/O, not config reads. Cache is seeded on `OnModuleInit`; `updateConfig()` updates DB and cache atomically.

- [ ] **Step 9.1: Write the failing tests**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Repository } from 'typeorm';
import { SkillSearchConfigService } from './skill-search-config.service';
import type { SkillSearchConfig as Entity } from '../../database/entities/skill-search-config.entity';

function makeRepo(row: Partial<Entity> | null = null) {
  return {
    findOne: vi.fn().mockResolvedValue(row),
    create: vi.fn((data) => ({ ...data })),
    save: vi.fn(async (e) => e),
  } as unknown as Repository<Entity>;
}

describe('SkillSearchConfigService', () => {
  it('getConfigSync() returns defaults when no DB row exists', async () => {
    const svc = new SkillSearchConfigService(makeRepo(null));
    await svc.onModuleInit();
    const c = svc.getConfigSync();
    expect(c.enabledStrategies).toContain('token-match');
    expect(c.enabledStrategies).toContain('embedding');
    expect(c.minScoreDefault).toBe(0.0);
    expect(c.embeddingProviderName).toBeNull();
    expect(c.embeddingModelName).toBeNull();
  });

  it('getConfigSync() returns DB values when a row exists', async () => {
    const row = {
      id: 'singleton',
      enabled_strategies: ['token-match'],
      min_score_default: 0.2,
      embedding_provider_name: 'my-openai',
      embedding_model_name: 'text-embedding-3-large',
      updated_at: new Date(),
    };
    const svc = new SkillSearchConfigService(makeRepo(row));
    await svc.onModuleInit();
    const c = svc.getConfigSync();
    expect(c.enabledStrategies).toEqual(['token-match']);
    expect(c.minScoreDefault).toBe(0.2);
    expect(c.embeddingProviderName).toBe('my-openai');
    expect(c.embeddingModelName).toBe('text-embedding-3-large');
  });

  it('updateConfig() persists to DB and updates cache immediately', async () => {
    const repo = makeRepo(null);
    const svc = new SkillSearchConfigService(repo);
    await svc.onModuleInit();
    await svc.updateConfig({ minScoreDefault: 0.5, embeddingProviderName: 'acme-ai' });
    expect(svc.getConfigSync().minScoreDefault).toBe(0.5);
    expect(svc.getConfigSync().embeddingProviderName).toBe('acme-ai');
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('invalidateCache() reverts getConfigSync() to defaults', async () => {
    const row = { id: 'singleton', enabled_strategies: ['token-match'], min_score_default: 0.9, embedding_provider_name: null, embedding_model_name: null, updated_at: new Date() };
    const svc = new SkillSearchConfigService(makeRepo(row));
    await svc.onModuleInit();
    svc.invalidateCache();
    expect(svc.getConfigSync().minScoreDefault).toBe(0.0);
    expect(svc.getConfigSync().enabledStrategies).toContain('fuzzy-match');
  });
});
```

- [ ] **Step 9.2: Run tests to confirm they fail**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement SkillSearchConfigService**

```typescript
// apps/api/src/ai-config/services/skill-search/skill-search-config.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkillSearchConfig as SkillSearchConfigEntity } from '../../database/entities/skill-search-config.entity';

export interface SkillSearchRuntimeConfig {
  enabledStrategies: string[];
  minScoreDefault: number;
  embeddingProviderName: string | null;
  embeddingModelName: string | null;
}

const DEFAULTS: SkillSearchRuntimeConfig = {
  enabledStrategies: ['token-match', 'fuzzy-match', 'tfidf', 'embedding'],
  minScoreDefault: 0.0,
  embeddingProviderName: null,
  embeddingModelName: null,
};

@Injectable()
export class SkillSearchConfigService implements OnModuleInit {
  private cachedConfig: SkillSearchRuntimeConfig = { ...DEFAULTS };

  constructor(
    @InjectRepository(SkillSearchConfigEntity)
    private readonly repo: Repository<SkillSearchConfigEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const row = await this.repo.findOne({ where: { id: 'singleton' } });
      if (row) this.cachedConfig = this.toRuntime(row);
    } catch {
      // DB unavailable at startup — keep defaults
    }
  }

  getConfigSync(): SkillSearchRuntimeConfig {
    return this.cachedConfig;
  }

  async updateConfig(updates: Partial<SkillSearchRuntimeConfig>): Promise<SkillSearchRuntimeConfig> {
    const existing = await this.repo.findOne({ where: { id: 'singleton' } });
    const entity = existing ?? this.repo.create({ id: 'singleton' });

    if (updates.enabledStrategies !== undefined) entity.enabled_strategies = updates.enabledStrategies;
    if (updates.minScoreDefault !== undefined) entity.min_score_default = updates.minScoreDefault;
    if ('embeddingProviderName' in updates) entity.embedding_provider_name = updates.embeddingProviderName ?? null;
    if ('embeddingModelName' in updates) entity.embedding_model_name = updates.embeddingModelName ?? null;

    const saved = await this.repo.save(entity);
    this.cachedConfig = this.toRuntime(saved);
    return this.cachedConfig;
  }

  invalidateCache(): void {
    this.cachedConfig = { ...DEFAULTS };
  }

  private toRuntime(row: SkillSearchConfigEntity): SkillSearchRuntimeConfig {
    return {
      enabledStrategies: row.enabled_strategies,
      minScoreDefault: row.min_score_default,
      embeddingProviderName: row.embedding_provider_name,
      embeddingModelName: row.embedding_model_name,
    };
  }
}
```

- [ ] **Step 9.4: Run tests — must pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts`
Expected: PASS (all 4 tests green).

- [ ] **Step 9.5: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-config.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-config.service.spec.ts
git commit -m "feat(skill-search): add SkillSearchConfigService with sync cache and embedding provider fields"
```

---

## Task 10: Admin API + Core Schemas (W6)

**Files:**
- Create: `packages/core/src/schemas/ai-config/skill-search-config.schemas.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/api/src/ai-config/controllers/skill-search-config.controller.ts`

- [ ] **Step 10.1: Create core schemas**

```typescript
// packages/core/src/schemas/ai-config/skill-search-config.schemas.ts
import { z } from 'zod';

const STRATEGY_NAMES = ['token-match', 'fuzzy-match', 'tfidf', 'embedding'] as const;

export const UpdateSkillSearchConfigSchema = z.object({
  enabledStrategies: z.array(z.enum(STRATEGY_NAMES)).min(1).optional(),
  minScoreDefault: z.number().min(0).max(1).optional(),
  embeddingProviderName: z.string().min(1).nullable().optional(),
  embeddingModelName: z.string().min(1).nullable().optional(),
});

export type UpdateSkillSearchConfigRequest = z.infer<typeof UpdateSkillSearchConfigSchema>;
```

- [ ] **Step 10.2: Export from `@nexus/core`**

In `packages/core/src/index.ts`, add:

```typescript
export {
  UpdateSkillSearchConfigSchema,
  type UpdateSkillSearchConfigRequest,
} from './schemas/ai-config/skill-search-config.schemas';
```

- [ ] **Step 10.3: Create the admin controller**

```typescript
// apps/api/src/ai-config/controllers/skill-search-config.controller.ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UpdateSkillSearchConfigRequest, UpdateSkillSearchConfigSchema } from '@nexus/core';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { SkillSearchConfigService } from '../services/skill-search/skill-search-config.service';

@ApiTags('ai-config-skill-search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai-config/skill-search-config')
export class SkillSearchConfigController {
  constructor(private readonly configService: SkillSearchConfigService) {}

  @Get()
  @Roles('Admin', 'Developer')
  @ApiOperation({ summary: 'Get current skill search pipeline configuration' })
  getConfig() {
    return { success: true, data: this.configService.getConfigSync() };
  }

  @Patch()
  @Roles('Admin')
  @ApiOperation({ summary: 'Update skill search pipeline configuration — takes effect on next search' })
  async updateConfig(
    @ZodBody(UpdateSkillSearchConfigSchema) body: UpdateSkillSearchConfigRequest,
  ) {
    return { success: true, data: await this.configService.updateConfig(body) };
  }
}
```

- [ ] **Step 10.4: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 10.5: Commit**

```bash
git add packages/core/src/schemas/ai-config/skill-search-config.schemas.ts \
        packages/core/src/index.ts \
        apps/api/src/ai-config/controllers/skill-search-config.controller.ts
git commit -m "feat(skill-search): add admin GET/PATCH API for skill search pipeline config"
```

---

## Task 11: Wire Pipeline to Config + Register Everything (W6)

**Files:**
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts`
- Modify: `apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts`
- Modify: `apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
- Modify: `apps/api/src/ai-config/ai-config.module.ts`

The pipeline reads `enabledStrategies` and `minScoreDefault` from `SkillSearchConfigService`. The embedding strategy reads `embeddingProviderName`/`embeddingModelName` from config if set, falling back to env vars.

- [ ] **Step 11.1: Write failing tests for config-driven behaviour**

Add to `skill-search-pipeline.service.spec.ts`:

```typescript
  it('skips a strategy when its name is absent from config.enabledStrategies', async () => {
    const configService = {
      getConfigSync: () => ({
        enabledStrategies: ['token-match'],
        minScoreDefault: 0.0,
      }),
    };
    const restrictedPipeline = new SkillSearchPipelineService(
      new SkillIndexService(),
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
      new EmbeddingMatchStrategy(),
      configService as any,
    );
    restrictedPipeline['index'].build(allSkills);
    const results = await restrictedPipeline.search({ query: 'orchestration' });
    expect(results.length).toBeGreaterThan(0); // token-match still runs
  });

  it('applies config.minScoreDefault when params.minScore is not provided', async () => {
    const configService = {
      getConfigSync: () => ({
        enabledStrategies: ['token-match', 'fuzzy-match', 'tfidf', 'embedding'],
        minScoreDefault: 0.99,
      }),
    };
    const strictPipeline = new SkillSearchPipelineService(
      new SkillIndexService(),
      new TokenMatchStrategy(),
      new FuzzyMatchStrategy(),
      new TfIdfMatchStrategy(),
      new EmbeddingMatchStrategy(),
      configService as any,
    );
    strictPipeline['index'].build(allSkills);
    const results = await strictPipeline.search({ query: 'orchestration' });
    expect(results.every((r) => r.score >= 0.99)).toBe(true);
  });
```

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: FAIL — `SkillSearchPipelineService` constructor does not accept a config service arg yet.

- [ ] **Step 11.2: Update the pipeline to use config**

Replace `skill-search-pipeline.service.ts` with the full version:

```typescript
import { Injectable, Optional } from '@nestjs/common';
import type { SkillLibraryRecord } from '../agent-skill-library.service.types';
import { ScoredSkillResult, SkillSearchParams } from './skill-search-strategy.interface';
import { SkillIndexService } from './skill-index.service';
import { TokenMatchStrategy } from './strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './strategies/tfidf-match.strategy';
import { EmbeddingMatchStrategy } from './strategies/embedding-match.strategy';
import { SkillSearchConfigService } from './skill-search-config.service';

@Injectable()
export class SkillSearchPipelineService {
  constructor(
    private readonly index: SkillIndexService,
    private readonly tokenMatch: TokenMatchStrategy,
    private readonly fuzzyMatch: FuzzyMatchStrategy,
    private readonly tfIdf: TfIdfMatchStrategy,
    private readonly embeddingMatch: EmbeddingMatchStrategy,
    @Optional() private readonly config?: SkillSearchConfigService,
  ) {}

  async search(params: SkillSearchParams, fallbackSkills?: SkillLibraryRecord[]): Promise<ScoredSkillResult[]> {
    if (!this.index.isBuilt() && fallbackSkills) {
      this.index.build(fallbackSkills);
    }

    let candidates = this.index.getAll();
    candidates = this.applyFilters(candidates, params);

    const query = params.query?.trim();
    if (!query) {
      return candidates.map((skill) => ({
        skill,
        score: 1.0,
        matchDetails: { strategy: 'filter', matchedFields: [] },
      }));
    }

    const runtimeConfig = this.config?.getConfigSync();
    const enabledStrategies = runtimeConfig?.enabledStrategies;

    const allStrategies = [this.tokenMatch, this.fuzzyMatch, this.tfIdf, this.embeddingMatch];
    const activeStrategies = enabledStrategies
      ? allStrategies.filter((s) => enabledStrategies.includes(s.name))
      : allStrategies;

    const resultMap = new Map<string, ScoredSkillResult>();
    for (const strategy of activeStrategies) {
      for (const result of await strategy.search(query, candidates)) {
        const existing = resultMap.get(result.skill.name);
        if (!existing || result.score > existing.score) {
          resultMap.set(result.skill.name, result);
        }
      }
    }

    let results = Array.from(resultMap.values()).sort((a, b) => b.score - a.score);

    const minScore = params.minScore ?? runtimeConfig?.minScoreDefault ?? 0;
    if (minScore > 0) {
      results = results.filter((r) => r.score >= minScore);
    }

    const offset = params.offset ?? 0;
    results = results.slice(
      offset,
      params.limit !== undefined ? offset + params.limit : undefined,
    );

    return results;
  }

  private applyFilters(skills: SkillLibraryRecord[], params: SkillSearchParams): SkillLibraryRecord[] {
    let filtered = skills;

    if (params.category) {
      const cat = params.category.trim().toLowerCase();
      filtered = filtered.filter((s) => s.category?.toLowerCase() === cat);
    }

    if (params.tags?.length) {
      const tags = params.tags.map((t) => t.trim().toLowerCase());
      filtered = filtered.filter((s) =>
        tags.every((tag) => (s.tags ?? []).map((t) => t.toLowerCase()).includes(tag)),
      );
    }

    return filtered;
  }
}
```

- [ ] **Step 11.3: Wire embedding strategy to read provider/model from config**

In `embedding-match.strategy.ts`, update the constructor to accept `@Optional() SkillSearchConfigService`:

```typescript
import { SkillSearchConfigService } from '../skill-search-config.service';

  constructor(
    @Optional() private readonly provider?: EmbeddingProviderService,
    @Optional() private readonly configService?: SkillSearchConfigService,
  ) {}
```

Update `providerName()` and `modelName()` to prefer config over env vars:

```typescript
  private providerName(): string {
    return this.configService?.getConfigSync().embeddingProviderName
      ?? process.env.NEXUS_SKILL_SEARCH_EMBEDDING_PROVIDER
      ?? 'openai';
  }

  private modelName(): string {
    return this.configService?.getConfigSync().embeddingModelName
      ?? process.env.NEXUS_SKILL_SEARCH_EMBEDDING_MODEL
      ?? 'text-embedding-3-small';
  }
```

- [ ] **Step 11.4: Register SkillSearchConfigService + controller in ai-config.module.ts**

```typescript
import { TypeOrmModule } from '@nestjs/typeorm';
import { SkillSearchConfig } from './database/entities/skill-search-config.entity';
import { SkillSearchConfigService } from './services/skill-search/skill-search-config.service';
import { SkillSearchConfigController } from './controllers/skill-search-config.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SkillSearchConfig]),
    // ... existing imports
  ],
  controllers: [
    // ... existing controllers,
    SkillSearchConfigController,
  ],
  providers: [
    // ... existing providers,
    SkillSearchConfigService,
  ],
})
```

- [ ] **Step 11.5: Run the full pipeline spec — must pass**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts`
Expected: PASS — all tests including the two new config-driven tests.

- [ ] **Step 11.6: Commit**

```bash
git add apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.ts \
        apps/api/src/ai-config/services/skill-search/skill-search-pipeline.service.spec.ts \
        apps/api/src/ai-config/services/skill-search/strategies/embedding-match.strategy.ts \
        apps/api/src/ai-config/ai-config.module.ts
git commit -m "feat(skill-search): wire pipeline and embedding strategy to SkillSearchConfigService"
```

---

## Task 12: Final Verification

- [ ] **Step 12.1: Run all skill-search specs**

Run: `npx vitest run apps/api/src/ai-config/services/skill-search/`
Expected: All tests green.

- [ ] **Step 12.2: Run full api test suite**

Run: `npx vitest run apps/api/`
Expected: All tests pass, no regressions.

- [ ] **Step 12.3: TypeScript final check**

Run: `npx tsc --noEmit -p apps/api/tsconfig.app.json`
Expected: No errors.

- [ ] **Step 12.4: Push**

```bash
git push
```

---

## Self-Review

| Requirement | Task |
|---|---|
| `offset` applied after sort, before limit | Task 1 |
| `includeScores`/`minScore` in wire schema + surfaced in tool response | Task 2 |
| `ModelCapability` enum on `LlmModel` (completions/embeddings/reranking, extensible) | Task 3 |
| Async strategy interface — all strategies return `Promise<ScoredSkillResult[]>` | Task 4 |
| `EmbeddingProviderService` — OpenAI-compatible, generic `baseUrl` from provider config | Task 5 |
| `EmbeddingMatchStrategy` — cosine similarity, skill cache by `name:version`, query LRU cache | Task 6 |
| Embedding cache cleared on skill write/rename/delete | Task 7 |
| W6 DB config — `SkillSearchConfig` entity with embedding provider/model overrides | Task 8 |
| W6 DB config — `SkillSearchConfigService` with sync cache | Task 9 |
| W6 admin API `GET`/`PATCH` `/api/ai-config/skill-search-config` | Task 10 |
| Pipeline reads enabled strategies + min score + embedding config from DB | Task 11 |
| Field-weight tuning | **Stretch — requires strategy interface change, out of scope** |
