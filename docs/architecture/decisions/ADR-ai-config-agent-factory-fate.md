# ADR: Disposition of `AgentFactoryService` Post AI-Config Refactor

**Status:** delete
**Date:** 2026-07-07
**Work item:** 4cff5b5e-8583-4b74-9799-fec96aca7809
**Owner:** refactor-executor
**Module:** `apps/api/src/ai-config/`
**Related docs:** `docs/work-items/6cd3562d-904a-462e-8ce6-2f0366be6f96.md`, `docs/work-items/4cff5b5e-8583-4b74-9799-fec96aca7809.md`, `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`

> Status line (literal): `Status: delete`

## Context

The umbrella work item `4cff5b5e-8583-4b74-9799-fec96aca7809`
("Refactoring umbrella for AI-config services") decomposes four
large files in `apps/api/src/ai-config/` into independently
maintainable modules. One of the four in-scope files is
`agent-factory.service.ts` (468 LOC at the pre-refactor baseline
git rev `26c387d48`), a NestJS `@Injectable()` exposing one public
method `createProfile(...)` (lines 81–119) and registered in
`AiConfigModule`'s `providers` (line 99) and `exports` (line 117)
arrays. The umbrella's Milestone-1 capture (§e) records the
following reference counts at the pre-refactor state:

| Pattern | Count |
| --- | ---: |
| `AgentFactoryService` (any reference, `apps/api/src --include='*.ts'`) | **8** |
| `AgentFactoryService\.\|AgentFactoryService}` (strict, AC-AgentFactoryZeroConsumer / WR-16) | **0** |
| `AgentFactoryService\.` (literal dot alone) | 0 |
| `AgentFactoryService}` (literal brace alone) | 0 |

The strict pattern matches only `.method()` invocations and
`{Type}` generic constraints; neither appears in the tree. The
8 raw references all reduce to self-references inside
`AgentFactoryService`'s own module:

| # | File | Line | Form |
| -: | --- | ---: | --- |
| 1 | `apps/api/src/ai-config/services/agent-factory.service.ts` | 62 | `export class AgentFactoryService {` |
| 2 | `apps/api/src/ai-config/services/agent-factory.service.spec.ts` | 4 | `import { AgentFactoryService } from './agent-factory.service';` |
| 3 | `apps/api/src/ai-config/services/agent-factory.service.spec.ts` | 6 | `describe('AgentFactoryService', () => {` |
| 4 | `apps/api/src/ai-config/services/agent-factory.service.spec.ts` | 49 | `let service: AgentFactoryService;` |
| 5 | `apps/api/src/ai-config/services/agent-factory.service.spec.ts` | 71 | `service = new AgentFactoryService(` |
| 6 | `apps/api/src/ai-config/ai-config.module.ts` | 31 | `import { AgentFactoryService } from './services/agent-factory.service';` |
| 7 | `apps/api/src/ai-config/ai-config.module.ts` | 97 | `AgentFactoryService,` (providers) |
| 8 | `apps/api/src/ai-config/ai-config.module.ts` | 115 | `AgentFactoryService,` (exports) |

No external production consumer invokes
`AgentFactoryService.createProfile`. The canonical create-profile
surface today is `AiConfigAdminService.createAgentProfile`
(line 231) reached via `AgentProfilesController` at
`POST /ai-config/agent-profiles` (`agent-profiles.controller.ts:78`).
The admin path persists `source: 'admin'` (line 247) and
`factory_context: null` (line 250) and is independent of the
factory class — a grep for `AgentFactory` /
`agentFactory` / `this\.factory` in `ai-config-admin.service.ts`
returns zero hits.

### The unwired `create_agent_profile` apiCallback

`apps/api/src/workflow/providers/workflow-management-capability.provider.ts:6-32`
declares a runtime-side parallel capability:

```
@Capability({
  name: 'create_agent_profile',
  tierRestriction: 2,
  transport: 'api_callback',
  runtimeOwner: 'api',
  policyTags: ['mutating', 'approval_gated'],
  description: 'Create runtime agent profiles with governed tools.',
  mutatingAction: 'create_agent_profile',
  apiCallback: {
    method: 'POST',
    pathTemplate: '/api/workflow-runtime/orchestration/create-agent-profile',
    bodyMapping: {
      scope_id: 'scope_id',
      profile_name: 'profile_name',
      system_prompt: 'system_prompt',
      tier_preference: 'tier_preference',
      allowed_tools: 'allowed_tools',
      model_name: 'model_name',
      provider_name: 'provider_name',
      factory_context: 'factory_context',
      reasoning: 'reasoning',
    },
  },
  inputSchema: createAgentProfileSchema,
})
createAgentProfile() {
  return { ok: true };
}
```

The body mapping includes a `factory_context` field — the only
shape-level distinction between this callback and the admin REST
path. The `createAgentProfile()` method body returns a literal
`{ ok: true }`; the capability is a discovery artifact, not a
handler.

**Verified per WR-3 (controller inventory):** `apps/api/src/workflow/workflow-runtime/`
contains eight `@Controller` classes
(`workflow-runtime-war-room.controller.ts`,
`workflow-runtime-artifacts.controller.ts`,
`workflow-runtime-step-complete.controller.ts`,
`workflow-runtime-lifecycle.controller.ts`,
`workflow-runtime-capability-lifecycle.controller.ts`,
`workflow-runtime-internal-tool-callbacks.controller.ts`,
`workflow-runtime-agent-mentions.controller.ts`,
`workflow-runtime-subagents.controller.ts`) and the related
`workflow-delegation-tools.controller.ts`
(route `workflow-runtime/orchestration/projected-workflow-delegations`,
a different sub-path). None of them mounts
`/api/workflow-runtime/orchestration/create-agent-profile`. A
whole-tree grep for `create-agent-profile` confirms
the path appears only in three places:

1. The `pathTemplate` declaration above.
2. The unrelated migration-filename reference at
   `apps/api/src/database/migrations/registered-migrations.ts:2`
   (`import { CreateAgentProfileSkillBindings... } from './20260714040000-create-agent-profile-skill-bindings'`),
   which is a filename and not a runtime route.
3. A JSDoc reference on the unrelated
   `agent-profile-skill-binding.entity.ts:18` schema doc.

The `CapabilityRegistryService` records the capability's
`pathTemplate` for tool manifest projection, but no
`@Controller` and no in-process dispatcher binds it to a
handler. The apiCallback is therefore **unwired** in the
runtime API surface. The four
`agent.factory.create.{attempted,succeeded,denied,failed}`
events emitted inside `AgentFactoryService.createProfile`
(lines 208, 225, 252–253) are unreachable from any production
call path; the
`apps/api/src/ai-config/services/agent-factory.service.spec.ts`
assertions on those events (lines 115, 121, 143) are correct
as a unit-test contract but observe no live workflow traffic.

### Third-party references to the unwired capability (not consumers)

The `create_agent_profile` capability name is registered in
four string-list sites that are not live callers — they are
catalog entries that document what *would* be possible if a
caller were wired:

- `apps/api/src/capability-infra/capability-manifest.types.ts:20`
  (a string-union of capability names).
- `apps/api/src/settings/agent-mesh.settings.constants.ts:44`
  (the agent-mesh allowlist).
- `apps/api/src/workflow/workflow-subagents/mesh-delegation-governance.service.ts:17`
  (mesh-delegation governance allowlist).
- `apps/api/src/database/seeds/seed-data.validation.spec.ts:206`
  (seed-data validation reference).

None of these string-list entries invokes
`AgentFactoryService.createProfile`. Removing the capability
declaration is a coherent cleanup of the underlying dead
artifact; the string-list entries are downstream documentation
of a runtime surface that does not exist.

## Decision

**Status: delete.** Remove `AgentFactoryService` and the
`create_agent_profile` capability declaration entirely,
leaving `AgentProfilesController` +
`AiConfigAdminService.createAgentProfile` as the sole
create-profile surface.

Justification (the four evidence-led reasons that beat the
other two branches):

1. **The apiCallback is unmounted.** With no `@Controller`
   route binding
   `/api/workflow-runtime/orchestration/create-agent-profile`
   (WR-3) and no in-process dispatcher routing it to
   `AgentFactoryService.createProfile`, the service has zero
   reachable callers in production code. The `keep`
   branch's trigger condition ("A hidden in-process
   dispatcher routes the apiCallback to
   `AgentFactoryService.createProfile` (or to it after a
   small bridge).") is **false**. Of the three branches
   only `delete` is consistent with the observed runtime
   path; `keep` requires us to ship a dispatcher to
   validate, and `wire` requires us to ship both a
   dispatcher and a controller — both are unilateral
   scope expansions that the umbrella spec did not budget.
2. **The admin REST surface already covers the create-profile
   need.** `AiConfigAdminService.createAgentProfile` is
   exposed via `AgentProfilesController` at
   `POST /ai-config/agent-profiles`, validated by
   `validateProfileToolNames`, persisted via
   `profileCrudService.create`, and audited via
   `iamPolicyService.refreshPolicies`. There is no
   documented capability or behaviour in the runtime
   apiCallback body mapping that the admin path cannot
   serve — the factory-specific `factory_context` is a
   passthrough column on `agent_profiles`
   (`agent-profile.entity.ts:84`,
   `agent-profile.repository.ts:95`), and the admin path
   sets it to `null` because no live caller populates it.
   The `factory_context` column is retained regardless of
   this ADR's disposition.
3. **`delete` is the only branch that does not add a new
   HTTP surface.** `wire` introduces a new controller
   route, a new `@Module` import edge from `workflow-runtime`
   to `ai-config.services.AgentFactoryService`, and a new
   end-to-end behavioural test exercising a path that no
   current production caller requests. None of that surface
   area is asked for by the four children implementing the
   umbrella's refactor scope. Adding it now would shift
   the umbrella's blast radius from "internal module
   hygiene" to "new external contract" — a separate
   decision the umbrella spec does not authorise.
4. **The `agent.factory.create.*` events and the spec's 9
   `it(...)` cases have no live caller.** Grepping
   `apps/api/src --include='*.ts'` for
   `agent\.factory\.create` returns only the service file
   (lines 208, 225, 252–253) and its spec (lines 115, 121,
   143). Removing the service therefore removes only those
   self-references — no observer upstream, no observer
   downstream, and no test in another suite asserts these
   event names.

`delete` is the risk-minimising choice: zero new behaviour,
zero new module-graph edges, zero new test surface. The
pre-refactor `AgentFactoryService` is documented dead code
whose only path into the system was the unwired
`create_agent_profile` apiCallback; the disposition is to
retire both together.

## Alternatives Considered

### Option 1 — `keep` (current dead-code state preserved)

Keep the file as-is in
`apps/api/src/ai-config/services/agent-factory.service.ts`;
add the WAR-11-amendment behavioural test that asserts the
apiCallback proxies to `AgentFactoryService.createProfile`;
let the umbrella close without changing the production
code path.

Rejected because the `keep` branch's trigger condition (per
the child-4 matrix table in
`docs/work-items/6cd3562d-904a-462e-8ce6-2f0366be6f96.md`
Step 3) is: **"A hidden in-process dispatcher routes the
`create_agent_profile` apiCallback to
`AgentFactoryService.createProfile` (or to it after a small
bridge)."** No such dispatcher exists today (WR-3:
`pathTemplate` unmounted; `CapabilityRegistryService`
records the capability but does not bind it to a handler;
eight controllers in `workflow-runtime/` reviewed, none
mounts the path). Writing a behavioural test that asserts a
proxy that doesn't exist would just fail at runtime, and
shipping a "small bridge" inside this ADR's decision
turns `keep` into `wire` — which the matrix names
separately precisely so that the new surface is its own
decision. `keep` is therefore not self-consistent with the
current code; the matrix cannot be picked without
falsifying its own precondition.

The 9 `it(...)` cases in
`apps/api/src/ai-config/services/agent-factory.service.spec.ts`
are also retained under `keep`, but they continue to
observe no live workflow traffic — they are a unit-test
contract against an unreachable code path. Keeping the
spec without a live caller is dead-test surface that the
nightly `codebase_refactoring_analysis` would (correctly)
flag in a future scan.

### Option 2 — `wire` (add controller route + behavioural test)

Implement the missing bridge: a new
`apps/api/src/workflow/workflow-runtime/...` controller
mounting `@Controller('api/workflow-runtime/orchestration/create-agent-profile')`
(or a `CapabilityRegistryService` proxy in
`workflow-runtime-internal-tool-callbacks.controller.ts`)
and routing the body to `AgentFactoryService.createProfile`.

Rejected because:

- **Adds a new public HTTP surface that no current caller
  requests.** `AiConfigAdminService.createAgentProfile`
  already services the create-profile need via the admin
  REST path; the runtime apiCallback was always a
  discovery surface, not a live contract. Shipping a new
  route obligates us to declare a new auth scope, error
  contract, idempotency policy, and OpenAPI surface, all
  of which the umbrella spec does not budget for.
- **Adds a `workflow-runtime` → `ai-config` module-graph
  edge.** Today, `workflow-runtime` does not import from
  `ai-config.services.AgentFactoryService`. Adding the
  import either (a) crosses api→core→kanban-adjacent
  boundaries — the body mapping carries
  `factory_context` and `tier_preference` whose policy
  lives in `iam-policy.service` and ultimately surfaces in
  `apps/agent-factory`'s profile-CRUD layer — forcing a
  `forwardRef` or a `CapabilityRegistryService`
  indirection, or (b) moves `AgentFactoryService` to
  `workflow-runtime/`, which is a separate decision the
  umbrella did not authorise. Either way, the
  `madge:circular` baseline (44 chains at HEAD
  `26c387d48`, 52 in the stale 2026-06-22
  `CIRCULAR_BASELINE.md` snapshot) is at risk of
  regressing past the absolute ratchet.
- **Demotes `delete` to a follow-up that has to be
  revisited anyway.** If the apiCallback is genuinely
  unused, preserving the service under a new route just
  lets future runtime callers discover the apiCallback
  contract. That contract has no current owner; adding a
  route is unilateral scope creep relative to the
  umbrella's four-child plan, and the matrix records
  `delete` as a first-class branch precisely so that the
  `pathTemplate`-without-route mismatch documented per
  WR-3 can be resolved cleanly rather than papered over.

### Option 3 — `delete` (chosen)

Delete `apps/api/src/ai-config/services/agent-factory.service.ts`
and
`apps/api/src/ai-config/services/agent-factory.service.spec.ts`;
remove `AgentFactoryService` from
`apps/api/src/ai-config/ai-config.module.ts:32` (import),
`:99` (providers), `:117` (exports); remove the
`create_agent_profile` capability declaration from
`apps/api/src/workflow/providers/workflow-management-capability.provider.ts:6-32`.

Selected because it is the only branch that is
self-consistent with the runtime trace (no dispatcher, no
controller), the only branch that adds no new surface,
and the only branch that resolves the
`pathTemplate`-without-route mismatch documented per WR-3.
The Validation section pins the post-refactor
`grep -rn 'AgentFactoryService'` count at zero.

## Consequences

### Module-graph impact

- `AiConfigModule` providers count drops from 29 to 28;
  `AiConfigModule` exports count drops from 12 to 11.
  The umbrella Milestone-1 capture (§b) records
  pre-refactor `29 / 12`; post-refactor is `28 / 11`.
- Removing `AgentFactoryService` from the providers array
  may reduce the `madge:circular` chain count slightly
  (`AgentFactoryService`'s nine constructor collaborators
  — `CapabilityRegistryService`,
  `AgentProfilesFileSeedService`,
  `AgentProfileRepository`, `ToolRegistryRepository`,
  `LlmModelRepository`, `LlmProviderRepository`,
  `EventLedgerService`, `IAMPolicyService`, and the
  implicit `ConfigService` — each participate in one or
  more dependency chains). The `CIRCULAR_BASELINE.md`
  ratchet (44 chains at HEAD `26c387d48`, 52 in the stale
  2026-06-22 snapshot) is expected to drop or hold; the
  umbrella's AC-M3 contract is `<= 52` chains absolute,
  which the deletion is consistent with. Update
  `apps/api/CIRCULAR_BASELINE.md` if the chain count
  shifts.
- The `improvement-module forwardRef cycle` mentioned in
  the child-4 spec is **unaffected** —
  `AgentFactoryService` is not a participant in any
  `forwardRef` between `ImprovementModule` and the
  `AiConfigModule`. Removing the symbol cannot create a
  new cycle.
- The `agent_profile_skill_bindings` table migration
  (`apps/api/src/database/migrations/20260714040000-create-agent-profile-skill-bindings.ts`)
  is unaffected — that table is bound to the
  `AgentProfilesController` admin REST path via
  `AiConfigAdminService`, not to `AgentFactoryService`.

### Behavioural coverage

- The four
  `agent.factory.create.{attempted,succeeded,denied,failed}`
  events emitted by `AgentFactoryService` are removed.
  No production consumer observes these events today
  (`grep -rn 'agent\.factory\.create' apps/api/src --include='*.ts'`
  returns only the service and its spec), so the removal
  is silent at runtime.
- The 9 `it(...)` cases in
  `apps/api/src/ai-config/services/agent-factory.service.spec.ts`
  are removed alongside the service file. No other suite
  asserts these event names; no other spec invokes
  `AgentFactoryService.createProfile`.
- The `create_agent_profile` tool entry is removed from
  the `agent-mesh.settings.constants.ts:44` allowlist
  and the
  `mesh-delegation-governance.service.ts:17`
  capabilities list, and the
  `create_agent_profile` arm from
  `capability-manifest.types.ts:20`. These three
  string-list entries were attached to a tool that no
  live workflow exposes (the apiCallback path is
  unmounted), so removing the entries is consistent with
  the runtime reality and tightly scopes the cleanup.
- The `factory_context` column on `agent_profiles`
  (`agent-profile.entity.ts:84`,
  `agent-profile.repository.ts:95`) is **retained**: it
  is a passthrough column that the admin path persists
  as `null` and that any future create-profile surface
  can populate. Removing the column would be a separate
  migration unrelated to this ADR.

### Pre/post grep delta

Pre-refactor (HEAD `26c387d48`):

| Pattern | Count |
| --- | ---: |
| `AgentFactoryService` (any reference, AC-AgentFactoryZeroConsumer broader pattern) | 8 |
| `AgentFactoryService\.\|AgentFactoryService}` (strict, AC-AgentFactoryZeroConsumer / WR-16) | 0 |

Post-refactor (target for the child PR):

| Pattern | Count |
| --- | ---: |
| `AgentFactoryService` (any reference) | 0 |
| `AgentFactoryService\.\|AgentFactoryService}` (strict) | 0 |

Net delta: **-8 on the broader pattern**, **0 on the strict
pattern** (already 0). The pre-refactor 8 is fully
self-referential inside `AgentFactoryService`'s own module;
removing the file collapses all 8 to 0. The strict pattern is
0 both before and after, so the AC-AgentFactoryZeroConsumer
criterion ("post-refactor count is asserted and consistent
with the chosen branch") is met by `delete` because the
count stays at 0 and the raw broader count also drops to 0,
the strongest possible statement of zero external
consumer.

### Linked child work item

The implementing work for this disposition lives in child
work item `6cd3562d-904a-462e-8ce6-2f0366be6f96`
("`AgentFactoryService` fate ADR + decision-implementation,
AC-5"), which carries the file deletions, the
`ai-config.module.ts` cleanup, and the
`workflow-management-capability.provider.ts` capability
removal as its Step-4 implementation work. This ADR is the
decision artifact (Step 2 of `6cd3562d-…`); the child PR
must cite `Status: delete` from the `## Status` section
above and verify the post-refactor `grep` count and
`madge:circular` ratchet per the Validation section below.

## Validation

The child PR
(`feature/6cd3562d-904a-462e-8ce6-2f0366be6f96` from
`docs/work-items/6cd3562d-904a-462e-8ce6-2f0366be6f96.md`)
must verify the post-refactor state via the following
artifacts; each item names the Status-branch-specific
artifact required by AC-5.5–AC-5.8 of the child spec.

1. **Grep zero-consumer (AC-5.6 / AC-5.8):**
   ```bash
   grep -rn 'AgentFactoryService' apps/api/src --include='*.ts'
   ```
   returns **zero matches**. The raw broader grep — not
   just the strict pattern — must return zero, because
   the deletion removes the declaration, the imports,
   the providers entry, the exports entry, and the spec,
   none of which would survive the strict pattern's
   restricted set either. The PR description must record
   both the pre-refactor 8-hit baseline and the
   post-refactor 0-hit target, with a delta statement
   consistent with this ADR's Pre/post grep delta
   table.
2. **Capability declaration is removed:** A grep
   ```bash
   grep -rn 'create_agent_profile' apps/api/src --include='*.ts'
   ```
   returns zero matches in
   `apps/api/src/workflow/providers/workflow-management-capability.provider.ts`,
   zero matches in
   `apps/api/src/ai-config/services/agent-factory.service.ts`
   (file gone), and zero matches in
   `apps/api/src/capability-infra/capability-manifest.types.ts`,
   `apps/api/src/settings/agent-mesh.settings.constants.ts`,
   and
   `apps/api/src/workflow/workflow-subagents/mesh-delegation-governance.service.ts`.
   The four `agent.factory.create.*` event names vanish
   as a transitive consequence of (1).
3. **`madge:circular` does not regress:**
   ```bash
   npm run madge:circular --workspace=apps/api 2>&1 | grep -E "Found [0-9]+ circular"
   ```
   reports `<= 52` chains (the absolute ratchet) and
   within `+/- 1` of the milestone-1 baseline (44).
   Update `apps/api/CIRCULAR_BASELINE.md` if the chain
   count shifts (likely a hold; possibly a slight drop
   once `AgentFactoryService` is removed from the
   providers array).
4. **`test:api` continues to pass:** Run
   ```bash
   npm run test --workspace=apps/api -- ai-config
   ```
   exits 0. The 9 `it(...)` cases in
   `agent-factory.service.spec.ts` are removed
   intentionally, so the post-refactor spec count for
   `agent-factory.service.spec.ts` is **0**, while the
   broader `ai-config` spec suite continues to pass
   because the deletion touches no other test file.
5. **`test:boot` continues to pass:** Run
   ```bash
   npm run test:boot --workspace=apps/api
   ```
   (in a `docker compose up` environment) exits 0. The
   factory deletion cannot fail boot because
   `AgentFactoryService` has no boot-time collaborators
   outside its own module and the
   `create_agent_profile` apiCallback was never wired.
6. **Lint clean with no suppressions:** Run
   ```bash
   npm run lint:api
   ```
   exits 0 with **no new** `eslint-disable` /
   `@ts-ignore` / `@ts-nocheck` / rule suppression
   introduced. The deletion removes annotations; lint
   regressions on adjacent modules must be fixed in
   code, not suppressed, per
   `.github/instructions/lint-warning-policy.instructions.md`.

The Removal + grep-zero-hits artifact (item 1) is the
canonical Status-branch-specific artifact for `delete` per
the QA rejection's Validation requirement; the items above
are the supporting evidence the child PR must collect
alongside it.

## References

- `docs/work-items/4cff5b5e-8583-4b74-9799-fec96aca7809.md`
  — umbrella spec; Milestone-1 §e captures the
  pre-refactor grep counts and the strict-pattern
  interpretation.
- `docs/work-items/6cd3562d-904a-462e-8ce6-2f0366be6f96.md`
  — child spec; Step 2 owns the ADR, Step 4 owns the
  implementation.
- `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`
  — format reference for this ADR.
- `apps/api/src/ai-config/services/agent-factory.service.ts`
  — the file slated for deletion (Step 4 of
  `6cd3562d-…`).
- `apps/api/src/ai-config/services/agent-factory.service.spec.ts`
  — the spec slated for deletion (9 `it(...)` cases).
- `apps/api/src/ai-config/ai-config.module.ts` lines 32,
  99, 117 — `AgentFactoryService` registration lines
  (import, providers, exports) slated for cleanup.
- `apps/api/src/workflow/providers/workflow-management-capability.provider.ts`
  lines 6–32 — `create_agent_profile` capability
  declaration slated for removal.
- `apps/api/src/workflow/workflow-runtime/` — controller
  inventory confirming no route mounts
  `/api/workflow-runtime/orchestration/create-agent-profile`.
- `apps/api/src/ai-config/ai-config-admin.service.ts:231`
  — `AiConfigAdminService.createAgentProfile`, the
  surviving create-profile surface after `delete`.
- `apps/api/src/ai-config/controllers/agent-profiles.controller.ts:78`
  — `POST /ai-config/agent-profiles`, the surviving
  admin REST route after `delete`.
- `apps/api/CIRCULAR_BASELINE.md` — circular-dependency
  ratchet (44 chains at HEAD `26c387d48`, 52 in the
  stale 2026-06-22 snapshot; deletion expected to hold
  or drop).
- `.github/instructions/lint-warning-policy.instructions.md`
  — strict-lint policy referenced by Validation item 6.

## Status

Status: delete. Owner: refactor-executor.

The implementation work for this disposition lives in
child `6cd3562d-904a-462e-8ce6-2f0366be6f96` (Step 4);
this ADR is the decision artifact (Step 2). The child PR
must surface the post-refactor `grep -rn 'AgentFactoryService'`
zero-consumer result, the unchanged / reduced
`madge:circular` chain count, and the unaffected
`test:api` / `test:boot` / `lint:api` results from the
Validation section above.
