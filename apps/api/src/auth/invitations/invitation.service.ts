import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InvitationRepository } from './database/repositories/invitation.repository';
import { Invitation } from './database/entities/invitation.entity';
import { InvitationStatus } from './invitation.status.types';
import { DEFAULT_INVITATION_EXPIRY_DAYS } from './invitation.constants';
import {
  AcceptInvitationInput,
  CreateInvitationInput,
} from './invitation.types';
import { REFRESH_TOKEN_HMAC_KEY } from '../refresh-token-key.provider';
import { hashRefreshToken } from '../refresh-token-hash.util';
import { ScopeAccessService } from '../authorization/scope-access.service';
import { RoleAssignmentService } from '../authorization/role-assignment.service';
import { PasswordHashingService } from '../password-hashing.service';
import { UserRepository } from '../../users/database/repositories/user.repository';
import { User } from '../../users/database/entities/user.entity';
import {
  INVITATION_MAILER,
  type InvitationDeliveryResult,
  type InvitationMailer,
} from './invitation-mailer.port';

/** Permission an issuer must hold on the target scope subtree to invite there. */
const SCOPE_MANAGE_PERMISSION = 'roles:manage';

/** Byte length of the raw invitation token before hex-encoding (128 hex chars). */
const INVITATION_TOKEN_BYTE_LENGTH = 64;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Single uniform message for every unacceptable-token outcome (unknown,
 * expired, revoked, already accepted). Never distinguish these to the
 * caller — differing messages would let an attacker enumerate which raw
 * tokens exist.
 */
const INVALID_OR_EXPIRED_INVITATION_MESSAGE = 'Invalid or expired invitation';

/**
 * Non-fatal fallback delivery result used whenever email notification is not
 * attempted at all — no `INVITATION_MAILER` is bound (email is opt-in), or
 * the invitation carries no email address. The invitation + copyable accept
 * link are unaffected either way.
 */
const EMAIL_DELIVERY_NOT_CONFIGURED: InvitationDeliveryResult = {
  delivered: false,
  skippedReason: 'not_configured',
};

/**
 * Internal sentinel thrown from inside the accept transaction when the locked
 * invitation is past its expiry. It carries the row id so the caller can
 * roll the transaction back (releasing the `FOR UPDATE` lock) and THEN perform
 * a durable, best-effort status flip outside the transaction. It never escapes
 * the service — the outer handler converts it to the uniform public error.
 */
class ExpiredInvitationError extends Error {
  constructor(readonly invitationId: string) {
    super('invitation expired');
    this.name = 'ExpiredInvitationError';
  }
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @Inject(REFRESH_TOKEN_HMAC_KEY) private readonly hmacKey: string,
    private readonly invitationRepository: InvitationRepository,
    private readonly scopeAccessService: ScopeAccessService,
    private readonly roleAssignmentService: RoleAssignmentService,
    private readonly passwordHashingService: PasswordHashingService,
    private readonly userRepository: UserRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional()
    @Inject(INVITATION_MAILER)
    private readonly mailer?: InvitationMailer,
  ) {}

  /**
   * Creates a single-use invitation at `input.scopeNodeId`. The raw token is
   * generated here and returned exactly once; only its HMAC hash is
   * persisted, so it can never be recovered from the database or logs.
   */
  async createInvitation(input: CreateInvitationInput): Promise<{
    invitation: Invitation;
    rawToken: string;
    emailDelivery: InvitationDeliveryResult;
  }> {
    await this.assertIssuerCanManageScope(
      input.invitedByUserId,
      input.scopeNodeId,
    );

    const rawToken = crypto
      .randomBytes(INVITATION_TOKEN_BYTE_LENGTH)
      .toString('hex');
    const tokenHash = hashRefreshToken(rawToken, this.hmacKey);
    const expiresAt = new Date(
      Date.now() + DEFAULT_INVITATION_EXPIRY_DAYS * MS_PER_DAY,
    );

    const invitation = await this.invitationRepository.save(
      this.invitationRepository.create({
        tokenHash,
        scopeNodeId: input.scopeNodeId,
        roleId: input.roleId,
        email: input.email ?? null,
        invitedByUserId: input.invitedByUserId,
        status: InvitationStatus.Pending,
        expiresAt,
      }),
    );

    const emailDelivery = await this.deliverInvitationEmailBestEffort(
      invitation,
      rawToken,
    );

    return { invitation, rawToken, emailDelivery };
  }

  /**
   * Sends the invitation notification email through the optional
   * {@link INVITATION_MAILER} port, if bound and if the invitation has an
   * email address — and NEVER lets that attempt fail invitation creation.
   *
   * Defense in depth: even though {@link InvitationMailer.sendInvitationEmail}
   * (the `InvitationEmailService` implementation) is itself documented to
   * never throw, this wraps the call in its own try/catch so a mailer
   * implementation that throws (e.g. from an unguarded config/link-building
   * step) can never propagate out of `createInvitation`. The invitation and
   * its raw token are always returned regardless of the outcome here, and the
   * raw token is never included in any log line.
   */
  private async deliverInvitationEmailBestEffort(
    invitation: Invitation,
    rawToken: string,
  ): Promise<InvitationDeliveryResult> {
    if (!invitation.email || !this.mailer) {
      this.logger.log(
        'Invitation created; email delivery unavailable — link-only fallback',
      );
      return EMAIL_DELIVERY_NOT_CONFIGURED;
    }

    try {
      const emailDelivery = await this.mailer.sendInvitationEmail({
        email: invitation.email,
        rawToken,
        scopeNodeId: invitation.scopeNodeId,
        roleId: invitation.roleId,
      });
      if (!emailDelivery.delivered) {
        this.logger.log(
          'Invitation created; email not delivered — copyable link remains valid',
        );
      }
      return emailDelivery;
    } catch (error) {
      this.logger.error(
        `Invitation email delivery threw: ${(error as Error).message}`,
      );
      return { delivered: false, error: (error as Error).message };
    }
  }

  /**
   * Accepts a single-use invitation token: validates it, resolves the
   * accepting user (an already-logged-in user or a brand-new account),
   * grants the invitation's role at its scope, and marks the invitation
   * accepted so the same token can never be redeemed twice.
   *
   * The invitation load, user creation, role grant, and invitation-accept write
   * all run inside ONE DB transaction and the row is read under a
   * `pessimistic_write` lock (`SELECT ... FOR UPDATE`). This upholds the
   * single-use invariant even under a CONCURRENT double-accept: the second
   * transaction blocks on the locked row until the first commits, then re-reads
   * `status = accepted` and is rejected. Without the in-transaction lock two
   * accepts racing on the same still-pending token could both pass the validity
   * check and both commit the role grant.
   *
   * Expiry handling: an expired invitation cannot be self-healed inside the
   * transaction, because throwing to reject it also rolls back any status write.
   * Instead the load throws {@link ExpiredInvitationError} (rolling the
   * transaction back and releasing the lock), and this method then performs a
   * durable, best-effort `status = Expired` flip through the injected repository
   * AFTER the lock is gone, before rethrowing the uniform public error.
   */
  async acceptInvitation(
    input: AcceptInvitationInput,
  ): Promise<{ userId: string }> {
    const tokenHash = hashRefreshToken(input.rawToken, this.hmacKey);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const invitationRepository = manager.getRepository(Invitation);
        const invitation = await this.loadAcceptableInvitation(
          invitationRepository,
          tokenHash,
        );

        const userId = await this.resolveAcceptingUserId(
          input,
          invitation,
          manager,
        );

        await this.roleAssignmentService.assignRole(
          userId,
          invitation.roleId,
          invitation.scopeNodeId,
          userId,
          manager,
        );

        invitation.status = InvitationStatus.Accepted;
        invitation.acceptedByUserId = userId;
        await invitationRepository.save(invitation);

        return { userId };
      });
    } catch (error) {
      if (error instanceof ExpiredInvitationError) {
        await this.markInvitationExpired(error.invitationId);
        throw new NotFoundException(INVALID_OR_EXPIRED_INVITATION_MESSAGE);
      }
      throw error;
    }
  }

  /**
   * Loads the invitation for the given token hash UNDER A ROW WRITE LOCK
   * (`pessimistic_write` → `SELECT ... FOR UPDATE`) via the transaction's
   * repository, then enforces the single-use, not-expired, not-revoked
   * contract. Locking inside the transaction serializes concurrent accepts on
   * the same row: a racing transaction blocks here until the holder commits and
   * then observes the terminal status.
   *
   * Unknown / non-pending (revoked / already-accepted) tokens throw the SAME
   * generic error (see `INVALID_OR_EXPIRED_INVITATION_MESSAGE`) so a caller
   * can't distinguish them and enumerate valid tokens. An EXPIRED token instead
   * throws {@link ExpiredInvitationError} so the caller can roll the transaction
   * back and self-heal outside it (see {@link acceptInvitation}); the caller
   * still surfaces the identical uniform error to the outside world.
   */
  private async loadAcceptableInvitation(
    invitationRepository: Repository<Invitation>,
    tokenHash: string,
  ): Promise<Invitation> {
    const invitation = await invitationRepository
      .createQueryBuilder('i')
      .setLock('pessimistic_write')
      .addSelect('i.tokenHash')
      .where('i.tokenHash = :tokenHash', { tokenHash })
      .getOne();

    if (!invitation || invitation.status !== InvitationStatus.Pending) {
      throw new NotFoundException(INVALID_OR_EXPIRED_INVITATION_MESSAGE);
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new ExpiredInvitationError(invitation.id);
    }

    return invitation;
  }

  /**
   * Best-effort, durable status flip for an invitation found expired during an
   * accept. Runs AFTER the accept transaction has rolled back (so the row's
   * `FOR UPDATE` lock is released — updating the still-locked row from a second
   * connection would self-deadlock). Housekeeping only: the expiry REJECTION has
   * already happened, so any failure here is swallowed rather than masking it.
   */
  private async markInvitationExpired(invitationId: string): Promise<void> {
    try {
      await this.invitationRepository.update(invitationId, {
        status: InvitationStatus.Expired,
      });
    } catch {
      // Intentionally swallowed: the caller has already rejected the expired
      // token, and this terminal-status flip is non-critical housekeeping a
      // future reaper can also perform.
    }
  }

  /**
   * Resolves which user id the invitation's role grant lands on: reuses the
   * caller-supplied logged-in user id, or provisions a brand-new account
   * (rejecting a duplicate username/email, and hashing the password before
   * it ever touches persistence — the raw password is never logged). New-user
   * creation runs through the supplied transaction `manager` so it commits or
   * rolls back atomically with the rest of the accept.
   */
  private async resolveAcceptingUserId(
    input: AcceptInvitationInput,
    invitation: Invitation,
    manager: EntityManager,
  ): Promise<string> {
    if (input.existingUserId) {
      return input.existingUserId;
    }

    if (!input.newUser) {
      throw new BadRequestException(
        'newUser is required when existingUserId is not supplied',
      );
    }

    const { username, password } = input.newUser;
    // `User.email` is NOT NULL: fall back to the invitation's own email when
    // the accept payload omits one, and reject cleanly (never a raw DB error)
    // when neither is available.
    const email = input.newUser.email ?? invitation.email;
    if (!email) {
      throw new BadRequestException(
        'An email is required to create an account for this invitation',
      );
    }

    if (await this.userRepository.findByUsername(username)) {
      throw new ConflictException('Username already exists');
    }
    if (await this.userRepository.findByEmail(email)) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await this.passwordHashingService.hash(password);
    const userRepository = manager.getRepository(User);
    const user = await userRepository.save(
      userRepository.create({ username, email, passwordHash }),
    );

    return user.id;
  }

  /**
   * Revokes a still-pending invitation: only an actor who can manage the
   * invitation's scope subtree may revoke it (same subtree bound as
   * {@link createInvitation}). Rejects a non-existent id with
   * `NotFoundException`, and rejects an invitation that has already left the
   * pending state (accepted / revoked / expired) with `ConflictException` —
   * revoking is only meaningful once, against a still-live invite.
   */
  async revokeInvitation(id: string, actorUserId: string): Promise<void> {
    const invitation = await this.invitationRepository.findOneBy({ id });
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    await this.assertIssuerCanManageScope(actorUserId, invitation.scopeNodeId);

    if (invitation.status !== InvitationStatus.Pending) {
      throw new ConflictException('Invitation is not pending');
    }

    invitation.status = InvitationStatus.Revoked;
    await this.invitationRepository.save(invitation);
  }

  /**
   * Lists the pending invitations at a scope node for the management UI.
   * Delegates to {@link InvitationRepository.findPendingAtNode}, which never
   * selects the `tokenHash` column (`select: false` on the entity), so the raw
   * token hash can never reach a list response.
   */
  async listInvitationsAtNode(scopeNodeId: string): Promise<Invitation[]> {
    return this.invitationRepository.findPendingAtNode(scopeNodeId);
  }

  /** Reused by revoke: throws unless `userId` can manage `scopeNodeId`'s subtree. */
  private async assertIssuerCanManageScope(
    userId: string,
    scopeNodeId: string,
  ): Promise<void> {
    const accessibleScopeIds =
      await this.scopeAccessService.getAccessibleScopeIds(
        userId,
        SCOPE_MANAGE_PERMISSION,
      );
    if (!accessibleScopeIds.includes(scopeNodeId)) {
      throw new ForbiddenException('Not allowed to invite at this scope');
    }
  }
}
