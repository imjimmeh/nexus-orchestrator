import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { InvitationService } from './invitation.service';
import { AcceptInvitationBodySchema } from './invitation.dto';
import type { AcceptInvitationBody } from './invitation.types';
import { TokenService } from '../token.service';
import type { TokenPayload } from '../token.service.types';
import { RefreshTokenService } from '../refresh-token.service';
import { UserRepository } from '../../users/database/repositories/user.repository';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

const ACCEPT_INVITATION_PIPE = new ZodValidationPipe(
  AcceptInvitationBodySchema,
);

const BEARER_PREFIX_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * PUBLIC (deliberately unguarded — no `JwtAuthGuard`/`PermissionsGuard`)
 * accept endpoint. Accepting an invitation is the FIRST authenticated action
 * for a brand-new user, so the route itself cannot require a bearer token.
 *
 * An already-logged-in user MAY also call this endpoint (e.g. accepting an
 * additional-scope invite while signed in) WITH a bearer token even though
 * the route is unguarded. For that case ONLY, this controller manually
 * verifies an OPTIONAL `Authorization` header against `JwtService` to
 * resolve `existingUserId` — a missing or invalid token is treated as an
 * anonymous request rather than rejected, which is what makes this an
 * "optional auth" mechanism rather than a guard.
 *
 * `existingUserId` is NEVER read from the request body: see
 * `AcceptInvitationBodySchema` in `invitation.dto.ts`, which has no such
 * field and strips one if a caller sends it. Sourcing it from the body
 * instead of a verified token would let any invitation-token holder grant
 * that invitation's role to an arbitrary victim account.
 *
 * TODO(phase-2 hardening): rate-limit this public route specifically (the
 * global `ThrottlerGuard` in `app.module.ts` applies a broad, generous
 * default limit; no per-route throttling for accept attempts exists yet).
 */
@ApiTags('invitations')
@Controller('invitations')
export class PublicInvitationController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly jwtService: JwtService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly userRepository: UserRepository,
  ) {}

  @Post('accept')
  @ApiOperation({
    summary:
      'Accept an invitation (public — no auth guard; logs the accepting user in)',
  })
  async accept(
    @Body(ACCEPT_INVITATION_PIPE) body: AcceptInvitationBody,
    @Headers('authorization') authorizationHeader?: string,
  ) {
    const existingUserId =
      this.tryResolveAuthenticatedUserId(authorizationHeader);

    const { userId } = await this.invitations.acceptInvitation(
      existingUserId
        ? { rawToken: body.token, existingUserId }
        : { rawToken: body.token, newUser: this.requireNewUser(body) },
    );

    const user = await this.userRepository.findWithRoles(userId);
    if (!user) {
      throw new BadRequestException('Accepted user could not be loaded');
    }

    const roles = user.userRoles?.map((userRole) => userRole.role.name) ?? [];
    const { accessToken } = this.tokenService.generateTokens(user, roles);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);

    return { success: true, data: { userId, accessToken, refreshToken } };
  }

  /**
   * Resolves an already-logged-in caller's user id from an OPTIONAL bearer
   * token — never throws. A missing header, malformed `Bearer ` prefix, or a
   * token that fails `JwtService` verification (expired/invalid signature)
   * all resolve to `undefined`, which the caller treats as "anonymous" and
   * routes down the new-user path instead of rejecting the request outright.
   */
  private tryResolveAuthenticatedUserId(
    authorizationHeader?: string,
  ): string | undefined {
    const token = this.extractBearerToken(authorizationHeader);
    if (!token) {
      return undefined;
    }

    try {
      const payload = this.jwtService.verify<TokenPayload>(token);
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  private extractBearerToken(header?: string): string | undefined {
    if (!header) {
      return undefined;
    }
    return BEARER_PREFIX_PATTERN.exec(header)?.[1];
  }

  /**
   * Narrows an anonymous accept body to a well-formed new-user payload, or
   * rejects. This is the ONLY place `username`/`password` are read off the
   * body for account creation — there is no `existingUserId` counterpart
   * here because the body schema never carries one (see `invitation.dto.ts`).
   */
  private requireNewUser(body: AcceptInvitationBody): {
    username: string;
    password: string;
  } {
    if (!body.username || !body.password) {
      throw new BadRequestException(
        'Must be logged in or provide username and password',
      );
    }
    return { username: body.username, password: body.password };
  }
}
