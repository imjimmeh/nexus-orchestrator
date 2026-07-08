import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicInvitationController } from './public-invitation.controller';
import { AcceptInvitationBodySchema } from './invitation.dto';
import type { User } from '../../users/database/entities/user.entity';

const NEW_USER = { id: 'new-user-1' } as User;
const EXISTING_USER_ID = 'existing-user-1';

function createMocks() {
  const invitations = {
    acceptInvitation: vi.fn(),
  };
  const jwtService = {
    verify: vi.fn(),
  };
  const tokenService = {
    generateTokens: vi.fn(() => ({
      accessToken: 'issued-access-token',
      expiresIn: 900,
    })),
  };
  const refreshTokenService = {
    createRefreshToken: vi.fn(async () => 'issued-refresh-token'),
  };
  const userRepository = {
    findWithRoles: vi.fn(async () => ({
      ...NEW_USER,
      userRoles: [{ role: { name: 'user' } }],
    })),
  };

  const controller = new PublicInvitationController(
    invitations as any,
    jwtService as any,
    tokenService as any,
    refreshTokenService as any,
    userRepository as any,
  );

  return {
    controller,
    invitations,
    jwtService,
    tokenService,
    refreshTokenService,
    userRepository,
  };
}

describe('PublicInvitationController.accept', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  it('anonymous caller with username+password: takes the new-user path and returns issued tokens', async () => {
    const { controller, invitations, tokenService, refreshTokenService } =
      createMocks();
    invitations.acceptInvitation.mockResolvedValue({ userId: 'new-user-1' });

    const result = await controller.accept(
      {
        token: 'raw-invite-token',
        username: 'alice',
        password: 'correct-horse',
      },
      undefined,
    );

    expect(invitations.acceptInvitation).toHaveBeenCalledWith({
      rawToken: 'raw-invite-token',
      newUser: { username: 'alice', password: 'correct-horse' },
    });
    expect(tokenService.generateTokens).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-user-1' }),
      ['user'],
    );
    expect(refreshTokenService.createRefreshToken).toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        userId: 'new-user-1',
        accessToken: 'issued-access-token',
        refreshToken: 'issued-refresh-token',
      },
    });
  });

  it('never logs the raw token or password', async () => {
    const { controller, invitations } = createMocks();
    invitations.acceptInvitation.mockResolvedValue({ userId: 'new-user-1' });

    await controller.accept(
      {
        token: 'super-secret-raw-token',
        username: 'alice',
        password: 'super-secret-password',
      },
      undefined,
    );

    const allLoggedText = [
      ...consoleLogSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
    ]
      .flat()
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    expect(allLoggedText).not.toContain('super-secret-raw-token');
    expect(allLoggedText).not.toContain('super-secret-password');
  });

  it('logged-in caller (valid bearer): resolves existingUserId from the JWT subject and skips user creation', async () => {
    const { controller, invitations, jwtService, tokenService } = createMocks();
    jwtService.verify.mockReturnValue({ sub: EXISTING_USER_ID });
    invitations.acceptInvitation.mockResolvedValue({
      userId: EXISTING_USER_ID,
    });

    const result = await controller.accept(
      { token: 'raw-invite-token' },
      'Bearer valid.jwt.token',
    );

    expect(jwtService.verify).toHaveBeenCalledWith('valid.jwt.token');
    expect(invitations.acceptInvitation).toHaveBeenCalledWith({
      rawToken: 'raw-invite-token',
      existingUserId: EXISTING_USER_ID,
    });
    expect(invitations.acceptInvitation.mock.calls[0][0]).not.toHaveProperty(
      'newUser',
    );
    expect(tokenService.generateTokens).toHaveBeenCalled();
    expect(result.data.userId).toBe(EXISTING_USER_ID);
  });

  it('never sources existingUserId from the request body, even if the caller supplies it', async () => {
    const { controller, invitations } = createMocks();
    invitations.acceptInvitation.mockResolvedValue({ userId: 'new-user-1' });

    // The Zod schema strips any `existingUserId` field before it ever reaches
    // the controller, so simulate that by parsing through the real schema
    // (mirrors what ZodValidationPipe does at the HTTP boundary).
    const parsed = AcceptInvitationBodySchema.parse({
      token: 'raw-invite-token',
      username: 'alice',
      password: 'correct-horse',
      existingUserId: 'attacker-supplied-victim-id',
    });
    expect(parsed).not.toHaveProperty('existingUserId');

    await controller.accept(parsed, undefined);

    expect(invitations.acceptInvitation).toHaveBeenCalledWith({
      rawToken: 'raw-invite-token',
      newUser: { username: 'alice', password: 'correct-horse' },
    });
  });

  it('expired/invalid bearer with no username/password: falls through to the anonymous branch and throws BadRequestException', async () => {
    const { controller, jwtService } = createMocks();
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(
      controller.accept(
        { token: 'raw-invite-token' },
        'Bearer expired.jwt.token',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('no bearer and no username/password: throws BadRequestException', async () => {
    const { controller } = createMocks();

    await expect(
      controller.accept({ token: 'raw-invite-token' }, undefined),
    ).rejects.toThrow('Must be logged in or provide username and password');
  });

  it('invalid/expired invitation token: propagates the service generic NotFoundException unchanged', async () => {
    const { controller, invitations } = createMocks();
    invitations.acceptInvitation.mockRejectedValue(
      new NotFoundException('Invalid or expired invitation'),
    );

    await expect(
      controller.accept(
        { token: 'bad-token', username: 'alice', password: 'correct-horse' },
        undefined,
      ),
    ).rejects.toThrow('Invalid or expired invitation');
  });
});

describe('AcceptInvitationBodySchema', () => {
  it('requires a non-empty token', () => {
    expect(AcceptInvitationBodySchema.safeParse({ token: '' }).success).toBe(
      false,
    );
    expect(AcceptInvitationBodySchema.safeParse({}).success).toBe(false);
  });

  it('requires username and password together, not one without the other', () => {
    expect(
      AcceptInvitationBodySchema.safeParse({ token: 't', username: 'alice' })
        .success,
    ).toBe(false);
    expect(
      AcceptInvitationBodySchema.safeParse({ token: 't', password: 'p' })
        .success,
    ).toBe(false);
    expect(AcceptInvitationBodySchema.safeParse({ token: 't' }).success).toBe(
      true,
    );
    expect(
      AcceptInvitationBodySchema.safeParse({
        token: 't',
        username: 'alice',
        password: 'p',
      }).success,
    ).toBe(true);
  });

  it('strips an existingUserId field rather than accepting it', () => {
    const result = AcceptInvitationBodySchema.safeParse({
      token: 't',
      existingUserId: 'attacker-supplied',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('existingUserId');
    }
  });
});
