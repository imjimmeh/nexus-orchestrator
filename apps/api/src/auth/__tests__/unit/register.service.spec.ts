import { vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { createAuthTestingModuleWithDefaults } from '../setup/auth-test.module';
import { AuthTestContext } from '../setup/auth-test.module';
import {
  mockUser,
  mockRole,
  mockAdminRole,
  registerFixture,
} from '../setup/auth-test.fixtures';
import { UserRole } from '../../database/entities/user-role.entity';

describe('AuthService - Register', () => {
  let ctx: AuthTestContext;

  beforeEach(async () => {
    ctx = await createAuthTestingModuleWithDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should successfully register a new user with user role', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(null);
      ctx.userRepository.findByEmail.mockResolvedValue(null);
      ctx.userRepository.create.mockReturnValue(mockUser);
      ctx.userRepository.save.mockResolvedValue(mockUser);
      ctx.userRepository.count.mockResolvedValue(2);
      ctx.roleRepository.findOne.mockResolvedValue(mockRole);
      ctx.userRoleRepository.save.mockResolvedValue({});
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      const result = await ctx.service.register(registerFixture);

      expect(result).toBeDefined();
      expect(result.user.username).toBe(mockUser.username);
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(ctx.userRepository.findByUsername).toHaveBeenCalledWith(
        registerFixture.username,
      );
      expect(ctx.userRepository.findByEmail).toHaveBeenCalledWith(
        registerFixture.email,
      );
      expect(ctx.roleRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'user' },
      });
      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(mockUser, [
        'user',
      ]);
    });

    it('should assign admin role to first registered user', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(null);
      ctx.userRepository.findByEmail.mockResolvedValue(null);
      ctx.userRepository.create.mockReturnValue(mockUser);
      ctx.userRepository.save.mockResolvedValue(mockUser);
      ctx.userRepository.count.mockResolvedValue(0);
      ctx.roleRepository.findOne.mockResolvedValue(mockAdminRole);
      ctx.userRoleRepository.save.mockResolvedValue({});
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      await ctx.service.register(registerFixture);

      expect(ctx.roleRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'admin' },
      });
      expect(ctx.tokenService.generateTokens).toHaveBeenCalledWith(mockUser, [
        'admin',
      ]);
    });

    it('should throw ConflictException when username already exists', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(mockUser);

      await expect(ctx.service.register(registerFixture)).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.service.register(registerFixture)).rejects.toThrow(
        'Username already exists',
      );
      expect(ctx.userRepository.findByUsername).toHaveBeenCalledWith(
        registerFixture.username,
      );
      expect(ctx.userRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when email already exists', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(null);
      ctx.userRepository.findByEmail.mockResolvedValue(mockUser);

      await expect(ctx.service.register(registerFixture)).rejects.toThrow(
        ConflictException,
      );
      await expect(ctx.service.register(registerFixture)).rejects.toThrow(
        'Email already exists',
      );
      expect(ctx.userRepository.findByUsername).toHaveBeenCalledWith(
        registerFixture.username,
      );
      expect(ctx.userRepository.findByEmail).toHaveBeenCalledWith(
        registerFixture.email,
      );
    });

    it('should throw error when role is not found', async () => {
      ctx.userRepository.findByUsername.mockResolvedValue(null);
      ctx.userRepository.findByEmail.mockResolvedValue(null);
      ctx.userRepository.create.mockReturnValue(mockUser);
      ctx.userRepository.save.mockResolvedValue(mockUser);
      ctx.userRepository.count.mockResolvedValue(2);
      ctx.roleRepository.findOne.mockResolvedValue(null);

      await expect(ctx.service.register(registerFixture)).rejects.toThrow(
        'Role user not found',
      );
    });

    it('should hash password before saving', async () => {
      ctx.passwordHashingService.hash.mockResolvedValue('hashedpassword123');
      ctx.userRepository.findByUsername.mockResolvedValue(null);
      ctx.userRepository.findByEmail.mockResolvedValue(null);
      ctx.userRepository.create.mockReturnValue(mockUser);
      ctx.userRepository.save.mockResolvedValue(mockUser);
      ctx.userRepository.count.mockResolvedValue(2);
      ctx.roleRepository.findOne.mockResolvedValue(mockRole);
      ctx.userRoleRepository.save.mockResolvedValue({});
      ctx.tokenService.generateTokens.mockReturnValue({
        accessToken: 'access-token',
        expiresIn: 900,
      });
      ctx.refreshTokenService.createRefreshToken.mockResolvedValue(
        'refresh-token',
      );

      await ctx.service.register(registerFixture);

      expect(ctx.passwordHashingService.hash).toHaveBeenCalledWith(
        registerFixture.password,
      );
      expect(ctx.userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: registerFixture.username,
          email: registerFixture.email,
          passwordHash: expect.any(String),
        }),
      );
    });
  });
});
