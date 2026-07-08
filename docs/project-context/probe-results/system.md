---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: system
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/api/src/system/database/entities/system-setting.entity.ts
  - apps/api/src/system/database/entities/setup-config.entity.ts
  - apps/api/src/system/database/entities/cost-tracking.entity.ts
  - apps/api/src/system/database/repositories/cost-tracking.repository.ts
  - apps/api/src/database/database.module.ts
  - apps/api/src/database/seeds/system/setup-config.seed.ts
  - apps/api/src/settings/system-settings.repository.ts
  - apps/api/src/settings/system-settings.service.ts
  - apps/api/src/observability/cost-tracking.service.ts
  - apps/api/src/setup/setup.service.ts
source_paths:
  - apps/api/src/system/
updated_at: 2026-06-15T17:30:00Z
---

# Probe Result: System Settings

## Narrative Summary

The `apps/api/src/system/` path is a **persistence-layer-only module** that holds
TypeORM entities and a single repository supporting three cross-cutting "system
settings" concerns. It was introduced in commit `7fad40fa5`
(`refactor(epic-185): domain based database entities + repository organisation`)
as part of an EPIC-185 refactor that grouped persistence primitives by domain
into `apps/api/src/<domain>/database/`.

The scope contains exactly six files — no controllers, services, modules, DTOs,
migrations, or tests live in this directory. All service-layer logic for these
entities lives outside the `system/` folder:

- `SystemSetting` entity → owned by `apps/api/src/settings/`
  (`SystemSettingsRepository`, `SystemSettingsService`, `SystemSettingsController`,
  `SystemSettingsModule`) which also publishes `/system-settings` HTTP endpoints
  guarded by JWT + `settings:read` / `settings:manage` permissions.
- `SetupConfig` entity → owned by `apps/api/src/setup/setup.service.ts`
  (reads via `DataSource.getRepository(SetupConfig)`), seeded by
  `apps/api/src/database/seeds/system/setup-config.seed.ts`.
- `CostTracking` entity + `CostTrackingRepository` → owned by
  `apps/api/src/observability/cost-tracking.service.ts` (also registered in
  `DatabaseModule.providers`).

All three entities are wired into the global `DatabaseModule` (`apps/api/src/database/database.module.ts`)
via `TypeOrmModule.forFeature(entities)` and the `entities`/`repositories`
arrays, with `synchronize: false` and explicit migrations under
`database/migrations/`. `SetupConfig` is seeded at startup by
`StartupSeedService` → `SetupConfigSeedService`, while `SystemSetting` defaults
are seeded by `SystemSettingsModule.onModuleInit()` calling
`SystemSettingsService.seedDefaults()`.

The `kanban.project_state` and `kanban.orchestration_timeline` tools referenced
in the playbook are **not available** in this investigation subagent's tool
surface, so workflow-state and timeline evidence could not be gathered.
All other discovery was performed with `ls`, `find`, `grep`, `read`, and
`git log`/`git show` (read-only).

## Capability Updates

- **Generic system settings store (key/value JSONB)**: implemented.
  `SystemSetting` (PK `key`, jsonb `value`, optional `description`,
  `updated_at`) is the persistence primitive behind
  `SystemSettingsService.getAll/get/set/seedDefaults` and the
  `GET /system-settings` and `PUT /system-settings/:key` endpoints. Defaults
  cover workflow auto-retry, chat-session auto-retry, question-idle timers,
  scheduled-jobs cadence, repair-delegation, learning promotion confidence,
  telegram, and the EPIC-066 stage skill policy.
- **Setup gating flag**: implemented. `SetupConfig` (singleton key
  `requires_setup`, boolean flag) drives `SetupService` to determine whether
  the application must run the initial-setup wizard; seeded on startup.
- **Cost tracking record store**: implemented. `CostTracking` entity +
  `CostTrackingRepository` (with `recordCost` and `getSummary(start, end)`
  aggregating by `resource_type`) is consumed by
  `observability/cost-tracking.service.ts` to record LLM/compute/storage
  consumption and produce period summaries.
- **Module registration**: implemented. `DatabaseModule` (global) registers
  all three entities and the `CostTrackingRepository` provider, exports the
  `TypeOrmModule` and repositories, and triggers seeding on `onModuleInit`.

## Health Findings

- **Code organisation**: scope is intentionally minimal — entities only —
  consistent with the EPIC-185 domain-organisation refactor; no dead code or
  duplicated definitions detected.
- **Test coverage within scope**: **none** — there are no `*.spec.ts` or
  `*.test.ts` files anywhere under `apps/api/src/system/`. Indirect coverage
  exists in the consumer modules:
  - `apps/api/src/settings/system-settings.service.spec.ts` exercises
    `SYSTEM_SETTING_DEFAULTS` and `SystemSettingsService` behaviour.
  - `apps/api/src/settings/system-settings.controller.spec.ts` exercises the
    controller.
  - `apps/api/src/settings/system-settings.module.spec.ts` exercises the
    module wiring.
  - `apps/api/src/setup/setup.service.spec.ts` mocks `SetupConfig`.
  - `apps/api/src/settings/telegram-settings.service.spec.ts` and others
    use the `SystemSetting` type.
  The `CostTrackingRepository` and `CostTrackingService` have **no direct
  unit tests** in the `apps/api/src` tree (only the entity/repository type
  appears in transitive imports).
- **Churn**: low. `apps/api/src/system/` was added in a single commit
  (`7fad40fa5`, 2026-05-18) and has had no further modifications. The
  underlying settings behaviour continues to evolve in
  `apps/api/src/settings/` (recent commits include
  `a4b93888b` learning-confidence gate,
  `d56750a16` repair delegation default,
  `2aefb41a6` EnforcementMode staged-rollout flag, and
  `578842560` removing orchestration auto-restart cooldown settings).
- **Migrations / schema**: schema is managed by TypeORM migrations listed
  in `database/migrations/registered-migrations.ts`; `synchronize: false`
  is correctly set, so the entities here must remain migration-backed
  (not auto-synced).
- **Public surface**: `system/` exports only an `index.ts` barrel for
  entities and one for repositories; both re-export all three entities /
  the single repository. There is no NestJS module in this scope — it is
  purely a TypeORM/data-layer module wired through the global
  `DatabaseModule`.

## Open Questions

- The playbook step requiring `kanban.project_state` and
  `kanban.orchestration_timeline` could not be executed because those
  runtime tools are not exposed to this subagent. A parent workflow
  pass should reconcile any kanban state for the `system` probe_scope
  once the kanban service is reachable.
- The `SystemSettingsService` payload, `seedDefaults` behaviour, and
  default catalogue (specifically the `EPIC_066_STAGE_SKILL_POLICY_DEFAULT`
  blob) were only partially read here (first 80 lines of the 330-line
  service file). A deeper read may be needed to enumerate every setting
  the system-settings scope actually owns; the persistence layer in
  `system/` is generic and will store any key added.
- Whether `CostTrackingRepository` requires a direct unit test was not
  confirmed — no test file was found in `apps/api/src/observability/` or
  `apps/api/src/system/`, which may be a coverage gap to flag in
  `CODEBASE_HEALTH.md` rather than resolve here.
- The relationship (and possible duplication) between
  `apps/api/src/system/` and the legacy `apps/api/src/settings/` boundary
  is a refactor artefact: `system-setting.entity.ts` is a pure data
  primitive, while all behaviour lives in `settings/`. A future probe
  on the `settings` scope should treat the entity as a dependency of
  `settings` rather than as a separate feature.
