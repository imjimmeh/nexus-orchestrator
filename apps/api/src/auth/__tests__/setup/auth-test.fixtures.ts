import { User } from '../../../users/database/entities/user.entity';
import { Role } from '../../database/entities/role.entity';
import { UserRole } from '../../database/entities/user-role.entity';
import { RefreshToken } from '../../../security/database/entities/refresh-token.entity';

export const DEFAULT_TEST_DATE = '2025-01-01T00:00:00Z';

export function createMockUserFixture(): User {
  return Object.freeze({
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
  } as User);
}

export function createMockAdminUserFixture(): User {
  const mockUser = createMockUserFixture();
  return Object.freeze({
    ...mockUser,
    id: 'user-admin-123',
    username: 'adminuser',
    email: 'admin@example.com',
  });
}

export function createMockInactiveUserFixture(): User {
  const mockUser = createMockUserFixture();
  return Object.freeze({
    ...mockUser,
    id: 'user-inactive-123',
    isActive: false,
  } as User);
}

export function createMockRoleFixture(): Role {
  return Object.freeze({
    id: 'role-123',
    name: 'user',
    description: 'Regular user role',
    rolePermissions: [],
    userRoles: [],
  } as Role);
}

export function createMockAdminRoleFixture(): Role {
  return Object.freeze({
    id: 'role-456',
    name: 'admin',
    description: 'Administrator role',
    rolePermissions: [],
    userRoles: [],
  } as Role);
}

export function createMockUserRoleFixture(): UserRole {
  const mockUser = createMockUserFixture();
  const mockRole = createMockRoleFixture();
  return Object.freeze({
    id: 'user-role-123',
    userId: mockUser.id,
    roleId: mockRole.id,
    user: mockUser,
    role: mockRole,
  });
}

export function createMockAdminUserRoleFixture(): UserRole {
  const mockAdminUser = createMockAdminUserFixture();
  const mockAdminRole = createMockAdminRoleFixture();
  return Object.freeze({
    id: 'user-role-456',
    userId: mockAdminUser.id,
    roleId: mockAdminRole.id,
    user: mockAdminUser,
    role: mockAdminRole,
  });
}

export function createMockRefreshTokenFixture(): RefreshToken {
  const mockUser = createMockUserFixture();
  return Object.freeze({
    id: 'refresh-token-123',
    tokenHash: 'hashed-token-123',
    expiresAt: new Date('2025-12-31T23:59:59Z'),
    isRevoked: false,
    deviceInfo: 'Test Device',
    createdAt: new Date(DEFAULT_TEST_DATE),
    user: mockUser,
  } as RefreshToken);
}

export function createMockRevokedRefreshTokenFixture(): RefreshToken {
  const mockRefreshToken = createMockRefreshTokenFixture();
  return Object.freeze({
    ...mockRefreshToken,
    id: 'refresh-token-456',
    tokenHash: 'hashed-token-456',
    isRevoked: true,
  } as RefreshToken);
}

// Backward-compatible frozen exports for existing tests
export const mockUser: User = createMockUserFixture();
export const mockAdminUser: User = createMockAdminUserFixture();
export const mockInactiveUser: User = createMockInactiveUserFixture();
export const mockRole: Role = createMockRoleFixture();
export const mockAdminRole: Role = createMockAdminRoleFixture();
export const mockUserRole: UserRole = createMockUserRoleFixture();
export const mockAdminUserRole: UserRole = createMockAdminUserRoleFixture();
export const mockRefreshToken: RefreshToken = createMockRefreshTokenFixture();
export const mockRevokedRefreshToken: RefreshToken =
  createMockRevokedRefreshTokenFixture();

export interface RegisterFixture {
  username: string;
  email: string;
  password: string;
}

export const registerFixture: RegisterFixture = Object.freeze({
  username: 'newuser',
  email: 'newuser@example.com',
  password: 'SecurePass123!',
});

export interface LoginFixture {
  username: string;
  password: string;
  rememberMe: boolean;
}

export const loginFixture: LoginFixture = Object.freeze({
  username: 'testuser',
  password: 'correctpassword',
  rememberMe: false,
});

export const loginWithRememberMeFixture: LoginFixture = Object.freeze({
  ...loginFixture,
  rememberMe: true,
});

export interface RefreshTokenFixture {
  refreshToken: string;
}

export const refreshTokenFixture: RefreshTokenFixture = Object.freeze({
  refreshToken: 'valid-refresh-token',
});

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export const mockTokenPair: TokenPair = Object.freeze({
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresIn: 900,
});

export const mockNewTokenPair: TokenPair = Object.freeze({
  accessToken: 'new-access-token',
  refreshToken: 'new-refresh-token',
  expiresIn: 900,
});
