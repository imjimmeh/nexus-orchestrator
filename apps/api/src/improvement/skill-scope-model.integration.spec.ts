/**
 * End-to-end integration test for the skill/learning scope model
 * (docs/superpowers/plans/2026-07-05-skill-learning-scope-model.md, Task 10).
 *
 * Scope:
 *   Boots a real Nest testing module spanning the scope hierarchy
 *   (`ScopeService` / `scope_nodes` / `scope_node_closure`), agent profiles
 *   (`AgentProfileRepository` / `agent_profiles`), the runtime skill-binding
 *   surface (`AgentProfileSkillBindingService` / `agent_profile_skill_bindings`,
 *   Task 2/3), the improvement-proposal pipeline (`ImprovementProposalService`,
 *   `ImprovementGovernancePolicyService`, `ImprovementApplierRegistry`), the
 *   `skill_assignment` applier (`SkillAssignmentApplier`, Task 6/7 — the
 *   previously-unscoped path this feature fixes), and the workflow-facing
 *   resolution surface (`WorkflowStageSkillPolicyService.resolveAssignedSkills`)
 *   — all backed by a REAL Postgres instance, not hand-mocked repositories.
 *
 * Why a real DB (and not a hand-rolled in-memory fake): the property under
 * test is that a `skill_assignment` proposal scoped to one project is
 * genuinely invisible to a sibling project and to a different agent profile
 * in the SAME project — i.e. that `agent_profile_skill_bindings` rows,
 * `scope_node_closure` ancestry, and the `(agent_profile_id IS NULL OR
 * agent_profile_id = ?)` filter in `AgentProfileSkillBindingService
 * .listApplicableSkillNames` compose correctly through real SQL. A
 * hand-rolled fake of the closure table would just re-implement (and
 * therefore re-assert) the same logic it's supposed to be checking.
 *
 * Two collaborators sit outside this feature's scope and are stubbed rather
 * than wired for real:
 *   - `SystemSettingsService` — returns the caller-supplied default for every
 *     key, which reproduces "no operator override row exists yet" (the
 *     default `tiered` governance mode, which auto-applies `skill_assignment`
 *     per `TIERED_AUTO_APPLY_KINDS` — see
 *     `improvement-governance-policy.helpers.ts`).
 *   - `EventLedgerService` — captures `emitBestEffort(...)` calls in memory;
 *     a real implementation would write to the `event_ledger` table, which
 *     is orthogonal to what this test asserts.
 *   - `AgentSkillsService` — in production, `skillExists()`/`listSkills()`
 *     read the FILE-BASED skill library (`AgentSkillLibraryService`, backed
 *     by on-disk `SKILL.md` files), not the `agent_skills` DB table. Standing
 *     up that file-system surface for one fixture skill would drag in a
 *     whole unrelated subsystem, so this test seeds a REAL `agent_skills` row
 *     (satisfying the "pre-existing AgentSkill" fixture the brief asks for,
 *     and the DB surface the retrospective router's own skill-existence
 *     check reads in production) and backs the two SYNCHRONOUS gateway
 *     methods (`skillExists`, `listSkills`) with a value loaded from that
 *     real row in `beforeEach` — so the "skill exists" answer is grounded in
 *     a real DB read, even though the specific interface shape being
 *     satisfied is synchronous by contract.
 *
 * DB safety: mirrors `memory-drift-detection.integration.spec.ts` and
 * `auth/invitations/invitation-concurrent-accept.integration.spec.ts` — the
 * suite runs ONLY against a dedicated throwaway Postgres pointed to by
 * `INTEGRATION_TEST_DATABASE_URL` (CI provisions one). Absent that var the
 * suite is skipped entirely via `describe.skipIf(...)`, so `npm run
 * test:api` / a bare `vitest run` on a dev machine never touches live data.
 * `assertNotApplicationDatabase` is a belt-and-suspenders guard that aborts
 * if the URL happens to resolve to the application database. This
 * deliberately does NOT gate on the app-level `DB_HOST`/`DB_DATABASE`/
 * `DATABASE_URL` vars from `apps/api/.env.test` — those point at the shared
 * live docker-compose Postgres (see
 * `docs/operations`/the "Integration tests truncate live DB" incident this
 * repo already hit once with a DB-backed spec keyed off the wrong vars), and
 * every other real-DB `*.integration.spec.ts` in this codebase gates on
 * `INTEGRATION_TEST_DATABASE_URL` specifically to avoid repeating it.
 *
 * This suite is additive-only (it never TRUNCATEs a shared table): each
 * `beforeEach` deletes only the exact fixture rows it owns (fixed UUIDs /
 * names), in FK-safe order, before re-seeding — safe even if a prior run
 * crashed mid-test and left rows behind.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ScopeService } from '../scope/scope.service';
import { ScopeNode } from '../scope/database/entities/scope-node.entity';
import { GLOBAL_SCOPE_NODE_ID } from '../scope/scope.constants';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { AgentProfileSkill } from '../ai-config/database/entities/agent-profile-skill.entity';
import { AgentSkill } from '../ai-config/database/entities/agent-skill.entity';
import { AgentProfileSkillBinding } from '../ai-config/database/entities/agent-profile-skill-binding.entity';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { AgentSkillRepository } from '../ai-config/database/repositories/agent-skill.repository';
import { AgentProfileSkillBindingRepository } from '../ai-config/database/repositories/agent-profile-skill-binding.repository';
import { AgentProfileSkillBindingService } from '../ai-config/services/agent-profile-skill-binding.service';
import { AgentSkillLibraryService } from '../ai-config/services/agent-skill-library.service';
import type { SkillLibraryRecord } from '../ai-config/services/agent-skill-library.service.types';
import { SkillIndexService } from '../ai-config/services/skill-search/skill-index.service';
import { AgentSkillsService } from '../ai-config/services/agent-skills.service';
import type { AuthorizationService } from '../auth/authorization/authorization.service';
import { SystemSettingsService } from '../settings/system-settings.service';
import { EventLedgerService } from '../observability/event-ledger.service';
import type { EmitEventLedgerParams } from '../observability/event-ledger.service.types';
import { WorkflowStageSkillPolicyService } from '../workflow/workflow-stage-skill-policy.service';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import type { WorkflowSkillBindingService } from '../workflow/workflow-skill-bindings/workflow-skill-binding.service';
import { registeredMigrations } from '../database/migrations/registered-migrations';
import { ImprovementProposal } from './database/entities/improvement-proposal.entity';
import { ImprovementProposalRepository } from './database/repositories/improvement-proposal.repository';
import { ImprovementGovernancePolicyService } from './governance/improvement-governance-policy.service';
import { ImprovementApplierRegistry } from './appliers/improvement-applier.registry';
import { IMPROVEMENT_APPLIERS } from './appliers/improvement-applier.types';
import { SkillAssignmentApplier } from './appliers/skill-assignment.applier';
import type {
  SkillAssignmentApplierBindingsGateway,
  SkillAssignmentApplierSkillsGateway,
} from './appliers/skill-assignment.types';
import { ImprovementProposalService } from './improvement-proposal.service';
import { SkillCreateCompletionListener } from './skill-create-completion.listener';
import { SkillScopeConfirmationService } from './skill-scope-confirmation.service';

// ---------------------------------------------------------------------------
// DB availability gate — see file-level doc comment.
// ---------------------------------------------------------------------------

const INTEGRATION_TEST_DATABASE_URL =
  process.env['INTEGRATION_TEST_DATABASE_URL'];
const DB_AVAILABLE = Boolean(INTEGRATION_TEST_DATABASE_URL);

/**
 * Full transitive closure of entities reachable from the entities this test
 * touches directly, via TypeORM relation decorators (`AgentProfile` ->
 * `AgentProfileSkill` -> `AgentSkill`) — TypeORM's metadata builder resolves
 * a relation's target class at connection-build time, so every entity
 * referenced by a `@ManyToOne`/`@OneToMany` anywhere in this closure must
 * also be registered here (same discipline as
 * `invitation-concurrent-accept.integration.spec.ts`'s `ENTITIES` list).
 */
const ENTITIES = [
  ScopeNode,
  AgentProfile,
  AgentProfileSkill,
  AgentSkill,
  AgentProfileSkillBinding,
  ImprovementProposal,
];

const testDbConfig = {
  type: 'postgres' as const,
  url: INTEGRATION_TEST_DATABASE_URL,
  entities: ENTITIES,
  migrations: registeredMigrations,
  migrationsRun: true,
  migrationsTransactionMode: 'none' as const,
  synchronize: false,
  logging: false,
};

/**
 * Refuse to mutate the application database, even if the connection string
 * is misconfigured. Mirrors the identical guard in
 * `memory-drift-detection.integration.spec.ts` /
 * `invitation-concurrent-accept.integration.spec.ts`.
 */
async function assertNotApplicationDatabase(
  dataSource: DataSource,
): Promise<void> {
  const rows = await dataSource.query<{ current_database: string }[]>(
    'SELECT current_database()',
  );
  const connected = rows[0]?.current_database;
  const appDb = process.env['DB_DATABASE'] ?? 'nexus_orchestrator';
  if (connected === appDb) {
    throw new Error(
      `Refusing to run: integration test is connected to the application database "${connected}". ` +
        'Point INTEGRATION_TEST_DATABASE_URL at a dedicated throwaway database.',
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture constants — fixed UUIDs/names so a crashed prior run's leftovers
// are simply overwritten (delete-then-insert in `beforeEach`).
// ---------------------------------------------------------------------------

const ORG_SCOPE_ID = '90300000-0000-4000-8000-000000000001';
const SCOPE_A_ID = '90300000-0000-4000-8000-000000000002';
const SCOPE_B_ID = '90300000-0000-4000-8000-000000000003';
const PROFILE_A_ID = '90300000-0000-4000-8000-000000000004';
const PROFILE_B_ID = '90300000-0000-4000-8000-000000000005';
/**
 * A `team`-type node under {@link ORG_SCOPE_ID} and a `project`-type leaf
 * under IT — a genuine two-hop ancestor chain (SCOPE_C -> TEAM -> ORG ->
 * global) distinct from the existing one-hop ORG -> {@link SCOPE_A_ID}/
 * {@link SCOPE_B_ID} chain, used by the ancestor-inclusion coverage below
 * (plan Task 5, Step 2). `project` is a leaf type in
 * `PARENT_CHILD_TYPE_MATRIX` (scope-typing.ts) — it cannot itself gain
 * children, and `ScopeService` has no "reparent" operation, so this suite
 * grows a fresh branch off `ORG_SCOPE_ID` rather than reparenting the two
 * pre-existing project nodes.
 */
const TEAM_SCOPE_ID = '90300000-0000-4000-8000-000000000006';
const SCOPE_C_ID = '90300000-0000-4000-8000-000000000007';

const PROFILE_A_NAME = 'skill-scope-test-profile-a';
const PROFILE_B_NAME = 'skill-scope-test-profile-b';
const SKILL_NAME = 'incident-response';
/** Frontmatter-only skill written directly to a temp on-disk library root (never through the `agent_skills` DB table) — see the ancestor-inclusion frontmatter-path case. */
const ANCESTOR_SKILL_NAME = 'ancestor-scoped-skill';

/**
 * Deletes only the fixture rows this suite owns, in FK-safe order:
 *   - `improvement_proposals` carries no FK to scope/profile (its `scope_id`
 *     lives inside the `provenance` jsonb column), so it can go first.
 *   - `agent_profiles` / `agent_skills` have no FK to `scope_nodes` either.
 *   - `agent_profile_skill_bindings.scope_node_id` is `ON DELETE CASCADE`
 *     from `scope_nodes`, so deleting the scope nodes below would clean it
 *     up implicitly — deleted explicitly first anyway for clarity.
 *   - `scope_nodes.parent_id` is `ON DELETE RESTRICT`, so leaf projects
 *     (scope A/B/C) must be deleted before their parent org/team, and the
 *     team (parent of scope C) before the org.
 *
 * `TEAM_SCOPE_ID`/`SCOPE_C_ID` are only ever created inside the
 * ancestor-inclusion tests below, but this reset unconditionally attempts
 * their cleanup too (a harmless no-op `DELETE` when absent) so a test that
 * creates them never leaks rows into the next test's `beforeEach`.
 */
async function resetFixtures(dataSource: DataSource): Promise<void> {
  await assertNotApplicationDatabase(dataSource);
  await dataSource.query(
    `DELETE FROM improvement_proposals WHERE payload ->> 'skillName' = $1`,
    [SKILL_NAME],
  );
  await dataSource.query(
    `DELETE FROM improvement_proposals WHERE payload ->> 'target_skill_name' = $1`,
    [SKILL_NAME],
  );
  await dataSource.query(
    `DELETE FROM agent_profiles WHERE name = ANY($1::text[])`,
    [[PROFILE_A_NAME, PROFILE_B_NAME]],
  );
  await dataSource.query(`DELETE FROM agent_skills WHERE name = $1`, [
    SKILL_NAME,
  ]);
  await dataSource.query(
    `DELETE FROM agent_profile_skill_bindings WHERE scope_node_id = ANY($1::uuid[])`,
    [[SCOPE_A_ID, SCOPE_B_ID, ORG_SCOPE_ID, TEAM_SCOPE_ID, SCOPE_C_ID]],
  );
  await dataSource.query(`DELETE FROM scope_nodes WHERE id = ANY($1::uuid[])`, [
    [SCOPE_A_ID, SCOPE_B_ID, SCOPE_C_ID],
  ]);
  await dataSource.query(`DELETE FROM scope_nodes WHERE id = $1`, [
    TEAM_SCOPE_ID,
  ]);
  await dataSource.query(`DELETE FROM scope_nodes WHERE id = $1`, [
    ORG_SCOPE_ID,
  ]);
}

/**
 * Maps a real `agent_skills` row onto the `SkillLibraryRecord` shape
 * `WorkflowStageSkillPolicyService` expects from `AgentSkillsService
 * .listSkills()`. Fields the file-based skill library owns (`category`,
 * `tags`, `scope`, `rootPath`) have no DB-row equivalent and are filled with
 * inert defaults — this test's assertions only ever key off `.name`.
 */
function toSkillLibraryRecord(skill: AgentSkill): SkillLibraryRecord {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    skillMarkdown: skill.skillMarkdown,
    compatibility: skill.compatibility ?? null,
    category: null,
    tags: [],
    metadata: skill.metadata ?? null,
    scope: null,
    isActive: skill.isActive,
    version: skill.version,
    source: skill.source,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    rootPath: `agent-skills-db/${skill.name}`,
  };
}

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class InMemoryEventLedger {
  readonly events: EmitEventLedgerParams[] = [];

  async emitBestEffort(params: EmitEventLedgerParams): Promise<void> {
    this.events.push(params);
  }

  reset(): void {
    this.events.length = 0;
  }
}

interface SystemSettingsStub {
  get: Mock<(key: string, defaultValue: unknown) => Promise<unknown>>;
}

/**
 * Always returns the caller-supplied default — reproduces "no operator
 * override row exists yet" for both the governance-mode key (default
 * `tiered`) and the governance-overrides key (default `{}`).
 */
function buildSystemSettingsStub(): SystemSettingsStub {
  return {
    get: vi
      .fn<(key: string, defaultValue: unknown) => Promise<unknown>>()
      .mockImplementation(async (_key, defaultValue) => defaultValue),
  };
}

/**
 * Mutable container the `AgentSkillsService` stub and the
 * `SkillAssignmentApplier` skills-gateway both close over. Populated from a
 * REAL `agent_skills` DB read in `beforeEach`, after the module (and the
 * repository it exposes) already exists — see the file-level doc comment on
 * why these two synchronous-by-contract surfaces can't be backed by a live
 * async query at call time.
 */
interface SkillFixtureState {
  names: Set<string>;
  records: SkillLibraryRecord[];
}

function buildAgentSkillsStub(
  state: SkillFixtureState,
): Pick<
  AgentSkillsService,
  | 'listSkillsByProfileName'
  | 'listSkillsForScope'
  | 'listSkills'
  | 'skillExists'
> {
  return {
    listSkillsByProfileName: vi.fn(async () => []),
    listSkillsForScope: vi.fn(() => []),
    listSkills: vi.fn(() => state.records),
    skillExists: vi.fn((name: string) => state.names.has(name)),
  };
}

// ---------------------------------------------------------------------------
// Test module wiring
// ---------------------------------------------------------------------------

interface BuiltModule {
  moduleRef: TestingModule;
  eventLedger: InMemoryEventLedger;
  settings: SystemSettingsStub;
  skillState: SkillFixtureState;
}

async function buildModule(): Promise<BuiltModule> {
  const eventLedger = new InMemoryEventLedger();
  const settings = buildSystemSettingsStub();
  const skillState: SkillFixtureState = { names: new Set(), records: [] };
  const agentSkillsStub = buildAgentSkillsStub(skillState);

  const providers: Provider[] = [
    ScopeService,
    AgentProfileRepository,
    AgentSkillRepository,
    AgentProfileSkillBindingRepository,
    AgentProfileSkillBindingService,
    ImprovementProposalRepository,
    ImprovementGovernancePolicyService,
    ImprovementApplierRegistry,
    ImprovementProposalService,
    WorkflowStageSkillPolicyService,
    { provide: SystemSettingsService, useValue: settings },
    { provide: EventLedgerService, useValue: eventLedger },
    { provide: AgentSkillsService, useValue: agentSkillsStub },
    {
      // Mirrors `ImprovementModule`'s real `SkillAssignmentApplier` factory
      // (`improvement.module.ts`): `addScopedProfileSkill` is wired to the
      // REAL `AgentProfileSkillBindingService` so the scoped-binding write
      // this test asserts on goes through the actual production code path.
      // `addProfileSkills`/`removeProfileSkills` and both binding-gateway
      // methods are never expected to be called in this scenario (every
      // assignment target here is scope-qualified, and none are
      // `workflow_step`), so they throw loudly instead of silently
      // succeeding if a future change routes through them unexpectedly.
      provide: SkillAssignmentApplier,
      useFactory: (
        profileSkillBindings: AgentProfileSkillBindingService,
        proposals: ImprovementProposalRepository,
      ) => {
        const skillsGateway: SkillAssignmentApplierSkillsGateway = {
          skillExists: (name) => skillState.names.has(name),
          addProfileSkills: async () => {
            throw new Error(
              'unexpected addProfileSkills call: every target in this scenario is scope-qualified',
            );
          },
          addScopedProfileSkill: (input) =>
            profileSkillBindings.addProfileScopedBinding({
              profileName: input.profileName,
              skillName: input.skillName,
              scopeNodeId: input.scopeNodeId,
            }),
          removeProfileSkills: async () => {
            throw new Error(
              'unexpected removeProfileSkills call: this scenario never rolls back',
            );
          },
        };
        const bindingsGateway: SkillAssignmentApplierBindingsGateway = {
          addBinding: async () => {
            throw new Error(
              'unexpected addBinding call: this scenario has no workflow_step targets',
            );
          },
          removeBinding: async () => {
            throw new Error(
              'unexpected removeBinding call: this scenario never rolls back',
            );
          },
        };
        return new SkillAssignmentApplier(
          skillsGateway,
          bindingsGateway,
          proposals,
        );
      },
      inject: [AgentProfileSkillBindingService, ImprovementProposalRepository],
    },
    {
      provide: IMPROVEMENT_APPLIERS,
      useFactory: (applier: SkillAssignmentApplier) => [applier],
      inject: [SkillAssignmentApplier],
    },
  ];

  const moduleRef = await Test.createTestingModule({
    imports: [
      TypeOrmModule.forRoot(testDbConfig),
      TypeOrmModule.forFeature(ENTITIES),
    ],
    providers,
  }).compile();

  return { moduleRef, eventLedger, settings, skillState };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!DB_AVAILABLE)(
  'skill/learning scope model (integration): project and project+agent skill scoping',
  () => {
    let built: BuiltModule;
    let dataSource: DataSource;
    let scopeService: ScopeService;
    let agentProfileRepo: AgentProfileRepository;
    let agentSkillRepo: AgentSkillRepository;
    let bindingRepo: AgentProfileSkillBindingRepository;
    let improvementProposalService: ImprovementProposalService;
    let policyService: WorkflowStageSkillPolicyService;

    let scopeAId: string;
    let scopeBId: string;

    beforeEach(async () => {
      built = await buildModule();
      const { moduleRef } = built;

      dataSource = moduleRef.get(DataSource);
      scopeService = moduleRef.get(ScopeService);
      agentProfileRepo = moduleRef.get(AgentProfileRepository);
      agentSkillRepo = moduleRef.get(AgentSkillRepository);
      bindingRepo = moduleRef.get(AgentProfileSkillBindingRepository);
      improvementProposalService = moduleRef.get(ImprovementProposalService);
      policyService = moduleRef.get(WorkflowStageSkillPolicyService);

      await resetFixtures(dataSource);

      // ---- Step 1: two scope_nodes of type 'project' under the global root
      const org = await scopeService.createNode({
        id: ORG_SCOPE_ID,
        parentId: GLOBAL_SCOPE_NODE_ID,
        type: 'org',
        name: 'Skill Scope Test Org',
        slug: 'skill-scope-test-org',
      });
      const scopeA = await scopeService.createNode({
        id: SCOPE_A_ID,
        parentId: org.id,
        type: 'project',
        name: 'Skill Scope Test Project A',
        slug: 'skill-scope-test-project-a',
      });
      const scopeB = await scopeService.createNode({
        id: SCOPE_B_ID,
        parentId: org.id,
        type: 'project',
        name: 'Skill Scope Test Project B',
        slug: 'skill-scope-test-project-b',
      });
      scopeAId = scopeA.id;
      scopeBId = scopeB.id;

      // ---- two agent_profiles, no pre-existing skill assignments
      await agentProfileRepo.create({
        id: PROFILE_A_ID,
        name: PROFILE_A_NAME,
        source: 'admin',
        is_active: true,
      });
      await agentProfileRepo.create({
        id: PROFILE_B_ID,
        name: PROFILE_B_NAME,
        source: 'admin',
        is_active: true,
      });

      // ---- Step 2: one pre-existing AgentSkill named 'incident-response'
      await agentSkillRepo.create({
        name: SKILL_NAME,
        description: 'Handles production incident response.',
        skillMarkdown: `---\nname: ${SKILL_NAME}\ndescription: Handles production incident response.\n---\n# Incident Response\n`,
        source: 'admin',
      });

      const seededSkills = await agentSkillRepo.findAll();
      built.skillState.names = new Set(seededSkills.map((skill) => skill.name));
      built.skillState.records = seededSkills.map(toSkillLibraryRecord);

      built.eventLedger.reset();
      built.settings.get.mockClear();
    });

    afterEach(async () => {
      await built.moduleRef.close();
      vi.clearAllMocks();
    });

    it('scopes a skill_assignment proposal to its originating project and profile, invisible to a different project or a different profile', async () => {
      // ---- Step 3: submit a skill_assignment proposal scoped to
      // (scopeA, profile-a) with evidence/confidence sufficient for the
      // default `tiered` governance mode to auto-apply. `skill_assignment`
      // is in `TIERED_AUTO_APPLY_KINDS`, so any positive confidence within
      // the `struggle_backed` evidence-class cap (0.7) auto-applies.
      const result = await improvementProposalService.submitProposal({
        kind: 'skill_assignment',
        payload: {
          skillName: SKILL_NAME,
          assignment_targets: [
            { type: 'agent_profile', profileName: PROFILE_A_NAME },
          ],
        },
        evidence: { evidenceClass: 'struggle_backed' },
        confidence: 0.6,
        provenance: { scope_id: scopeAId },
      });

      // ---- Step 4: the proposal reaches status 'applied'
      expect(result.outcome).toBe('auto_applied');
      expect(result.proposal).not.toBeNull();
      expect(result.proposal?.status).toBe('applied');

      // Confirm the underlying write: a project+agent binding row exists
      // for (profile-a, scopeA) and nowhere else.
      const bindingForScopeA = await bindingRepo.findExisting({
        agentProfileId: PROFILE_A_ID,
        scopeNodeId: scopeAId,
        skillName: SKILL_NAME,
      });
      expect(bindingForScopeA).not.toBeNull();
      const bindingForScopeB = await bindingRepo.findExisting({
        agentProfileId: PROFILE_A_ID,
        scopeNodeId: scopeBId,
        skillName: SKILL_NAME,
      });
      expect(bindingForScopeB).toBeNull();

      // ---- Step 5: resolveAssignedSkills(profile-a, scopeA) includes the skill
      const forScopeA = await policyService.resolveAssignedSkills({
        agentProfile: PROFILE_A_NAME,
        scopeId: scopeAId,
      });
      expect(forScopeA.skills.map((skill) => skill.name)).toContain(SKILL_NAME);

      // ---- Step 6: resolveAssignedSkills(profile-a, scopeB) EXCLUDES the
      // skill — the exact bug this feature fixes: before this change, an
      // unscoped `skill_assignment` would have made the skill visible to
      // every project, not just the one it was proposed for.
      const forScopeB = await policyService.resolveAssignedSkills({
        agentProfile: PROFILE_A_NAME,
        scopeId: scopeBId,
      });
      expect(forScopeB.skills.map((skill) => skill.name)).not.toContain(
        SKILL_NAME,
      );

      // ---- Step 7: resolveAssignedSkills(profile-b, scopeA) EXCLUDES the
      // skill — proving the project+AGENT tier (not just the project tier)
      // is respected when the assignment target names a specific profile.
      const forProfileB = await policyService.resolveAssignedSkills({
        agentProfile: PROFILE_B_NAME,
        scopeId: scopeAId,
      });
      expect(forProfileB.skills.map((skill) => skill.name)).not.toContain(
        SKILL_NAME,
      );
    });

    // -------------------------------------------------------------------
    // Ancestor-inclusion coverage (plan Task 5, Step 2 — I1).
    //
    // Both cases grow a fresh two-hop branch off `ORG_SCOPE_ID`
    // (SCOPE_C -> TEAM -> ORG -> global — see the `TEAM_SCOPE_ID`/
    // `SCOPE_C_ID` doc comment above) so ancestor-inclusion is proven
    // across more than one hop, distinct from the pre-existing direct
    // ORG -> scope A/B parent relationship the main test above already
    // seeds.
    // -------------------------------------------------------------------

    it('resolves a project-tier skill_assignment binding from an ancestor scope one hop above the querying project (binding path — pre-existing ancestor-inclusion behavior)', async () => {
      await scopeService.createNode({
        id: TEAM_SCOPE_ID,
        parentId: ORG_SCOPE_ID,
        type: 'team',
        name: 'Skill Scope Test Team',
        slug: 'skill-scope-test-team',
      });
      await scopeService.createNode({
        id: SCOPE_C_ID,
        parentId: TEAM_SCOPE_ID,
        type: 'project',
        name: 'Skill Scope Test Project C',
        slug: 'skill-scope-test-project-c',
      });

      const bindingService = built.moduleRef.get(
        AgentProfileSkillBindingService,
      );
      await bindingService.addProjectScopedBinding({
        skillName: SKILL_NAME,
        scopeNodeId: TEAM_SCOPE_ID,
      });

      const forScopeC = await policyService.resolveAssignedSkills({
        agentProfile: PROFILE_A_NAME,
        scopeId: SCOPE_C_ID,
      });
      expect(forScopeC.skills.map((skill) => skill.name)).toContain(SKILL_NAME);
    });

    it('resolves a frontmatter scope.projects entry naming an ancestor scope from a descendant project scopeId (frontmatter path — Task 1 fix, real ScopeService.getAncestorIds)', async () => {
      await scopeService.createNode({
        id: TEAM_SCOPE_ID,
        parentId: ORG_SCOPE_ID,
        type: 'team',
        name: 'Skill Scope Test Team',
        slug: 'skill-scope-test-team',
      });
      await scopeService.createNode({
        id: SCOPE_C_ID,
        parentId: TEAM_SCOPE_ID,
        type: 'project',
        name: 'Skill Scope Test Project C',
        slug: 'skill-scope-test-project-c',
      });

      // `AgentSkillsService.listSkillsForScope` is stubbed for the rest of
      // this suite (see the file-level doc comment: standing up the real
      // file-based skill library for one fixture skill would drag in a
      // whole unrelated subsystem). This case is the one exception — it
      // exists specifically to prove the Task 1 fix
      // (`AgentSkillLibraryService.listSkillsForScope` ancestor-inclusion)
      // against the REAL `ScopeService.getAncestorIds`, so it stands up a
      // real `AgentSkillLibraryService` backed by a throwaway temp
      // directory and delegates the stub's `listSkillsForScope` to it for
      // the duration of this test only.
      const tempLibraryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'skill-scope-ancestor-test-'),
      );
      const previousLibraryPath = process.env.NEXUS_SKILLS_LIBRARY_PATH;
      process.env.NEXUS_SKILLS_LIBRARY_PATH = tempLibraryRoot;
      try {
        const skillLibrary = new AgentSkillLibraryService(
          new SkillIndexService(),
          scopeService,
        );
        skillLibrary.writeSkillMarkdown(
          ANCESTOR_SKILL_NAME,
          `---\nname: ${ANCESTOR_SKILL_NAME}\ndescription: Frontmatter-scoped ancestor test skill.\nscope:\n  projects:\n    - ${TEAM_SCOPE_ID}\n---\n# Ancestor Scoped Skill\n`,
        );

        const agentSkillsService = built.moduleRef.get(AgentSkillsService);
        const agentSkillsStub = agentSkillsService as unknown as {
          listSkillsForScope: Mock<AgentSkillsService['listSkillsForScope']>;
        };
        agentSkillsStub.listSkillsForScope.mockImplementation((context) =>
          skillLibrary.listSkillsForScope(context),
        );

        const forScopeC = await policyService.resolveAssignedSkills({
          agentProfile: PROFILE_A_NAME,
          scopeId: SCOPE_C_ID,
        });
        expect(forScopeC.skills.map((skill) => skill.name)).toContain(
          ANCESTOR_SKILL_NAME,
        );
      } finally {
        if (previousLibraryPath === undefined) {
          delete process.env.NEXUS_SKILLS_LIBRARY_PATH;
        } else {
          process.env.NEXUS_SKILLS_LIBRARY_PATH = previousLibraryPath;
        }
        fs.rmSync(tempLibraryRoot, { recursive: true, force: true });
      }
    });

    // -------------------------------------------------------------------
    // Stale/archived scope_id rejection coverage (plan Task 5, Step 3 —
    // I2), one test per call site.
    // -------------------------------------------------------------------

    it('rejects a binding write against an archived scope_id (AgentProfileSkillBindingService.addProjectScopedBinding, Task 2)', async () => {
      await scopeService.archiveNode(scopeBId);

      const bindingService = built.moduleRef.get(
        AgentProfileSkillBindingService,
      );
      await expect(
        bindingService.addProjectScopedBinding({
          skillName: SKILL_NAME,
          scopeNodeId: scopeBId,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('skips (never throws) the origin-scope frontmatter write when provenance.scope_id is archived (SkillCreateCompletionListener, Task 3 — fail-soft)', async () => {
      await scopeService.archiveNode(scopeBId);

      const mockRepo = {
        findById: vi.fn().mockResolvedValue({
          id: 'stale-scope-listener-proposal',
          kind: 'skill_create',
          status: 'applied',
          payload: { target_skill_name: SKILL_NAME },
          provenance: { scope_id: scopeBId },
          rollback_data: null,
        }),
        updateById: vi.fn().mockResolvedValue(undefined),
      };
      const mockSettingsService = {
        get: vi.fn().mockResolvedValue('manual'),
      };
      const mockSkillsService = {
        getSkill: vi.fn(),
        updateSkill: vi.fn(),
        addProfileSkillsByProfileName: vi.fn(),
      };
      const mockBindings = {
        addBinding: vi.fn(() => {
          throw new Error(
            'unexpected addBinding call: no workflow_step target',
          );
        }),
      };
      const mockProfileSkillBindings = {
        addProfileScopedBinding: vi.fn(() => {
          throw new Error(
            'unexpected addProfileScopedBinding call: no assignment target',
          );
        }),
      };

      const listener = new SkillCreateCompletionListener(
        mockRepo as unknown as ImprovementProposalRepository,
        mockSettingsService as unknown as SystemSettingsService,
        mockSkillsService as unknown as AgentSkillsService,
        mockBindings as unknown as WorkflowSkillBindingService,
        mockProfileSkillBindings as unknown as AgentProfileSkillBindingService,
        scopeService,
      );

      const event: WorkflowRunEvent = {
        workflowRunId: 'stale-scope-listener-run',
        workflowId: 'wf-stale-scope',
        status: 'COMPLETED',
        stateVariables: {
          trigger: { source_proposal_id: 'stale-scope-listener-proposal' },
          jobs: {
            author_skill: {
              output: { materialized: true },
            },
          },
        },
      };

      await expect(
        listener.handleWorkflowCompleted(event),
      ).resolves.toBeUndefined();

      expect(mockSkillsService.getSkill).not.toHaveBeenCalled();
      expect(mockSkillsService.updateSkill).not.toHaveBeenCalled();
    });

    it('throws BadRequestException confirming a recommended scope naming an archived project id (SkillScopeConfirmationService.confirm, Task 4 — fail-loud)', async () => {
      await scopeService.archiveNode(scopeBId);

      const improvementProposalRepo = built.moduleRef.get(
        ImprovementProposalRepository,
      );
      const proposal = await improvementProposalRepo.create({
        kind: 'skill_create',
        payload: { target_skill_name: SKILL_NAME },
        evidence: { evidenceClass: 'inference' },
        confidence: 0.5,
        provenance: {
          materialization: {
            scope_confirmation: {
              pending: true,
              recommended_scope: {
                projects: [scopeBId],
                agents: [],
                workflows: [],
              },
            },
          },
        },
      });

      const authzStub = {
        can: vi.fn(() => {
          throw new Error(
            'unexpected authz check: stale-scope guard must short-circuit first',
          );
        }),
      };
      const skillsServiceStub = {
        getSkill: vi.fn(() => {
          throw new Error(
            'unexpected getSkill call: stale-scope guard must short-circuit first',
          );
        }),
        updateSkill: vi.fn(() => {
          throw new Error(
            'unexpected updateSkill call: stale-scope guard must short-circuit first',
          );
        }),
      };

      const confirmationService = new SkillScopeConfirmationService(
        improvementProposalRepo,
        authzStub as unknown as AuthorizationService,
        skillsServiceStub as unknown as AgentSkillsService,
        scopeService,
      );

      await expect(
        confirmationService.confirm(proposal.id, 'test-user'),
      ).rejects.toThrow(BadRequestException);
      expect(authzStub.can).not.toHaveBeenCalled();
    });
  },
);
