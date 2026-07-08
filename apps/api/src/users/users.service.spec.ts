import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './database/entities/user.entity';
import { Role } from '../auth/database/entities/role.entity';
import { UserRole } from '../auth/database/entities/user-role.entity';
import { RefreshToken } from '../security/database/entities/refresh-token.entity';
import { RolePermission } from '../auth/database/entities/role-permission.entity';
import {
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PasswordValidationService } from '../auth/password-validation.service';
import { PasswordHashingService } from '../auth/password-hashing.service';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

interface PasswordHashingServiceMock {
  hash: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: any;
  let roleRepository: any;
  let userRoleRepository: any;
  let passwordValidationService: any;
  let passwordHashing: PasswordHashingServiceMock;

  const mockUser: User = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    passwordHash: 'hashedpassword',
    isActive: true,
    lastLoginAt: null as unknown as Date,
    deactivatedAt: null as unknown as Date,
    passwordChangedAt: null as unknown as Date,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    refreshTokens: [],
    userRoles: [],
  };

  const mockRole = {
    id: 'role-123',
    name: 'USER',
    description: 'Regular user role',
    userRoles: [],
    rolePermissions: [],
  } as unknown as Role;

  const mockUserRole: UserRole = {
    id: 'userrole-123',
    user: mockUser,
    role: mockRole,
  } as UserRole;

  beforeEach(async () => {
    userRepository = {
      findAndCount: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      save: vi.fn(),
      update: vi.fn(),
      findBy: vi.fn(),
      createQueryBuilder: vi.fn(),
    };

    roleRepository = {
      findBy: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
    };

    userRoleRepository = {
      create: vi.fn(),
      save: vi.fn(),
      delete: vi.fn(),
    };

    passwordValidationService = {
      validatePassword: vi.fn(),
    };

    passwordHashing = {
      hash: vi.fn().mockResolvedValue('hashedpassword123'),
      verify: vi.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: userRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: roleRepository,
        },
        {
          provide: getRepositoryToken(UserRole),
          useValue: userRoleRepository,
        },
        {
          provide: PasswordValidationService,
          useValue: passwordValidationService,
        },
        {
          provide: PasswordHashingService,
          useValue: passwordHashing,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const users = [{ ...mockUser }];
      const total = 1;

      userRepository.findAndCount.mockResolvedValue([users, total]);

      const result = await service.findAll(1, 10);

      expect(result).toEqual({
        data: users,
        total,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        where: { isActive: true },
        skip: 0,
        take: 10,
        relations: { userRoles: { role: true } },
        order: { createdAt: 'DESC' },
      });
    });

    it('should calculate correct pagination for page 2', async () => {
      const users: User[] = [];
      const total = 25;

      userRepository.findAndCount.mockResolvedValue([users, total]);

      const result = await service.findAll(2, 10);

      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should use default values when no parameters provided', async () => {
      const users: User[] = [];
      const total = 0;

      userRepository.findAndCount.mockResolvedValue([users, total]);

      await service.findAll();

      expect(userRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });

    it('should calculate correct totalPages when total is not divisible by limit', async () => {
      const users: User[] = [];
      const total = 35;

      userRepository.findAndCount.mockResolvedValue([users, total]);

      const result = await service.findAll(1, 10);

      expect(result.totalPages).toBe(4);
    });

    it('should return zero totalPages when total is zero', async () => {
      const users: User[] = [];
      const total = 0;

      userRepository.findAndCount.mockResolvedValue([users, total]);

      const result = await service.findAll(1, 10);

      expect(result.totalPages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return a user when found', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne('user-123');

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-123', isActive: true },
        relations: { userRoles: { role: true } },
      });
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should filter by isActive status', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.findOne('user-123');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findActiveByEmail', () => {
    it('should return user when found by email', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findActiveByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com', isActive: true },
        relations: { userRoles: { role: true } },
      });
    });

    it('should return null when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.findActiveByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('should filter by isActive status', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.findActiveByEmail('test@example.com');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('findByEmailIncludingInactive', () => {
    it('should return user when found (including deactivated)', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result =
        await service.findByEmailIncludingInactive('test@example.com');

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        relations: { userRoles: { role: true } },
      });
    });

    it('should return null when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmailIncludingInactive(
        'nonexistent@example.com',
      );

      expect(result).toBeNull();
    });

    it('should not filter by isActive', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.findByEmailIncludingInactive('test@example.com');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isActive: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('create', () => {
    const createUserDto = {
      email: 'new@example.com',
      username: 'newuser',
      password: 'SecurePass123!',
      roleIds: [] as string[],
    };

    beforeEach(() => {
      passwordValidationService.validatePassword.mockReturnValue({
        valid: true,
        errors: [],
      });
      passwordHashing.hash.mockResolvedValue('hashedpassword123');
    });

    it('should create a user successfully', async () => {
      const newUser = {
        ...mockUser,
        email: createUserDto.email,
        username: createUserDto.username,
      };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      const result = await service.create(createUserDto);

      expect(result).toEqual(newUser);
      expect(userRepository.create).toHaveBeenCalledWith({
        email: createUserDto.email,
        username: createUserDto.username,
        password: createUserDto.password,
        roleIds: [],
        passwordHash: 'hashedpassword123',
        isActive: true,
      });
      expect(userRepository.save).toHaveBeenCalledWith(newUser);
    });

    it('should throw ConflictException when email already exists', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(createUserDto)).rejects.toThrow(
        new ConflictException(
          `User with email "${createUserDto.email}" already exists`,
        ),
      );
    });

    it('should throw ForbiddenException when password validation fails', async () => {
      userRepository.findOne.mockResolvedValue(null);
      passwordValidationService.validatePassword.mockReturnValue({
        valid: false,
        errors: ['Password must contain at least one special character'],
      });

      await expect(service.create(createUserDto)).rejects.toThrow(
        new ForbiddenException(
          'Password validation failed: Password must contain at least one special character',
        ),
      );
    });

    it('should assign roles when roleIds provided', async () => {
      const createUserDtoWithRoles = {
        ...createUserDto,
        roleIds: ['role-123'],
      };

      const newUser = { ...mockUser, email: createUserDto.email };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);
      roleRepository.findBy.mockResolvedValue([mockRole]);
      userRoleRepository.create.mockReturnValue(mockUserRole);
      userRoleRepository.save.mockResolvedValue([mockUserRole]);

      await service.create(createUserDtoWithRoles);

      expect(roleRepository.findBy).toHaveBeenCalledWith([{ id: 'role-123' }]);
      expect(userRoleRepository.create).toHaveBeenCalled();
      expect(userRoleRepository.save).toHaveBeenCalled();
    });

    it('should hash password via PasswordHashingService', async () => {
      const newUser = { ...mockUser };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      await service.create(createUserDto);

      expect(passwordHashing.hash).toHaveBeenCalledWith(createUserDto.password);
    });

    it('should create user with isActive set to true', async () => {
      const newUser = { ...mockUser };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      await service.create(createUserDto);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });
  });

  describe('createUser', () => {
    const baseCreateUserDto = {
      username: 'newuser',
      email: 'new@example.com',
      password: 'SecurePass123!',
    } as unknown as import('@nexus/core').CreateUserRequest;

    beforeEach(() => {
      passwordValidationService.validatePassword.mockReturnValue({
        valid: true,
        errors: [],
      });
      passwordHashing.hash.mockResolvedValue('hashedpassword123');
    });

    it('should create a user with hashed password and persist it', async () => {
      const newUser = { ...mockUser, email: baseCreateUserDto.email };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      const result = await service.createUser(baseCreateUserDto);

      expect(result).toEqual(newUser);
      expect(passwordHashing.hash).toHaveBeenCalledWith(
        baseCreateUserDto.password,
      );
      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          username: baseCreateUserDto.username,
          email: baseCreateUserDto.email,
          passwordHash: 'hashedpassword123',
        }),
      );
      expect(userRepository.save).toHaveBeenCalledWith(newUser);
    });

    it('should re-throw ConflictException when assertEmailUnique detects an active collision', async () => {
      const collidingUser = {
        ...mockUser,
        id: 'other-user-456',
        email: baseCreateUserDto.email,
      };
      // assertEmailUnique internally queries userRepository.findOne({ where: { email, isActive: true } });
      // returning a different user here makes the helper throw the ConflictException
      // that the service then propagates verbatim.
      userRepository.findOne.mockResolvedValue(collidingUser);

      await expect(service.createUser(baseCreateUserDto)).rejects.toThrow(
        new ConflictException(
          `User with email "${baseCreateUserDto.email}" already exists`,
        ),
      );
    });

    it('should propagate password-validation failures as ForbiddenException', async () => {
      userRepository.findOne.mockResolvedValue(null);
      passwordValidationService.validatePassword.mockReturnValue({
        valid: false,
        errors: ['Password is too weak'],
      });

      await expect(service.createUser(baseCreateUserDto)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should resolve role by name and apply user roles when role is provided', async () => {
      const dtoWithRole = {
        ...baseCreateUserDto,
        role: 'USER',
      } as unknown as import('@nexus/core').CreateUserRequest;
      const newUser = { ...mockUser, email: baseCreateUserDto.email };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);
      roleRepository.findOne.mockResolvedValue(mockRole);
      roleRepository.find.mockResolvedValue([mockRole]);
      userRoleRepository.delete.mockResolvedValue({ affected: 0 });
      userRoleRepository.create.mockReturnValue(mockUserRole);
      userRoleRepository.save.mockResolvedValue([mockUserRole]);

      await service.createUser(dtoWithRole);

      expect(roleRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'USER' },
      });
      // applyUserRoles should delete existing role rows for the user and
      // re-create them for the resolved role id.
      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: newUser.id,
      });
      expect(userRoleRepository.create).toHaveBeenCalled();
      expect(userRoleRepository.save).toHaveBeenCalled();
    });

    it('should default isActive to true when dto.isActive is undefined', async () => {
      const newUser = { ...mockUser };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      await service.createUser(baseCreateUserDto);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });

    it('should respect isActive: false when provided in the dto', async () => {
      const dtoInactive: import('@nexus/core').CreateUserRequest = {
        ...baseCreateUserDto,
        isActive: false,
      };
      const newUser = { ...mockUser };

      userRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newUser);
      userRepository.create.mockReturnValue(newUser);
      userRepository.save.mockResolvedValue(newUser);

      await service.createUser(dtoInactive);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  describe('update', () => {
    const updateUserDto = {
      email: 'updated@example.com',
    };

    beforeEach(() => {
      userRepository.findOne.mockResolvedValue(mockUser);
    });

    it('should update user successfully', async () => {
      const updatedUser = { ...mockUser, email: 'updated@example.com' };

      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.update('user-123', updateUserDto);

      expect(result.email).toBe('updated@example.com');
      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        updateUserDto,
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update('nonexistent-id', updateUserDto),
      ).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should throw ConflictException when updating to existing email', async () => {
      const existingUser = { ...mockUser, id: 'user-456' };

      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(existingUser);

      await expect(
        service.update('user-123', { email: 'existing@example.com' }),
      ).rejects.toThrow(
        new ConflictException(
          'User with email "existing@example.com" already exists',
        ),
      );
    });

    it('should allow updating with same email', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await expect(
        service.update('user-123', { email: mockUser.email }),
      ).resolves.toBeDefined();
    });

    it('should update roles when roleIds provided', async () => {
      const updateWithRoles = {
        roleIds: ['role-123'],
      };

      const updatedUser = { ...mockUser, userRoles: [mockUserRole] };

      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      roleRepository.findBy.mockResolvedValue([mockRole]);
      userRoleRepository.delete.mockResolvedValue({
        affected: 0,
      });
      userRoleRepository.create.mockReturnValue(mockUserRole);
      userRoleRepository.save.mockResolvedValue([mockUserRole]);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.update('user-123', updateWithRoles);

      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: 'user-123',
      });
      expect(roleRepository.findBy).toHaveBeenCalledWith([{ id: 'role-123' }]);
    });

    it('should remove roleIds from update dto before updating user', async () => {
      const updateWithRoles = {
        email: 'updated@example.com',
        roleIds: ['role-123'],
      };

      const updatedUser = { ...mockUser, email: 'updated@example.com' };

      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      roleRepository.findBy.mockResolvedValue([mockRole]);
      userRoleRepository.delete.mockResolvedValue({
        affected: 0,
      });
      userRoleRepository.create.mockReturnValue(mockUserRole);
      userRoleRepository.save.mockResolvedValue([mockUserRole]);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.update('user-123', { ...updateWithRoles });

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.not.objectContaining({ roleIds: expect.anything() }),
      );
    });

    it('should handle empty roleIds array', async () => {
      const updateWithEmptyRoles = {
        roleIds: [],
      };

      const updatedUser = { ...mockUser, userRoles: [] };

      userRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(updatedUser);
      userRoleRepository.delete.mockResolvedValue({
        affected: 1,
      });
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.update('user-123', updateWithEmptyRoles);

      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: 'user-123',
      });
      expect(roleRepository.findBy).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    const existingUser: User = {
      ...mockUser,
      email: 'test@example.com',
      username: 'testuser',
      isActive: true,
    };

    beforeEach(() => {
      userRepository.update.mockResolvedValue({ affected: 1 });
    });

    it('should update username only and call userRepository.update with just that field', async () => {
      const updatedUser = { ...existingUser, username: 'renameduser' };

      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const result = await service.updateUser('user-123', {
        username: 'renameduser',
      });

      expect(result).toEqual(updatedUser);
      expect(userRepository.update).toHaveBeenCalledWith('user-123', {
        username: 'renameduser',
      });
    });

    it('should update email only and call assertEmailUnique before persisting', async () => {
      const updatedUser = { ...existingUser, email: 'newmail@example.com' };

      // 1st: getUserById(id) at the top of updateUser
      // 2nd: assertEmailUnique('newmail@example.com', 'user-123') helper query
      // 3rd: getUserById(id) at the bottom of updateUser
      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(updatedUser);

      const result = await service.updateUser('user-123', {
        email: 'newmail@example.com',
      });

      expect(result).toEqual(updatedUser);
      expect(userRepository.update).toHaveBeenCalledWith('user-123', {
        email: 'newmail@example.com',
      });
    });

    it('should update isActive only (deactivate) without touching email or username', async () => {
      const updatedUser = { ...existingUser, isActive: false };

      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const result = await service.updateUser('user-123', { isActive: false });

      expect(result).toEqual(updatedUser);
      expect(userRepository.update).toHaveBeenCalledWith('user-123', {
        isActive: false,
      });
    });

    it('should re-throw ConflictException when new email belongs to a different active user', async () => {
      const otherUser = {
        ...mockUser,
        id: 'user-456',
        email: 'taken@example.com',
      };

      // 1st: getUserById('user-123') returns the existing user
      // 2nd: assertEmailUnique('taken@example.com', 'user-123') finds the other user -> throws
      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(otherUser);

      await expect(
        service.updateUser('user-123', { email: 'taken@example.com' }),
      ).rejects.toThrow(
        new ConflictException(
          `User with email "taken@example.com" already exists`,
        ),
      );
    });

    it('should allow updating with the same email as the existing user without throwing', async () => {
      const updatedUser = { ...existingUser, email: existingUser.email };

      // Only two findOne calls here — no assertEmailUnique, because
      // updateUserDto.email === existingUser.email.
      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(updatedUser);

      const result = await service.updateUser('user-123', {
        email: existingUser.email,
      });

      expect(result).toEqual(updatedUser);
      expect(userRepository.update).toHaveBeenCalledWith('user-123', {
        email: existingUser.email,
      });
    });

    it('should delete existing role rows and re-apply via applyUserRoles when role is provided', async () => {
      // 1st: getUserById('user-123')
      // 2nd: getUserById('user-123') at the end (no email change, no assertEmailUnique)
      userRepository.findOne
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(existingUser);
      roleRepository.findOne.mockResolvedValue(mockRole);
      roleRepository.find.mockResolvedValue([mockRole]);
      userRoleRepository.delete.mockResolvedValue({ affected: 1 });
      userRoleRepository.create.mockReturnValue(mockUserRole);
      userRoleRepository.save.mockResolvedValue([mockUserRole]);

      await service.updateUser('user-123', { role: 'USER' });

      expect(roleRepository.findOne).toHaveBeenCalledWith({
        where: { name: 'USER' },
      });
      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: 'user-123',
      });
      expect(userRoleRepository.save).toHaveBeenCalled();
    });
  });

  describe('disableUser', () => {
    it('should throw NotFoundException when user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.disableUser('nonexistent-id')).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should set isActive=false and stamp deactivatedAt with a Date on success', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.disableUser('user-123');

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          isActive: false,
          deactivatedAt: expect.any(Date),
        }),
      );
    });

    it('should resolve with void (undefined) on success', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await expect(service.disableUser('user-123')).resolves.toBeUndefined();
    });
  });

  describe('remove', () => {
    it('should deactivate user successfully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.remove('user-123');

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          isActive: false,
          deactivatedAt: expect.any(Date),
        }),
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should set deactivatedAt timestamp', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      const before = new Date();
      await service.remove('user-123');
      const after = new Date();

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          deactivatedAt: expect.any(Date),
        }),
      );

      const callArgs = userRepository.update.mock.calls[0];
      const deactivatedAt = (callArgs[1] as { deactivatedAt: Date })
        ?.deactivatedAt;
      expect(deactivatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(deactivatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('resetPassword', () => {
    const newPassword = 'NewSecurePass123!';

    beforeEach(() => {
      passwordValidationService.validatePassword.mockReturnValue({
        valid: true,
        errors: [],
      });
      passwordHashing.hash.mockResolvedValue('newhashedpassword');
    });

    it('should reset password successfully', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetPassword('user-123', newPassword);

      expect(userRepository.update).toHaveBeenCalledWith(
        'user-123',
        expect.objectContaining({
          passwordHash: 'newhashedpassword',
          passwordChangedAt: expect.any(Date),
        }),
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword('nonexistent-id', newPassword),
      ).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should throw ForbiddenException when password validation fails', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      passwordValidationService.validatePassword.mockReturnValue({
        valid: false,
        errors: ['Password is too weak'],
      });

      await expect(service.resetPassword('user-123', 'weak')).rejects.toThrow(
        new ForbiddenException('Password is too weak'),
      );
    });

    it('should validate password before hashing', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.resetPassword('user-123', newPassword);

      expect(passwordValidationService.validatePassword).toHaveBeenCalledWith(
        newPassword,
      );
      expect(passwordHashing.hash).toHaveBeenCalled();
    });

    it('should set passwordChangedAt timestamp', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      const before = new Date();
      await service.resetPassword('user-123', newPassword);
      const after = new Date();

      const callArgs = userRepository.update.mock.calls[0];
      const passwordChangedAt = (callArgs[1] as { passwordChangedAt: Date })
        ?.passwordChangedAt;
      expect(passwordChangedAt.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(passwordChangedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should hash via PasswordHashingService without cost factor', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetPassword('user-123', newPassword);

      expect(passwordHashing.hash).toHaveBeenCalledWith(newPassword);
    });
  });

  describe('validatePassword', () => {
    it('should return true when password is valid', async () => {
      const userWithHash = { ...mockUser, passwordHash: 'hashedpassword' };

      userRepository.findOne.mockResolvedValue(userWithHash);
      passwordHashing.verify.mockResolvedValue(true);

      const result = await service.validatePassword(
        'user-123',
        'plainpassword',
      );

      expect(result).toBe(true);
      expect(passwordHashing.verify).toHaveBeenCalledWith(
        'plainpassword',
        'hashedpassword',
      );
    });

    it('should return false when user not found', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.validatePassword(
        'nonexistent-id',
        'password',
      );

      expect(result).toBe(false);
    });

    it('should return false when password hash is null', async () => {
      const userWithoutHash = {
        ...mockUser,
        passwordHash: null as unknown as string,
      };

      userRepository.findOne.mockResolvedValue(userWithoutHash);

      const result = await service.validatePassword('user-123', 'password');

      expect(result).toBe(false);
    });

    it('should return false when password verification fails', async () => {
      const userWithHash = { ...mockUser, passwordHash: 'hashedpassword' };

      userRepository.findOne.mockResolvedValue(userWithHash);
      passwordHashing.verify.mockResolvedValue(false);

      const result = await service.validatePassword(
        'user-123',
        'wrongpassword',
      );

      expect(result).toBe(false);
    });

    it('should not select password hash by default in other queries', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.findOne('user-123');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.not.objectContaining({
          select: { passwordHash: true },
        }),
      );
    });

    it('should select password hash in validatePassword query', async () => {
      const userWithHash = { ...mockUser, passwordHash: 'hashedpassword' };
      userRepository.findOne.mockResolvedValue(userWithHash);

      await service.validatePassword('user-123', 'password');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: { passwordHash: true },
        }),
      );
    });
  });

  describe('listUsers', () => {
    const mockQueryBuilder = {
      leftJoinAndSelect: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      take: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getManyAndCount: vi.fn().mockResolvedValue([[mockUser], 1]),
    };

    beforeEach(() => {
      userRepository.createQueryBuilder = vi.fn(() => mockQueryBuilder);
    });

    it('should filter by search term in username', async () => {
      await service.listUsers({ search: 'testuser' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('username'),
        expect.objectContaining({ search: '%testuser%' }),
      );
    });

    it('should filter by search term in email', async () => {
      await service.listUsers({ search: 'test@example.com' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('email'),
        expect.objectContaining({ search: '%test@example.com%' }),
      );
    });

    it('applies a case-insensitive search filter on username and email', async () => {
      await service.listUsers({ search: 'ali' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(user.username ILIKE :search OR user.email ILIKE :search)',
        { search: '%ali%' },
      );
    });

    it('should filter by role', async () => {
      await service.listUsers({ role: 'admin' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'role.name = :roleName',
        { roleName: 'admin' },
      );
    });

    it('should apply pagination correctly', async () => {
      await service.listUsers({ page: 2, limit: 20 });

      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(20);
      expect(mockQueryBuilder.take).toHaveBeenCalledWith(20);
    });

    it('confines the directory to a caller-resolved set of user ids', async () => {
      await service.listUsers({ userIds: ['user-1', 'user-2'] });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id IN (:...userIds)',
        { userIds: ['user-1', 'user-2'] },
      );
    });

    it('forces an empty match when the resolved user ids set is empty', async () => {
      await service.listUsers({ userIds: [] });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'user.id IN (:...userIds)',
        { userIds: [null] },
      );
    });
  });

  describe('getUserById', () => {
    it('should return the user when found and include the userRoles.role relation', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getUserById('user-123');

      expect(result).toEqual(mockUser);
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        relations: { userRoles: { role: true } },
      });
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getUserById('nonexistent-id')).rejects.toThrow(
        new NotFoundException('User with ID "nonexistent-id" not found'),
      );
    });

    it('should not filter by isActive (deliberate contrast with findActiveByEmail)', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.getUserById('user-123');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            isActive: expect.anything(),
          }),
        }),
      );
    });

    it('should pass relations: { userRoles: { role: true } } alongside the where clause', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await service.getUserById('user-123');

      expect(userRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: { userRoles: { role: true } },
        }),
      );
    });
  });
});
