import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';
import { PublicInvitationController } from './public-invitation.controller';
import { InvitationRepository } from './database/repositories/invitation.repository';
import { ScopeAccessService } from '../authorization/scope-access.service';
import { RoleAssignmentService } from '../authorization/role-assignment.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionsGuard } from '../authorization/permissions.guard';
import { EnforcementModeService } from '../authorization/enforcement-mode.service';
import { RoleAssignment } from '../database/entities/role-assignment.entity';
import { PasswordHashingService } from '../password-hashing.service';
import { TokenService } from '../token.service';
import { RefreshTokenService } from '../refresh-token.service';
import { UserRepository } from '../../users/database/repositories/user.repository';
import { REFRESH_TOKEN_HMAC_KEY } from '../refresh-token-key.provider';

/**
 * Mirrors `authorization.module.spec.ts`: rather than importing the real
 * `InvitationModule` (which would transitively pull in `DatabaseModule`'s
 * `TypeOrmModule.forRootAsync()` and attempt a live Postgres connection at
 * `compile()` time), this reconstructs the exact provider graph
 * `InvitationModule` wires — `InvitationService` plus both controllers —
 * with lightweight mocks standing in for each of their dependencies. This
 * proves every dependency `InvitationModule`'s providers/controllers declare
 * actually resolves, guarding against the WorkflowCoreModule-style DI crash
 * noted in project memory (a provider whose full dependency graph was never
 * exercised until a live boot).
 */
describe('InvitationModule', () => {
  it('resolves InvitationService and both controllers end-to-end', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InvitationController, PublicInvitationController],
      providers: [
        InvitationService,
        // `InvitationController` carries `@UseGuards(JwtAuthGuard, PermissionsGuard)`
        // at the class level. NestJS auto-registers guard classes referenced this
        // way as local providers and resolves their full dependency graph at
        // `compile()` time, so `PermissionsGuard` (and its own dependency,
        // `AuthorizationService`) must be resolvable too, even though this spec's
        // subject is `InvitationModule`, not `AuthorizationModule`.
        Reflector,
        PermissionsGuard,
        AuthorizationService,
        {
          provide: getRepositoryToken(RoleAssignment),
          useValue: { query: async () => [] },
        },
        {
          provide: EnforcementModeService,
          useValue: { getMode: async () => 'enforce' },
        },
        { provide: REFRESH_TOKEN_HMAC_KEY, useValue: 'a'.repeat(64) },
        { provide: InvitationRepository, useValue: {} },
        {
          provide: getDataSourceToken(),
          useValue: { transaction: async () => undefined },
        },
        {
          provide: ScopeAccessService,
          useValue: { getAccessibleScopeIds: async () => [] },
        },
        {
          provide: RoleAssignmentService,
          useValue: { assignRole: async () => undefined },
        },
        {
          provide: PasswordHashingService,
          useValue: { hash: async () => 'hash', verify: async () => true },
        },
        {
          provide: UserRepository,
          useValue: {
            findByUsername: async () => null,
            findByEmail: async () => null,
            findWithRoles: async () => null,
          },
        },
        {
          provide: TokenService,
          useValue: {
            generateTokens: () => ({ accessToken: 'token', expiresIn: 900 }),
          },
        },
        {
          provide: RefreshTokenService,
          useValue: { createRefreshToken: async () => 'refresh-token' },
        },
        {
          provide: JwtService,
          useValue: { verify: () => ({ sub: 'user-1' }) },
        },
      ],
    }).compile();

    expect(moduleRef.get(InvitationService)).toBeInstanceOf(InvitationService);
    // `InvitationController` is transitively REQUEST-scoped (it carries
    // `PermissionsGuard`, which injects the REQUEST-scoped `AuthorizationService`),
    // so it must be looked up with `resolve()` rather than `get()` — same
    // caveat `authorization.module.spec.ts` documents for `AuthorizationService`
    // and `PermissionsGuard` themselves.
    expect(await moduleRef.resolve(InvitationController)).toBeInstanceOf(
      InvitationController,
    );
    expect(moduleRef.get(PublicInvitationController)).toBeInstanceOf(
      PublicInvitationController,
    );
  });
});
