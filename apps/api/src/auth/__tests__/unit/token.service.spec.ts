import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createAuthTestingModuleWithDefaults } from '../setup/auth-test.module';
import { AuthTestContext } from '../setup/auth-test.module';
import {
  mockUser,
  mockRole,
  mockAdminRole,
  refreshTokenFixture,
} from '../setup/auth-test.fixtures';
import { User } from '../../../users/database/entities/user.entity';
import { UserRole } from '../../database/entities/user-role.entity';

describe('AuthService - Token & Session Management', () => {
  let ctx: AuthTestContext;

  beforeEach(async () => {
    ctx = await createAuthTestingModuleWithDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('refreshToken', () => {
    it('should successfully refresh tokens', async () => {
      const mockUserWithRoles: User = {
        ...mockUser,
        userRoles: [{ role: mockRole }] as UserRole[],
      };

      ctx.refreshTokenService.validateRefreshToken.mockResolvedValue({
        user: mockUser,
      });
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserWithRoles);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'new-access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'new-refresh-token',
      );

      const result = await ctx.service.refreshToken(refreshTokenFixture);

      expect(result).toBeDefined();
      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.expiresIn).toBe(900);
      expect(ctx.refreshTokenService.validateRefreshToken).toHaveBeenCalledWith(
        refreshTokenFixture.refreshToken,
      );
      expect(ctx.refreshTokenService.revokeRefreshToken).toHaveBeenCalledWith(
        refreshTokenFixture.refreshToken,
      );
      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(mockUser, [
        'user',
      ]);
    });

    it('should throw UnauthorizedException when refresh token is invalid', async () => {
      ctx.refreshTokenService.validateRefreshToken.mockResolvedValue(null);

      await expect(
        ctx.service.refreshToken(refreshTokenFixture),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        ctx.service.refreshToken(refreshTokenFixture),
      ).rejects.toThrow('Invalid refresh token');
    });

    it('should handle multiple roles when refreshing token', async () => {
      const mockUserWithMultipleRoles: User = {
        ...mockUser,
        userRoles: [{ role: mockRole }, { role: mockAdminRole }] as UserRole[],
      };

      ctx.refreshTokenService.validateRefreshToken.mockResolvedValue({
        user: mockUser,
      });
      ctx.userRepository.findWithRoles.mockResolvedValue(
        mockUserWithMultipleRoles,
      );
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'new-access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'new-refresh-token',
      );

      await ctx.service.refreshToken(refreshTokenFixture);

      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(mockUser, [
        'user',
        'admin',
      ]);
    });

    it('should handle empty roles array', async () => {
      const mockUserNoRoles: User = {
        ...mockUser,
        userRoles: [],
      };

      ctx.refreshTokenService.validateRefreshToken.mockResolvedValue({
        user: mockUser,
      });
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserNoRoles);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'new-access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'new-refresh-token',
      );

      const result = await ctx.service.refreshToken(refreshTokenFixture);

      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(
        mockUser,
        [],
      );
      expect(result.accessToken).toBe('new-access-token');
    });
  });

  describe('logout', () => {
    it('should revoke refresh token when provided', async () => {
      const userId = 'user-123';
      const refreshToken = 'valid-refresh-token';

      ctx.refreshTokenService.revokeRefreshToken.mockResolvedValue(undefined);

      await ctx.service.logout(userId, refreshToken);

      expect(ctx.refreshTokenService.revokeRefreshToken).toHaveBeenCalledWith(
        refreshToken,
      );
    });

    it('should not call revoke when no refresh token provided', async () => {
      const userId = 'user-123';

      await ctx.service.logout(userId, undefined);

      expect(ctx.refreshTokenService.revokeRefreshToken).not.toHaveBeenCalled();
    });

    it('should complete without error when called without token', async () => {
      const userId = 'user-123';

      await expect(ctx.service.logout(userId)).resolves.toBeUndefined();
    });
  });

  describe('logoutAll', () => {
    it('should revoke all user tokens', async () => {
      const userId = 'user-123';

      ctx.refreshTokenService.revokeAllUserTokens.mockResolvedValue(undefined);

      await ctx.service.logoutAll(userId);

      expect(ctx.refreshTokenService.revokeAllUserTokens).toHaveBeenCalledWith(
        userId,
      );
    });
  });
});
