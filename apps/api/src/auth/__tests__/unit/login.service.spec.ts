import { vi } from 'vitest';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createAuthTestingModuleWithDefaults } from '../setup/auth-test.module';
import { AuthTestContext } from '../setup/auth-test.module';
import { mockUser, mockRole, loginFixture } from '../setup/auth-test.fixtures';
import { User } from '../../../users/database/entities/user.entity';
import { UserRole } from '../../database/entities/user-role.entity';

// Helper to create a mutable user copy (fixture users are frozen)
function createMutableUser(baseUser: User): User {
  return {
    ...baseUser,
    refreshTokens: [...baseUser.refreshTokens],
    userRoles: [...baseUser.userRoles],
  };
}

describe('AuthService - Login', () => {
  let ctx: AuthTestContext;

  beforeEach(async () => {
    ctx = await createAuthTestingModuleWithDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const mutableUser = createMutableUser(mockUser);
      const mockUserWithRoles: User = {
        ...mutableUser,
        userRoles: [{ role: mockRole }] as UserRole[],
      };

      ctx.userRepository.findByUsername.mockResolvedValue(mutableUser);
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserWithRoles);
      ctx.userRepository.save.mockResolvedValue(mutableUser);
      ctx.passwordHashingService.verify.mockResolvedValue(true);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      const result = await ctx.service.login(loginFixture);

      expect(result).toBeDefined();
      expect(result.user.username).toBe(mockUser.username);
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe(900);
      expect(ctx.userRepository.findByUsername).toHaveBeenCalledWith(
        loginFixture.username,
      );
      expect(ctx.userRepository.save).toHaveBeenCalled();
      expect(ctx.passwordHashingService.verify).toHaveBeenCalledWith(
        loginFixture.password,
        mutableUser.passwordHash,
      );
      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(
        mutableUser,
        ['user'],
        false,
      );
    });

    it('should successfully login with rememberMe option', async () => {
      const loginDtoWithRemember = {
        ...loginFixture,
        rememberMe: true,
      };
      const mutableUser = createMutableUser(mockUser);
      const mockUserWithRoles: User = {
        ...mutableUser,
        userRoles: [{ role: mockRole }] as UserRole[],
      };

      ctx.userRepository.findByUsername.mockResolvedValue(mutableUser);
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserWithRoles);
      ctx.userRepository.save.mockResolvedValue(mutableUser);
      ctx.passwordHashingService.verify.mockResolvedValue(true);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      await ctx.service.login(loginDtoWithRemember);

      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(
        mutableUser,
        ['user'],
        true,
      );
      expect(ctx.refreshTokenService.createRefreshToken).toHaveBeenCalledWith(
        mutableUser,
        true,
      );
    });

    it('should throw UnauthorizedException when user not found', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(null);

      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        'Invalid credentials',
      );
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(mockUser);
      ctx.passwordHashingService.verify.mockResolvedValue(false);

      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(ctx.passwordHashingService.verify).toHaveBeenCalledWith(
        loginFixture.password,
        mockUser.passwordHash,
      );
    });

    it('should throw ForbiddenException when user is inactive', async () => {
      const inactiveUser = { ...mockUser, isActive: false };
      ctx.userRepository.findByUsername.mockResolvedValue(inactiveUser);
      ctx.passwordHashingService.verify.mockResolvedValue(true);

      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(ctx.service.login(loginFixture)).rejects.toThrow(
        'Account is disabled',
      );
    });

    it('should update lastLoginAt on successful login', async () => {
      const mutableUser = createMutableUser(mockUser);
      const mockUserWithRoles: User = {
        ...mutableUser,
        userRoles: [{ role: mockRole }] as UserRole[],
      };

      ctx.userRepository.findByUsername.mockResolvedValue(mutableUser);
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserWithRoles);
      ctx.userRepository.save.mockResolvedValue(mutableUser);
      ctx.passwordHashingService.verify.mockResolvedValue(true);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      await ctx.service.login(loginFixture);

      expect(ctx.userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastLoginAt: expect.any(Date),
        }),
      );
    });

    it('should handle empty roles when user has no roles assigned', async () => {
      const mutableUser = createMutableUser(mockUser);
      const mockUserNoRoles: User = {
        ...mutableUser,
        userRoles: [],
      };

      ctx.userRepository.findByUsername.mockResolvedValue(mutableUser);
      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserNoRoles);
      ctx.userRepository.save.mockResolvedValue(mutableUser);
      ctx.passwordHashingService.verify.mockResolvedValue(true);
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      const result = await ctx.service.login(loginFixture);

      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(
        mutableUser,
        [],
        false,
      );
      expect(result.user.roles).toEqual([]);
    });
  });
});
