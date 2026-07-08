import { vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createAuthTestingModuleWithDefaults } from '../setup/auth-test.module';
import { AuthTestContext } from '../setup/auth-test.module';
import { mockUser, mockRole, mockAdminRole } from '../setup/auth-test.fixtures';
import { User } from '../../../users/database/entities/user.entity';
import { UserRole } from '../../database/entities/user-role.entity';

describe('AuthService - User & Session Management', () => {
  let ctx: AuthTestContext;

  beforeEach(async () => {
    ctx = await createAuthTestingModuleWithDefaults();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getMe', () => {
    it('should return user data with roles', async () => {
      const userId = 'user-123';
      const mockUserWithRoles: User = {
        ...mockUser,
        userRoles: [{ role: mockRole }] as UserRole[],
      };

      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserWithRoles);

      const result = await ctx.service.getMe(userId);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockUser.id);
      expect(result.username).toBe(mockUser.username);
      expect(result.email).toBe(mockUser.email);
      expect(result.roles).toEqual(['user']);
      expect(result.isActive).toBe(mockUser.isActive);
      expect(result.createdAt).toBe(mockUser.createdAt.toISOString());
      expect(ctx.userRepository.findWithRoles).toHaveBeenCalledWith(userId);
    });

    it('should return user with multiple roles', async () => {
      const userId = 'user-123';
      const mockUserWithMultipleRoles: User = {
        ...mockUser,
        userRoles: [{ role: mockRole }, { role: mockAdminRole }] as UserRole[],
      };

      ctx.userRepository.findWithRoles.mockResolvedValue(
        mockUserWithMultipleRoles,
      );

      const result = await ctx.service.getMe(userId);

      expect(result.roles).toEqual(['user', 'admin']);
    });

    it('should throw UnauthorizedException when user not found', async () => {
      const userId = 'nonexistent-user';

      ctx.userRepository.findWithRoles.mockResolvedValue(null);

      await expect(ctx.service.getMe(userId)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(ctx.service.getMe(userId)).rejects.toThrow('User not found');
    });

    it('should return empty roles array when user has no roles', async () => {
      const userId = 'user-123';
      const mockUserNoRoles: User = {
        ...mockUser,
        userRoles: [],
      };

      ctx.userRepository.findWithRoles.mockResolvedValue(mockUserNoRoles);

      const result = await ctx.service.getMe(userId);

      expect(result.roles).toEqual([]);
    });
  });
});
