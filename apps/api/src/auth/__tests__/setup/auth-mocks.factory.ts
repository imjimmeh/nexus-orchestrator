import { vi } from 'vitest';
import { UserRepository } from '../../../users/database/repositories/user.repository';
import { RoleRepository } from '../../database/repositories/role.repository';
import { UserRoleRepository } from '../../database/repositories/user-role.repository';
import { TokenService } from '../../token.service';
import { RefreshTokenService } from '../../refresh-token.service';
import { User } from '../../../users/database/entities/user.entity';
import { Role } from '../../database/entities/role.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { RefreshToken } from '../../../security/database/entities/refresh-token.entity';

export interface MockUserRepository {
  findById: ReturnType<typeof vi.fn>;
  findByUsername: ReturnType<typeof vi.fn>;
  findByEmail: ReturnType<typeof vi.fn>;
  findWithRoles: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  countActive: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
}

export function createMockUserRepository(): MockUserRepository {
  return {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    findByEmail: vi.fn(),
    findWithRoles: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
    count: vi.fn(),
    countActive: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
}

export interface MockRoleRepository {
  findOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  findAllWithPermissions: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
}

export function createMockRoleRepository(): MockRoleRepository {
  return {
    findOne: vi.fn(),
    find: vi.fn(),
    findAllWithPermissions: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  };
}

export interface MockUserRoleRepository {
  save: ReturnType<typeof vi.fn>;
  findByUserId: ReturnType<typeof vi.fn>;
  findByRoleId: ReturnType<typeof vi.fn>;
  deleteByUserId: ReturnType<typeof vi.fn>;
}

export function createMockUserRoleRepository(): MockUserRoleRepository {
  return {
    save: vi.fn(),
    findByUserId: vi.fn(),
    findByRoleId: vi.fn(),
    deleteByUserId: vi.fn(),
  };
}

export interface MockTokenService {
  generateTokens: ReturnType<typeof vi.fn>;
  verifyAccessToken: ReturnType<typeof vi.fn>;
}

export function createMockTokenService(): MockTokenService {
  return {
    generateTokens: vi.fn(),
    verifyAccessToken: vi.fn(),
  };
}

export interface MockRefreshTokenService {
  createRefreshToken: ReturnType<typeof vi.fn>;
  validateRefreshToken: ReturnType<typeof vi.fn>;
  revokeRefreshToken: ReturnType<typeof vi.fn>;
  revokeAllUserTokens: ReturnType<typeof vi.fn>;
}

export function createMockRefreshTokenService(): MockRefreshTokenService {
  return {
    createRefreshToken: vi.fn(),
    validateRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllUserTokens: vi.fn(),
  };
}

export interface MockBcrypt {
  hash: ReturnType<typeof vi.fn>;
  compare: ReturnType<typeof vi.fn>;
  genSalt: ReturnType<typeof vi.fn>;
}

export function createMockBcrypt(): MockBcrypt {
  return {
    hash: vi.fn(),
    compare: vi.fn(),
    genSalt: vi.fn(),
  };
}

export interface AuthMocks {
  userRepository: MockUserRepository;
  roleRepository: MockRoleRepository;
  userRoleRepository: MockUserRoleRepository;
  tokenService: MockTokenService;
  refreshTokenService: MockRefreshTokenService;
  bcrypt: MockBcrypt;
}

export function createAuthMocks(): AuthMocks {
  return {
    userRepository: createMockUserRepository(),
    roleRepository: createMockRoleRepository(),
    userRoleRepository: createMockUserRoleRepository(),
    tokenService: createMockTokenService(),
    refreshTokenService: createMockRefreshTokenService(),
    bcrypt: createMockBcrypt(),
  };
}

export const DEFAULT_TEST_DATE = '2025-01-01T00:00:00Z';

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    passwordHash: 'hashedpassword',
    isActive: true,
    lastLoginAt: new Date(DEFAULT_TEST_DATE),
    deactivatedAt: new Date(DEFAULT_TEST_DATE),
    passwordChangedAt: new Date(DEFAULT_TEST_DATE),
    createdAt: new Date(DEFAULT_TEST_DATE),
    updatedAt: new Date(DEFAULT_TEST_DATE),
    refreshTokens: [],
    userRoles: [],
    ...overrides,
  };
}

export function createMockRole(overrides?: Partial<Role>): Role {
  return {
    id: 'role-123',
    name: 'user',
    description: 'Regular user role',
    rolePermissions: [],
    userRoles: [],
    ...overrides,
  };
}

export function createMockUserRole(overrides?: Partial<UserRole>): UserRole {
  const userId = overrides?.userId ?? 'user-123';
  const roleId = overrides?.roleId ?? 'role-123';

  // Create the UserRole first with empty arrays
  const userRole: UserRole = {
    id: overrides?.id ?? 'user-role-123',
    userId,
    roleId,
    user: createMockUser({ id: userId, userRoles: [] }),
    role: createMockRole({ id: roleId, userRoles: [] }),
    ...overrides,
  };

  // Now establish bidirectional relationships
  userRole.user.userRoles = [userRole];
  userRole.role.userRoles = [userRole];

  return userRole;
}

export function createMockRefreshToken(
  overrides?: Partial<RefreshToken>,
): RefreshToken {
  return {
    id: 'refresh-token-123',
    tokenHash: 'hashed-token-123',
    expiresAt: new Date('2025-12-31T23:59:59Z'),
    isRevoked: false,
    deviceInfo: 'Test Device',
    createdAt: new Date(DEFAULT_TEST_DATE),
    user: createMockUser(),
    ...overrides,
  };
}
