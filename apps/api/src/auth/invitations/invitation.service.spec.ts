import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { Invitation } from './database/entities/invitation.entity';
import { InvitationStatus } from './invitation.status.types';
import { hashRefreshToken } from '../refresh-token-hash.util';
import { User } from '../../users/database/entities/user.entity';

// Fixed HMAC key for deterministic hashing in tests. 64 hex chars == 32 bytes,
// matching the SHA-256 digest length used by the HMAC utility (mirrors
// refresh-token.service.spec.ts's TEST_HMAC_KEY convention).
const TEST_HMAC_KEY = 'a'.repeat(64);

const ISSUER_USER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_SCOPE_NODE_ID = '22222222-2222-4222-8222-222222222222';
const ROLE_ID = '33333333-3333-4333-8333-333333333333';
const EXISTING_USER_ID = '44444444-4444-4444-8444-444444444444';
const NEW_USER_ID = '55555555-5555-4555-8555-555555555555';
const RAW_TOKEN = 'b'.repeat(128);
const TOKEN_HASH = hashRefreshToken(RAW_TOKEN, TEST_HMAC_KEY);
const GENERIC_INVITATION_ERROR = 'Invalid or expired invitation';

interface MockInvitationRepository {
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findOneBy: ReturnType<typeof vi.fn>;
  findPendingAtNode: ReturnType<typeof vi.fn>;
}

/**
 * The injected `InvitationRepository` is used by `createInvitation` (create +
 * save), by the best-effort expired self-heal (`update`, run AFTER the accept
 * transaction rolls back), by `revokeInvitation` (`findOneBy` + `save`), and by
 * `listInvitationsAtNode` (`findPendingAtNode`). The accept path's LOCKED load
 * runs through the transaction manager's repository instead (see the tx-scoped
 * mock below).
 */
function createMockInvitationRepository(): MockInvitationRepository {
  return {
    create: vi.fn((value: Partial<Invitation>) => value as Invitation),
    save: vi.fn(async (value: Invitation) => ({
      ...value,
      id: value.id ?? 'generated-invitation-id',
    })),
    update: vi.fn(async () => ({ affected: 1 })),
    findOneBy: vi.fn(async () => null),
    findPendingAtNode: vi.fn(async () => []),
  };
}

interface MockInvitationMailer {
  sendInvitationEmail: ReturnType<typeof vi.fn>;
}

/**
 * Mock of the optional {@link InvitationMailer} port (Task 8). Defaults to a
 * successful delivery so tests unrelated to email don't need to stub it;
 * individual `createInvitation` email tests override the resolved/rejected
 * value.
 */
function createMockInvitationMailer(): MockInvitationMailer {
  return {
    sendInvitationEmail: vi.fn(async () => ({ delivered: true })),
  };
}

interface MockScopeAccessService {
  getAccessibleScopeIds: ReturnType<typeof vi.fn>;
}

function createMockScopeAccessService(): MockScopeAccessService {
  return {
    getAccessibleScopeIds: vi.fn(),
  };
}

interface MockRoleAssignmentService {
  assignRole: ReturnType<typeof vi.fn>;
}

function createMockRoleAssignmentService(): MockRoleAssignmentService {
  return {
    assignRole: vi.fn(async () => ({})),
  };
}

interface MockPasswordHashingService {
  hash: ReturnType<typeof vi.fn>;
}

function createMockPasswordHashingService(): MockPasswordHashingService {
  return {
    hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  };
}

interface MockUserRepository {
  findById: ReturnType<typeof vi.fn>;
  findByUsername: ReturnType<typeof vi.fn>;
  findByEmail: ReturnType<typeof vi.fn>;
}

/**
 * The injected `UserRepository` only performs the duplicate-username/email
 * READS in `resolveAcceptingUserId`; the actual user WRITE now goes through the
 * transaction manager's repository (see `createMockTxUserRepository`).
 */
function createMockUserRepository(): MockUserRepository {
  return {
    findById: vi.fn(async () => null),
    findByUsername: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
  };
}

interface MockTxRepository {
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

/** Transaction-scoped `User` repo returned by `manager.getRepository(User)`. */
function createMockTxUserRepository(): MockTxRepository {
  return {
    create: vi.fn((value: Record<string, unknown>) => value),
    save: vi.fn(async (value: Record<string, unknown>) => ({
      ...value,
      id: NEW_USER_ID,
    })),
  };
}

/**
 * Chainable query-builder stub mirroring the fluent calls the service makes
 * for the LOCKED invitation load: `.setLock('pessimistic_write')` →
 * `.addSelect(...)` → `.where(...)` → `.getOne()`. `setLock`/`getOne` are spies
 * so tests can assert the row is read `FOR UPDATE` and control what it resolves.
 */
interface MockLockingQueryBuilder {
  setLock: ReturnType<typeof vi.fn>;
  addSelect: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
}

interface MockTxInvitationRepository {
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  createQueryBuilder: ReturnType<typeof vi.fn>;
  queryBuilder: MockLockingQueryBuilder;
}

/**
 * Transaction-scoped `Invitation` repo returned by
 * `manager.getRepository(Invitation)`. Exposes the locking query builder used
 * for the in-transaction load, and round-trips the row on `save` (returns the
 * same mutated instance) so tests can prove the single-use flip persists.
 */
function createMockTxInvitationRepository(): MockTxInvitationRepository {
  const queryBuilder: MockLockingQueryBuilder = {
    setLock: vi.fn(() => queryBuilder),
    addSelect: vi.fn(() => queryBuilder),
    where: vi.fn(() => queryBuilder),
    getOne: vi.fn(async () => null),
  };
  return {
    create: vi.fn((value: Partial<Invitation>) => value as Invitation),
    save: vi.fn(async (value: Invitation) => value),
    createQueryBuilder: vi.fn(() => queryBuilder),
    queryBuilder,
  };
}

interface MockEntityManager {
  getRepository: ReturnType<typeof vi.fn>;
}

function createMockEntityManager(
  txUserRepository: MockTxRepository,
  txInvitationRepository: MockTxInvitationRepository,
): MockEntityManager {
  return {
    getRepository: vi.fn((entity: unknown) => {
      if (entity === User) return txUserRepository;
      if (entity === Invitation) return txInvitationRepository;
      throw new Error('Unexpected entity requested from transaction manager');
    }),
  };
}

interface MockDataSource {
  transaction: ReturnType<typeof vi.fn>;
}

function createMockDataSource(manager: MockEntityManager): MockDataSource {
  return {
    transaction: vi.fn(async (cb: (m: MockEntityManager) => Promise<unknown>) =>
      cb(manager),
    ),
  };
}

/** Builds a persisted, still-pending invitation fixture, `RAW_TOKEN`-hashed. */
function pendingInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'invitation-id',
    tokenHash: TOKEN_HASH,
    scopeNodeId: TARGET_SCOPE_NODE_ID,
    roleId: ROLE_ID,
    email: null,
    invitedByUserId: ISSUER_USER_ID,
    status: InvitationStatus.Pending,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('InvitationService', () => {
  let repository: MockInvitationRepository;
  let scopeAccessService: MockScopeAccessService;
  let roleAssignmentService: MockRoleAssignmentService;
  let passwordHashingService: MockPasswordHashingService;
  let userRepository: MockUserRepository;
  let txUserRepository: MockTxRepository;
  let txInvitationRepository: MockTxInvitationRepository;
  let manager: MockEntityManager;
  let dataSource: MockDataSource;
  let mailer: MockInvitationMailer;
  let loggerSpies: Array<ReturnType<typeof vi.spyOn>>;
  let service: InvitationService;

  beforeEach(() => {
    repository = createMockInvitationRepository();
    scopeAccessService = createMockScopeAccessService();
    roleAssignmentService = createMockRoleAssignmentService();
    passwordHashingService = createMockPasswordHashingService();
    userRepository = createMockUserRepository();
    txUserRepository = createMockTxUserRepository();
    txInvitationRepository = createMockTxInvitationRepository();
    manager = createMockEntityManager(txUserRepository, txInvitationRepository);
    dataSource = createMockDataSource(manager);
    mailer = createMockInvitationMailer();
    loggerSpies = [
      vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
      vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined),
    ];
    service = new InvitationService(
      TEST_HMAC_KEY,
      repository as never,
      scopeAccessService as never,
      roleAssignmentService as never,
      passwordHashingService as never,
      userRepository as never,
      dataSource as never,
      mailer as never,
    );
  });

  describe('createInvitation', () => {
    it('creates a pending invitation with a hashed token when the issuer can manage the target scope', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);

      const beforeCall = Date.now();
      const { invitation, rawToken } = await service.createInvitation({
        scopeNodeId: TARGET_SCOPE_NODE_ID,
        roleId: ROLE_ID,
        email: 'invitee@example.com',
        invitedByUserId: ISSUER_USER_ID,
      });
      const afterCall = Date.now();

      expect(scopeAccessService.getAccessibleScopeIds).toHaveBeenCalledWith(
        ISSUER_USER_ID,
        'roles:manage',
      );

      // Raw token: crypto.randomBytes(64).toString('hex') => 128 hex chars.
      expect(rawToken).toMatch(/^[0-9a-f]{128}$/);

      // The persisted row must store the HASH, never the raw token.
      expect(repository.create).toHaveBeenCalledTimes(1);
      const createArg = repository.create.mock.calls[0][0] as Invitation;
      expect(createArg.tokenHash).toBe(
        hashRefreshToken(rawToken, TEST_HMAC_KEY),
      );
      expect(createArg.tokenHash).not.toBe(rawToken);
      expect(createArg).not.toHaveProperty('rawToken');

      expect(createArg.scopeNodeId).toBe(TARGET_SCOPE_NODE_ID);
      expect(createArg.roleId).toBe(ROLE_ID);
      expect(createArg.email).toBe('invitee@example.com');
      expect(createArg.invitedByUserId).toBe(ISSUER_USER_ID);
      expect(createArg.status).toBe(InvitationStatus.Pending);

      // expiresAt ~ now + DEFAULT_INVITATION_EXPIRY_DAYS (7 days), tolerant of
      // the small amount of wall-clock time the test itself takes.
      const msPerDay = 24 * 60 * 60 * 1000;
      const expiresAtMs = createArg.expiresAt.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(
        beforeCall + 7 * msPerDay - 1000,
      );
      expect(expiresAtMs).toBeLessThanOrEqual(afterCall + 7 * msPerDay + 1000);

      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(invitation.status).toBe(InvitationStatus.Pending);
    });

    it('throws ForbiddenException when the issuer lacks access to the target scope subtree', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([]);

      await expect(
        service.createInvitation({
          scopeNodeId: TARGET_SCOPE_NODE_ID,
          roleId: ROLE_ID,
          invitedByUserId: ISSUER_USER_ID,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the issuer only has access to unrelated scopes', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        '99999999-9999-4999-8999-999999999999',
      ]);

      await expect(
        service.createInvitation({
          scopeNodeId: TARGET_SCOPE_NODE_ID,
          roleId: ROLE_ID,
          invitedByUserId: ISSUER_USER_ID,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('sends an invitation email best-effort when the invitation has an email and a mailer is bound', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);
      mailer.sendInvitationEmail.mockResolvedValue({ delivered: true });

      const { invitation, rawToken, emailDelivery } =
        await service.createInvitation({
          scopeNodeId: TARGET_SCOPE_NODE_ID,
          roleId: ROLE_ID,
          email: 'invitee@example.com',
          invitedByUserId: ISSUER_USER_ID,
        });

      expect(mailer.sendInvitationEmail).toHaveBeenCalledWith({
        email: 'invitee@example.com',
        rawToken,
        scopeNodeId: TARGET_SCOPE_NODE_ID,
        roleId: ROLE_ID,
      });
      expect(emailDelivery).toEqual({ delivered: true });
      // The invitation is still persisted regardless of email delivery.
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(invitation.status).toBe(InvitationStatus.Pending);
    });

    it('never fails invitation creation when the mailer throws — returns invitation + rawToken with a non-fatal emailDelivery', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);
      mailer.sendInvitationEmail.mockRejectedValue(
        new Error('SMTP connection refused'),
      );

      const { invitation, rawToken, emailDelivery } =
        await service.createInvitation({
          scopeNodeId: TARGET_SCOPE_NODE_ID,
          roleId: ROLE_ID,
          email: 'invitee@example.com',
          invitedByUserId: ISSUER_USER_ID,
        });

      expect(invitation).toBeDefined();
      expect(rawToken).toMatch(/^[0-9a-f]{128}$/);
      expect(emailDelivery).toEqual({
        delivered: false,
        error: 'SMTP connection refused',
      });

      // The raw token must never appear in any logged call.
      for (const spy of loggerSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(rawToken);
        }
      }
    });

    it('skips email delivery without throwing when no mailer is bound, and logs an info-level fallback', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);
      const serviceWithoutMailer = new InvitationService(
        TEST_HMAC_KEY,
        repository as never,
        scopeAccessService as never,
        roleAssignmentService as never,
        passwordHashingService as never,
        userRepository as never,
        dataSource as never,
      );

      const { invitation, rawToken, emailDelivery } =
        await serviceWithoutMailer.createInvitation({
          scopeNodeId: TARGET_SCOPE_NODE_ID,
          roleId: ROLE_ID,
          email: 'invitee@example.com',
          invitedByUserId: ISSUER_USER_ID,
        });

      expect(invitation).toBeDefined();
      expect(rawToken).toMatch(/^[0-9a-f]{128}$/);
      expect(emailDelivery).toEqual({
        delivered: false,
        skippedReason: 'not_configured',
      });
      expect(
        loggerSpies.some((spy) =>
          spy.mock.calls.some((call: unknown[]) =>
            String(call[0]).includes('email delivery unavailable'),
          ),
        ),
      ).toBe(true);

      for (const spy of loggerSpies) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(rawToken);
        }
      }
    });

    it('does not call the mailer when the invitation has no email', async () => {
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);

      const { emailDelivery } = await service.createInvitation({
        scopeNodeId: TARGET_SCOPE_NODE_ID,
        roleId: ROLE_ID,
        invitedByUserId: ISSUER_USER_ID,
      });

      expect(mailer.sendInvitationEmail).not.toHaveBeenCalled();
      expect(emailDelivery).toEqual({
        delivered: false,
        skippedReason: 'not_configured',
      });
    });
  });

  describe('acceptInvitation', () => {
    it('existing logged-in user accepts a valid pending invite: assigns the role and marks the invitation accepted', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      const result = await service.acceptInvitation({
        rawToken: RAW_TOKEN,
        existingUserId: EXISTING_USER_ID,
      });

      // The whole accept runs inside a single transaction.
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      // The invitation is loaded THROUGH the transaction manager (not the
      // injected repository) under a pessimistic write lock, and matched on the
      // hashed token — this is what serializes concurrent accepts.
      expect(manager.getRepository).toHaveBeenCalledWith(Invitation);
      expect(txInvitationRepository.createQueryBuilder).toHaveBeenCalledTimes(
        1,
      );
      expect(txInvitationRepository.queryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(txInvitationRepository.queryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('tokenHash'),
        { tokenHash: TOKEN_HASH },
      );
      // assignRole receives the transaction manager as its trailing argument.
      expect(roleAssignmentService.assignRole).toHaveBeenCalledWith(
        EXISTING_USER_ID,
        ROLE_ID,
        TARGET_SCOPE_NODE_ID,
        EXISTING_USER_ID,
        manager,
      );
      // The invitation accept-write goes through the transaction manager's repo.
      expect(txInvitationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvitationStatus.Accepted,
          acceptedByUserId: EXISTING_USER_ID,
        }),
      );
      expect(result).toEqual({ userId: EXISTING_USER_ID });

      // Never provisions a new account on the existing-user path.
      expect(txUserRepository.create).not.toHaveBeenCalled();
      expect(passwordHashingService.hash).not.toHaveBeenCalled();
    });

    it('new person accepts: creates the account (password hashed) then assigns the role and marks the invitation accepted', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      const result = await service.acceptInvitation({
        rawToken: RAW_TOKEN,
        newUser: {
          username: 'new-invitee',
          password: 'correct-horse-battery-staple',
          email: 'invitee@example.com',
        },
      });

      expect(userRepository.findByUsername).toHaveBeenCalledWith('new-invitee');
      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        'invitee@example.com',
      );
      expect(passwordHashingService.hash).toHaveBeenCalledWith(
        'correct-horse-battery-staple',
      );

      // The new user is created through the transaction manager's repository,
      // and the raw password must never reach the persisted record.
      expect(txUserRepository.create).toHaveBeenCalledTimes(1);
      const createArg = txUserRepository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArg.passwordHash).toBe(
        'hashed:correct-horse-battery-staple',
      );
      expect(createArg.email).toBe('invitee@example.com');
      expect(createArg).not.toHaveProperty('password');

      expect(roleAssignmentService.assignRole).toHaveBeenCalledWith(
        NEW_USER_ID,
        ROLE_ID,
        TARGET_SCOPE_NODE_ID,
        NEW_USER_ID,
        manager,
      );
      expect(txInvitationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InvitationStatus.Accepted,
          acceptedByUserId: NEW_USER_ID,
        }),
      );
      expect(result).toEqual({ userId: NEW_USER_ID });
    });

    it('new person accepts with no supplied email: falls back to the invitation email for the created account', async () => {
      const invitation = pendingInvitation({
        email: 'from-invite@example.com',
      });
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      const result = await service.acceptInvitation({
        rawToken: RAW_TOKEN,
        newUser: {
          username: 'emailless-invitee',
          password: 'correct-horse-battery-staple',
        },
      });

      // Duplicate-email check and the created account both use the fallback.
      expect(userRepository.findByEmail).toHaveBeenCalledWith(
        'from-invite@example.com',
      );
      const createArg = txUserRepository.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(createArg.email).toBe('from-invite@example.com');
      expect(result).toEqual({ userId: NEW_USER_ID });
    });

    it('rejects a new-user accept when neither the payload nor the invitation carries an email', async () => {
      const invitation = pendingInvitation({ email: null });
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          newUser: {
            username: 'emailless-invitee',
            password: 'correct-horse-battery-staple',
          },
        }),
      ).rejects.toThrow(BadRequestException);

      expect(txUserRepository.save).not.toHaveBeenCalled();
      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a new-user accept when the username is already taken', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);
      userRepository.findByUsername.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          newUser: {
            username: 'taken-username',
            password: 'correct-horse-battery-staple',
            email: 'invitee@example.com',
          },
        }),
      ).rejects.toThrow(ConflictException);

      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
    });

    it('rejects a new-user accept when the email is already taken', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);
      userRepository.findByEmail.mockResolvedValue({ id: 'someone-else' });

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          newUser: {
            username: 'fresh-username',
            password: 'correct-horse-battery-staple',
            email: 'taken@example.com',
          },
        }),
      ).rejects.toThrow(ConflictException);

      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
    });

    it('rejects accepting the same token twice (single-use): the first accept mutates the row to accepted, and the SAME instance re-read on the second attempt fails uniformly', async () => {
      // Round-trip: the locked load always returns the same instance, and the
      // transaction-scoped save persists (returns) that mutated instance. So
      // after the first accept flips it to Accepted, the second locked read sees
      // the Accepted status and is rejected — proving true single-use. (A real
      // concurrent race is proven by the pessimistic_write lock; see the
      // dedicated lock test below and the recommended Postgres integration test.)
      const invitation = pendingInvitation();
      // mockResolvedValue returns the SAME instance on every call, so the
      // mutation the first accept applies is visible to the second read.
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      const first = await service.acceptInvitation({
        rawToken: RAW_TOKEN,
        existingUserId: EXISTING_USER_ID,
      });
      expect(first).toEqual({ userId: EXISTING_USER_ID });
      expect(invitation.status).toBe(InvitationStatus.Accepted);
      expect(invitation.acceptedByUserId).toBe(EXISTING_USER_ID);

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: 'someone-else-entirely',
        }),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: 'someone-else-entirely',
        }),
      ).rejects.toThrow(GENERIC_INVITATION_ERROR);

      // Only the FIRST accept granted a role; the replays never re-granted it,
      // and crucially never granted to the different second user.
      expect(roleAssignmentService.assignRole).toHaveBeenCalledTimes(1);
      expect(roleAssignmentService.assignRole).toHaveBeenCalledWith(
        EXISTING_USER_ID,
        ROLE_ID,
        TARGET_SCOPE_NODE_ID,
        EXISTING_USER_ID,
        manager,
      );
    });

    it('loads the invitation under a pessimistic_write row lock inside the transaction (serializes concurrent accepts)', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);

      await service.acceptInvitation({
        rawToken: RAW_TOKEN,
        existingUserId: EXISTING_USER_ID,
      });

      // The load is issued via the transaction manager's repository builder...
      expect(manager.getRepository).toHaveBeenCalledWith(Invitation);
      expect(txInvitationRepository.createQueryBuilder).toHaveBeenCalledTimes(
        1,
      );
      // ...with a FOR UPDATE lock, so a second concurrent transaction blocks on
      // this SELECT until the first commits and then sees status=accepted.
      expect(txInvitationRepository.queryBuilder.setLock).toHaveBeenCalledWith(
        'pessimistic_write',
      );
      expect(txInvitationRepository.queryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('tokenHash'),
        { tokenHash: TOKEN_HASH },
      );
    });

    it('rolls back atomically: if the invitation accept-write fails, the transaction rejects (and the role grant ran in the same manager that is rolled back)', async () => {
      const invitation = pendingInvitation();
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(invitation);
      txInvitationRepository.save.mockRejectedValue(
        new Error('db write failed'),
      );

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: EXISTING_USER_ID,
        }),
      ).rejects.toThrow('db write failed');

      // The role grant was issued inside the SAME transaction manager, so when
      // the invitation write throws the whole transaction rolls back together.
      expect(roleAssignmentService.assignRole).toHaveBeenCalledWith(
        EXISTING_USER_ID,
        ROLE_ID,
        TARGET_SCOPE_NODE_ID,
        EXISTING_USER_ID,
        manager,
      );
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('throws the generic error for an unknown token, without revealing that it does not exist', async () => {
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: EXISTING_USER_ID,
        }),
      ).rejects.toThrow(GENERIC_INVITATION_ERROR);

      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
    });

    it('throws the generic error for a revoked invitation, without revealing that it was revoked', async () => {
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(
        pendingInvitation({ status: InvitationStatus.Revoked }),
      );

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: EXISTING_USER_ID,
        }),
      ).rejects.toThrow(GENERIC_INVITATION_ERROR);

      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
    });

    it('throws the generic error for an expired invitation and durably self-heals status=expired via the injected repo AFTER the transaction rolls back', async () => {
      const expiredInvitation = pendingInvitation({
        id: 'expired-invitation-id',
        expiresAt: new Date(Date.now() - 1000),
      });
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(
        expiredInvitation,
      );

      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: EXISTING_USER_ID,
        }),
      ).rejects.toThrow(GENERIC_INVITATION_ERROR);

      // The self-heal flip must NOT be written inside the transaction (a throw
      // there rolls it back); it is applied durably by the injected repository
      // AFTER the transaction (and its FOR UPDATE lock) has unwound.
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('expired-invitation-id', {
        status: InvitationStatus.Expired,
      });
      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
    });

    it('still rejects an expired invitation with the uniform error even if the best-effort self-heal write fails', async () => {
      const expiredInvitation = pendingInvitation({
        id: 'expired-invitation-id',
        expiresAt: new Date(Date.now() - 1000),
      });
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(
        expiredInvitation,
      );
      repository.update.mockRejectedValue(new Error('self-heal write failed'));

      // The swallowed housekeeping failure must not leak — the caller still
      // sees the uniform generic rejection, never the DB error.
      await expect(
        service.acceptInvitation({
          rawToken: RAW_TOKEN,
          existingUserId: EXISTING_USER_ID,
        }),
      ).rejects.toThrow(GENERIC_INVITATION_ERROR);
    });

    it('rejects a new-user accept when neither existingUserId nor newUser is supplied', async () => {
      txInvitationRepository.queryBuilder.getOne.mockResolvedValue(
        pendingInvitation(),
      );

      await expect(
        service.acceptInvitation({ rawToken: RAW_TOKEN }),
      ).rejects.toThrow(BadRequestException);

      expect(roleAssignmentService.assignRole).not.toHaveBeenCalled();
      expect(txInvitationRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('revokeInvitation', () => {
    it('revokes a pending invitation when the actor can manage its scope subtree', async () => {
      const invitation = pendingInvitation();
      repository.findOneBy.mockResolvedValue(invitation);
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);

      await service.revokeInvitation(invitation.id, ISSUER_USER_ID);

      expect(repository.findOneBy).toHaveBeenCalledWith({ id: invitation.id });
      expect(scopeAccessService.getAccessibleScopeIds).toHaveBeenCalledWith(
        ISSUER_USER_ID,
        'roles:manage',
      );
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: InvitationStatus.Revoked }),
      );
    });

    it('throws NotFoundException when the invitation id does not exist', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await expect(
        service.revokeInvitation('missing-invitation-id', ISSUER_USER_ID),
      ).rejects.toThrow(NotFoundException);

      expect(scopeAccessService.getAccessibleScopeIds).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the actor lacks subtree access to the invitation scope', async () => {
      const invitation = pendingInvitation();
      repository.findOneBy.mockResolvedValue(invitation);
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([]);

      await expect(
        service.revokeInvitation(invitation.id, ISSUER_USER_ID),
      ).rejects.toThrow(ForbiddenException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the invitation is not pending (already accepted)', async () => {
      const invitation = pendingInvitation({
        status: InvitationStatus.Accepted,
      });
      repository.findOneBy.mockResolvedValue(invitation);
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);

      await expect(
        service.revokeInvitation(invitation.id, ISSUER_USER_ID),
      ).rejects.toThrow(ConflictException);

      expect(repository.save).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the invitation is already revoked', async () => {
      const invitation = pendingInvitation({
        status: InvitationStatus.Revoked,
      });
      repository.findOneBy.mockResolvedValue(invitation);
      scopeAccessService.getAccessibleScopeIds.mockResolvedValue([
        TARGET_SCOPE_NODE_ID,
      ]);

      await expect(
        service.revokeInvitation(invitation.id, ISSUER_USER_ID),
      ).rejects.toThrow(ConflictException);

      expect(repository.save).not.toHaveBeenCalled();
    });
  });

  describe('listInvitationsAtNode', () => {
    it('delegates to repository.findPendingAtNode and returns its result', async () => {
      const invitations = [
        pendingInvitation(),
        pendingInvitation({ id: 'invitation-2' }),
      ];
      repository.findPendingAtNode.mockResolvedValue(invitations);

      const result = await service.listInvitationsAtNode(TARGET_SCOPE_NODE_ID);

      expect(repository.findPendingAtNode).toHaveBeenCalledWith(
        TARGET_SCOPE_NODE_ID,
      );
      expect(result).toBe(invitations);
    });
  });
});
