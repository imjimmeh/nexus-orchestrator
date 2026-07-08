/**
 * Integration test for {@link InvitationService.acceptInvitation}'s
 * single-use invariant under CONCURRENT accept calls.
 *
 * Multi-tenant scopes follow-up (Phase 2 pessimistic-lock fix): the accept
 * path reads the invitation row inside a transaction under
 * `setLock('pessimistic_write')` (`SELECT ... FOR UPDATE`). Two accept calls
 * racing on the SAME still-pending token must serialize on that lock: the
 * second transaction blocks until the first commits, then re-reads
 * `status = accepted` and is rejected — never both committing a role grant.
 *
 * Why a real DB (and not a hand-rolled in-memory fake): the property under
 * test IS the Postgres row lock. An in-memory mock of `dataSource.transaction`
 * cannot reproduce blocking-on-a-locked-row semantics, so faking it would
 * only prove the mock's own scripted behaviour, not the actual guarantee.
 *
 * DB safety: mirrors `memory-drift-detection.integration.spec.ts` and
 * `gitops/reconciliation.integration.spec.ts` — the suite runs ONLY against a
 * dedicated throwaway Postgres pointed to by `INTEGRATION_TEST_DATABASE_URL`
 * (CI provisions one). Absent that var the suite is skipped entirely via
 * `describe.skipIf(...)`, so `npm run test:api` / a bare `vitest run` on a
 * dev machine can never race-write against live data. `assertNotApplicationDatabase`
 * is a belt-and-suspenders guard that aborts if the URL happens to resolve to
 * the application database.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

import { InvitationService } from './invitation.service';
import { InvitationRepository } from './database/repositories/invitation.repository';
import { Invitation } from './database/entities/invitation.entity';
import { InvitationStatus } from './invitation.status.types';
import { ScopeAccessService } from '../authorization/scope-access.service';
import { RoleAssignmentService } from '../authorization/role-assignment.service';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { Role } from '../database/entities/role.entity';
import { RolePermission } from '../database/entities/role-permission.entity';
import { Permission } from '../database/entities/permission.entity';
import { UserRole } from '../database/entities/user-role.entity';
import { PasswordHashingService } from '../password-hashing.service';
import { REFRESH_TOKEN_HMAC_KEY } from '../refresh-token-key.provider';
import { hashRefreshToken } from '../refresh-token-hash.util';
import { UserRepository } from '../../users/database/repositories/user.repository';
import { User } from '../../users/database/entities/user.entity';
import { RefreshToken } from '../../security/database/entities/refresh-token.entity';
import { ScopeNode } from '../../scope/database/entities/scope-node.entity';
import { GLOBAL_SCOPE_NODE_ID } from '../../scope/scope.constants';
import { registeredMigrations } from '../../database/migrations/registered-migrations';

// ---------------------------------------------------------------------------
// DB availability gate — see file-level doc comment.
// ---------------------------------------------------------------------------
const INTEGRATION_TEST_DATABASE_URL =
  process.env['INTEGRATION_TEST_DATABASE_URL'];
const DB_AVAILABLE = Boolean(INTEGRATION_TEST_DATABASE_URL);

/**
 * Full transitive closure of entities reachable from `Invitation` /
 * `RoleAssignment` via TypeORM relation decorators. TypeORM's metadata
 * builder resolves a relation's target class at connection-build time, so
 * every entity referenced by a `@ManyToOne`/`@OneToMany` anywhere in this
 * closure must also be registered here — omitting one throws "Entity
 * metadata ... was not found" when the connection initializes.
 */
const ENTITIES = [
  User,
  RefreshToken,
  UserRole,
  Role,
  RolePermission,
  Permission,
  RoleAssignment,
  ScopeNode,
  Invitation,
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
 * `memory-drift-detection.integration.spec.ts` / `gitops/reconciliation.integration.spec.ts`.
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
// Fixture constants — fixed UUIDs so cleanup can target exact rows and a
// crashed prior run's leftovers are simply overwritten (delete-then-insert).
// ---------------------------------------------------------------------------
const TEST_HMAC_KEY = 'a'.repeat(64);
const RAW_TOKEN = 'd'.repeat(128);
const TOKEN_HASH = hashRefreshToken(RAW_TOKEN, TEST_HMAC_KEY);

const SCOPE_NODE_ID = '90000000-0000-4000-8000-000000000001';
const ROLE_ID = '90000000-0000-4000-8000-000000000002';
const INVITER_USER_ID = '90000000-0000-4000-8000-000000000003';
const ACCEPTER_A_ID = '90000000-0000-4000-8000-000000000004';
const ACCEPTER_B_ID = '90000000-0000-4000-8000-000000000005';
const INVITATION_ID = '90000000-0000-4000-8000-000000000006';

describe.skipIf(!DB_AVAILABLE)(
  'InvitationService.acceptInvitation concurrent accept (integration)',
  () => {
    let moduleRef: TestingModule;
    let dataSource: DataSource;
    let invitationService: InvitationService;
    let invitationRepository: Repository<Invitation>;
    let roleAssignmentRepository: Repository<RoleAssignment>;

    beforeAll(async () => {
      if (!DB_AVAILABLE) return;

      moduleRef = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot(testDbConfig),
          TypeOrmModule.forFeature(ENTITIES),
        ],
        providers: [
          InvitationService,
          // Real repository/services — the transaction, the pessimistic
          // lock, and the role-assignment unique index are the exact
          // production code path under test.
          InvitationRepository,
          RoleAssignmentService,
          ScopeAccessService,
          UserRepository,
          { provide: REFRESH_TOKEN_HMAC_KEY, useValue: TEST_HMAC_KEY },
          // Stubbed: `acceptInvitation` only reaches `PasswordHashingService`
          // on the brand-new-account branch. This test exercises the
          // `existingUserId` branch for both racing accepters, so the real
          // bcrypt-backed service (which needs `ConfigService`) is
          // unnecessary — hashing is orthogonal to the lock behaviour under
          // test.
          {
            provide: PasswordHashingService,
            useValue: {
              hash: async () => {
                throw new Error(
                  'PasswordHashingService.hash should not be called on the existingUserId accept branch',
                );
              },
              verify: async () => false,
            },
          },
        ],
      }).compile();

      dataSource = moduleRef.get(DataSource);
      await assertNotApplicationDatabase(dataSource);

      invitationService = moduleRef.get(InvitationService);
      invitationRepository = moduleRef.get<Repository<Invitation>>(
        getRepositoryToken(Invitation),
      );
      roleAssignmentRepository = moduleRef.get<Repository<RoleAssignment>>(
        getRepositoryToken(RoleAssignment),
      );
    });

    afterAll(async () => {
      await dataSource?.destroy();
    });

    /**
     * Deletes only the exact rows this suite owns, in FK-safe (child-before-
     * parent) order. Used both to clean up after a run and, defensively, at
     * the start of `beforeEach` so a previous crashed run's leftovers never
     * collide with this run's fixed ids.
     */
    async function deleteFixtureRows(): Promise<void> {
      await dataSource.query(
        `DELETE FROM "role_assignments" WHERE "scope_node_id" = $1`,
        [SCOPE_NODE_ID],
      );
      await dataSource.query(`DELETE FROM "invitations" WHERE "id" = $1`, [
        INVITATION_ID,
      ]);
      await dataSource.query(`DELETE FROM "users" WHERE "id" IN ($1, $2, $3)`, [
        INVITER_USER_ID,
        ACCEPTER_A_ID,
        ACCEPTER_B_ID,
      ]);
      await dataSource.query(`DELETE FROM "roles" WHERE "id" = $1`, [ROLE_ID]);
      await dataSource.query(`DELETE FROM "scope_nodes" WHERE "id" = $1`, [
        SCOPE_NODE_ID,
      ]);
    }

    async function seedFixture(): Promise<void> {
      await dataSource.query(
        `INSERT INTO "scope_nodes" (id, parent_id, type, name, slug)
         VALUES ($1, $2, 'project', 'Concurrent Accept Test Project', 'concurrent-accept-test')`,
        [SCOPE_NODE_ID, GLOBAL_SCOPE_NODE_ID],
      );
      await dataSource.query(
        `INSERT INTO "roles" (id, name, description)
         VALUES ($1, 'concurrent-accept-test-role', 'Role granted by the concurrent-accept invitation fixture')`,
        [ROLE_ID],
      );
      await dataSource.query(
        `INSERT INTO "users" (id, username, email, password_hash)
         VALUES
           ($1, 'concurrent-accept-inviter', 'concurrent-accept-inviter@example.test', 'unused-hash'),
           ($2, 'concurrent-accept-a', 'concurrent-accept-a@example.test', 'unused-hash'),
           ($3, 'concurrent-accept-b', 'concurrent-accept-b@example.test', 'unused-hash')`,
        [INVITER_USER_ID, ACCEPTER_A_ID, ACCEPTER_B_ID],
      );

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await invitationRepository.insert(
        invitationRepository.create({
          id: INVITATION_ID,
          tokenHash: TOKEN_HASH,
          scopeNodeId: SCOPE_NODE_ID,
          roleId: ROLE_ID,
          email: null,
          invitedByUserId: INVITER_USER_ID,
          status: InvitationStatus.Pending,
          expiresAt,
          acceptedByUserId: null,
        }),
      );
    }

    beforeEach(async () => {
      await deleteFixtureRows();
      await seedFixture();
    });

    afterEach(async () => {
      await deleteFixtureRows();
    });

    it('accepts a single-use invitation exactly once when two different users race to accept it concurrently', async () => {
      // Act: fire both accepts concurrently for the SAME still-pending token,
      // as two DIFFERENT prospective members racing for the one open seat.
      // The lock in `loadAcceptableInvitation` (`setLock('pessimistic_write')`)
      // is what must prevent BOTH from landing a role grant.
      const [resultA, resultB] = await Promise.allSettled([
        invitationService.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: ACCEPTER_A_ID,
        }),
        invitationService.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: ACCEPTER_B_ID,
        }),
      ]);

      // Assert: exactly one call succeeds, exactly one fails cleanly with the
      // uniform "invalid or expired" NotFoundException (never a crash, never
      // both succeeding).
      const settled = [resultA, resultB];
      const fulfilled = settled.filter(
        (r): r is PromiseFulfilledResult<{ userId: string }> =>
          r.status === 'fulfilled',
      );
      const rejected = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(NotFoundException);

      const winnerUserId = fulfilled[0].value.userId;
      expect([ACCEPTER_A_ID, ACCEPTER_B_ID]).toContain(winnerUserId);
      const loserUserId =
        winnerUserId === ACCEPTER_A_ID ? ACCEPTER_B_ID : ACCEPTER_A_ID;

      // Exactly ONE role_assignment row was created for this invitation's
      // role/scope, and it belongs to the winner — not the loser, not both.
      const assignments = await roleAssignmentRepository.find({
        where: { roleId: ROLE_ID, scopeNodeId: SCOPE_NODE_ID },
      });
      expect(assignments).toHaveLength(1);
      expect(assignments[0].userId).toBe(winnerUserId);

      const loserAssignments = await roleAssignmentRepository.find({
        where: {
          userId: loserUserId,
          roleId: ROLE_ID,
          scopeNodeId: SCOPE_NODE_ID,
        },
      });
      expect(loserAssignments).toHaveLength(0);

      // The invitation itself lands in the terminal `accepted` state exactly
      // once, attributed to the winner.
      const persistedInvitation = await invitationRepository.findOne({
        where: { id: INVITATION_ID },
      });
      expect(persistedInvitation?.status).toBe(InvitationStatus.Accepted);
      expect(persistedInvitation?.acceptedByUserId).toBe(winnerUserId);
    });
  },
);
