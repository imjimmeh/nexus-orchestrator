import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../auth.service';
import { UserRepository } from '../../../users/database/repositories/user.repository';
import { RoleRepository } from '../../database/repositories/role.repository';
import { UserRoleRepository } from '../../database/repositories/user-role.repository';
import { TokenService } from '../../token.service';
import { RefreshTokenService } from '../../refresh-token.service';
import { PasswordHashingService } from '../../password-hashing.service';
import { vi } from 'vitest';
import {
  MockUserRepository,
  MockRoleRepository,
  MockUserRoleRepository,
  MockTokenService,
  MockRefreshTokenService,
} from './auth-mocks.factory';

vi.mock('bcrypt', async () => {
  const actual = await vi.importActual<typeof import('bcrypt')>('bcrypt');
  return {
    ...actual,
    hash: vi.fn(),
    compare: vi.fn(),
  };
});

export interface AuthTestModuleOptions {
  userRepository?: Partial<MockUserRepository>;
  roleRepository?: Partial<MockRoleRepository>;
  userRoleRepository?: Partial<MockUserRoleRepository>;
  tokenService?: Partial<MockTokenService>;
  refreshTokenService?: Partial<MockRefreshTokenService>;
  passwordHashingService?: Partial<MockPasswordHashingService>;
}

export interface MockPasswordHashingService {
  hash: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
}

export function createMockPasswordHashingService(): MockPasswordHashingService {
  return {
    hash: vi.fn().mockResolvedValue('hashedpassword123'),
    verify: vi.fn().mockResolvedValue(true),
  };
}

function createDefaultMocks(): {
  userRepository: MockUserRepository;
  roleRepository: MockRoleRepository;
  userRoleRepository: MockUserRoleRepository;
  tokenService: MockTokenService;
  refreshTokenService: MockRefreshTokenService;
  passwordHashingService: MockPasswordHashingService;
} {
  return {
    passwordHashingService: createMockPasswordHashingService(),
    userRepository: {
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
    },
    roleRepository: {
      findOne: vi.fn(),
      find: vi.fn(),
      findAllWithPermissions: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
    },
    userRoleRepository: {
      save: vi.fn(),
      findByUserId: vi.fn(),
      findByRoleId: vi.fn(),
      deleteByUserId: vi.fn(),
    },
    tokenService: {
      generateTokens: vi.fn(),
      verifyAccessToken: vi.fn(),
    },
    refreshTokenService: {
      createRefreshToken: vi.fn(),
      validateRefreshToken: vi.fn(),
      revokeRefreshToken: vi.fn(),
      revokeAllUserTokens: vi.fn(),
    },
  };
}

export async function createAuthTestingModule(
  options: AuthTestModuleOptions = {},
): Promise<TestingModule> {
  const defaultMocks = createDefaultMocks();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AuthService,
      {
        provide: UserRepository,
        useValue: { ...defaultMocks.userRepository, ...options.userRepository },
      },
      {
        provide: RoleRepository,
        useValue: { ...defaultMocks.roleRepository, ...options.roleRepository },
      },
      {
        provide: UserRoleRepository,
        useValue: {
          ...defaultMocks.userRoleRepository,
          ...options.userRoleRepository,
        },
      },
      {
        provide: TokenService,
        useValue: { ...defaultMocks.tokenService, ...options.tokenService },
      },
      {
        provide: RefreshTokenService,
        useValue: {
          ...defaultMocks.refreshTokenService,
          ...options.refreshTokenService,
        },
      },
      {
        provide: PasswordHashingService,
        useValue: {
          ...defaultMocks.passwordHashingService,
          ...options.passwordHashingService,
        },
      },
    ],
  }).compile();

  return module;
}

export interface AuthTestContext {
  module: TestingModule;
  service: AuthService;
  userRepository: MockUserRepository;
  roleRepository: MockRoleRepository;
  userRoleRepository: MockUserRoleRepository;
  tokenService: MockTokenService;
  refreshTokenService: MockRefreshTokenService;
  passwordHashingService: MockPasswordHashingService;
}

export async function createAuthTestingModuleWithDefaults(): Promise<AuthTestContext> {
  const mocks = createDefaultMocks();

  const module = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: UserRepository, useValue: mocks.userRepository },
      { provide: RoleRepository, useValue: mocks.roleRepository },
      { provide: UserRoleRepository, useValue: mocks.userRoleRepository },
      { provide: TokenService, useValue: mocks.tokenService },
      { provide: RefreshTokenService, useValue: mocks.refreshTokenService },
      {
        provide: PasswordHashingService,
        useValue: mocks.passwordHashingService,
      },
    ],
  }).compile();

  const service = module.get<AuthService>(AuthService);

  return {
    module,
    service,
    userRepository: mocks.userRepository,
    roleRepository: mocks.roleRepository,
    userRoleRepository: mocks.userRoleRepository,
    tokenService: mocks.tokenService,
    refreshTokenService: mocks.refreshTokenService,
    passwordHashingService: mocks.passwordHashingService,
  };
}
