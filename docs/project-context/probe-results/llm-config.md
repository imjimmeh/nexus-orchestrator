---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: llm-config
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/ai-config/ai-configuration.service.ts
  - apps/api/src/ai-config/ai-config-admin.service.ts
  - apps/api/src/ai-config/ai-config.module.ts
  - apps/api/src/ai-config/ai-configuration.service.spec.ts
  - apps/api/src/ai-config/ai-config-admin.service.spec.ts
  - apps/api/src/ai-config/strategies/model-selection/database-model.strategy.ts
  - apps/api/src/ai-config/strategies/model-selection/environment-model.strategy.ts
  - apps/api/src/ai-config/secret-vault.service.ts
  - apps/api/src/ai-config/database/entities/llm-model.entity.ts
  - apps/api/src/ai-config/database/entities/llm-provider.entity.ts
  - apps/api/src/llm/provider-transient-failure.helpers.ts
source_paths:
  - apps/api/src/ai-config
  - apps/api/src/llm
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: AI/Model Configuration

## Narrative Summary

The AI/Model Configuration scope is **fully implemented** with comprehensive capabilities for managing LLM providers, models, agent profiles, and secrets. The `AiConfigModule` provides a global, reusable configuration system with layered model selection (database-first, environment fallback), secret vault encryption (AES-256-GCM), and full CRUD operations via REST controllers with role-based access control.

## Capability Updates

### LLM Provider Management
- **Entity**: `LlmProvider` with `auth_type` (api_key/oauth), `secret_id`, `runtime_env` (JSONB)
- **Repository**: `LlmProviderRepository` with standard CRUD + `findByName`, `findById`, `findAll`
- **Controller**: `ProvidersController` with JWT auth and Admin/Developer role guards
- **CRUD Service**: `ProviderCrudService` extends `BaseCrudService`

### LLM Model Management
- **Entity**: `LlmModel` with token limits, use-case flags (`default_for_execution`, `default_for_distillation`, etc.)
- **Repository**: `LlmModelRepository` with `findByName`, `findById`, `findAll`, `findDefaultForUseCase`
- **Controller**: `ModelsController` with JWT auth and Admin/Developer role guards
- **CRUD Service**: `ModelCrudService` extends `BaseCrudService`

### Model Selection Strategies
- **DatabaseModelStrategy** (priority 1): Checks DB for use-case defaults before environment
- **EnvironmentModelStrategy** (priority 2): Falls back to `MODEL`, `DISTILLATION_MODEL`, `SUMMARIZATION_MODEL` env vars
- **ModelSelectionFactory**: Orchestrates strategies in priority order

### Provider Configuration Resolution
- `AiConfigurationService.resolveRunnerProviderConfig()` handles:
  - API key resolution from secrets or env vars with provider-scoped naming conventions
  - OAuth credential handling with access/refresh token extraction
  - Base URL normalization
  - Provider registration config from runtime environment or secrets

### Secret Vault
- `SecretVaultService` provides AES-256-GCM encryption/decryption
- Uses `SECRET_ENCRYPTION_KEY` config (falls back to `JWT_SECRET` with warning)
- Supports plain JSON fallback when decrypt fails

### Agent Profiles & Skills
- `AgentProfileRepository` with tool permission filtering (allowed/denied/approval_required)
- `AgentSkillsService` for skill library management
- `IAMPolicyService.refreshPolicies()` triggered on profile create/update/delete

### Transient Failure Classification (`apps/api/src/llm/`)
- `classifyProviderTransientFailure()` detects 429 rate limits and 529 overloads
- Extracts usage limits, reset timestamps, provider tier from error messages

## Health Findings

### Test Coverage
- **Unit tests**: `ai-configuration.service.spec.ts` (Jest), `ai-config-admin.service.spec.ts` (Vitest)
- **Integration tests**: `__tests__/unit/provider-env.service.spec.ts`, `model-resolution.service.spec.ts`
- **Test fixtures**: Comprehensive mocks in `__tests__/setup/ai-config-test.fixtures.ts`
- **LLM helper tests**: `provider-transient-failure.helpers.spec.ts` with fake timers for rate limit parsing

### Code Quality
- Clean separation: Controllers → AdminService → CRUD Services → Repositories
- Type-safe request/response via `@nexus/core` Zod schemas
- Consistent error handling with `NotFoundException`, `BadRequestException`

### Architecture
- `@Global()` module exports: `AiConfigurationService`, `SecretVaultService`, `AgentFactoryService`, `AgentSkillsService`, `ArtifactLibraryService`
- Strategy pattern for model selection with clear priority ordering
- OAuth and API key auth paths clearly separated in configuration helpers

## Open Questions

- **Deprecated controller**: `AiConfigController` is marked `@deprecated` with migration to entity-specific controllers complete. Verify all consumers have updated endpoints.
- **OAuth refresh token rotation**: Handled in helpers but full lifecycle management (automatic refresh) likely belongs to the runtime runner, not config service.
- **Default model fallback**: `ModelSelectionFactory.selectModel()` returns `'default-model'` when all strategies fail. Consider whether this should throw or log a warning for production environments.