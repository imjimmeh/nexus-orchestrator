import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import type { CreateUserRequest, UpdateUserRequest } from '@nexus/core';
import { User } from './database/entities/user.entity';
import { Role } from '../auth/database/entities/role.entity';
import { UserRole } from '../auth/database/entities/user-role.entity';
import { PasswordValidationService } from '../auth/password-validation.service';
import { PasswordHashingService } from '../auth/password-hashing.service';

export type { PaginatedUsersResult } from './users.service.types';
import type { PaginatedUsersResult } from './users.service.types';

interface LegacyCreateUserInput {
  username: string;
  email: string;
  password: string;
  roleIds?: string[];
  isActive?: boolean;
}

interface LegacyUpdateUserInput {
  username?: string;
  email?: string;
  isActive?: boolean;
  roleIds?: string[];
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    private readonly passwordValidationService: PasswordValidationService,
    private readonly passwordHashingService: PasswordHashingService,
  ) {}

  // Backward-compatible API used by legacy tests and older callers.
  async findAll(page = 1, limit = 10): Promise<PaginatedUsersResult> {
    const [data, total] = await this.userRepository.findAndCount({
      where: { isActive: true },
      skip: (page - 1) * limit,
      take: limit,
      relations: { userRoles: { role: true } },
      order: { createdAt: 'DESC' },
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Backward-compatible API used by legacy tests and older callers.
  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, isActive: true },
      relations: { userRoles: { role: true } },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  // Backward-compatible API used by legacy tests and older callers.
  async create(input: LegacyCreateUserInput): Promise<User> {
    // The helper preserves the legacy message format `User with email "${input.email}"
    // already exists` — the legacy `create` conflict test still passes unchanged.
    await this.assertEmailUnique(input.email);

    const validationResult = this.passwordValidationService.validatePassword(
      input.password,
    );
    if (!validationResult.valid) {
      throw new ForbiddenException(
        `Password validation failed: ${validationResult.errors.join(', ')}`,
      );
    }

    const passwordHash = await this.passwordHashingService.hash(input.password);
    const createPayload: Partial<User> & Record<string, unknown> = {
      ...input,
      passwordHash,
      isActive: input.isActive ?? true,
    };

    const user = this.userRepository.create(createPayload);
    const savedUser = await this.userRepository.save(user);

    if (input.roleIds && input.roleIds.length > 0) {
      // Inline equivalent of the former assignRolesToUser helper so the legacy
      // `findBy([{id: ...}])`-shaped test mocks keep passing unchanged. This
      // legacy path is slated for removal in child-2.
      const roles = await this.roleRepository.findBy(
        input.roleIds.map((id) => ({ id })),
      );

      if (roles.length !== input.roleIds.length) {
        const foundRoleIds = roles.map((r: Role) => r.id);
        const missingRoleIds = input.roleIds.filter(
          (id) => !foundRoleIds.includes(id),
        );
        throw new NotFoundException(
          `Roles not found: ${missingRoleIds.join(', ')}`,
        );
      }

      const userRoles = input.roleIds.map((roleId) =>
        this.userRoleRepository.create({
          userId: savedUser.id,
          roleId,
        }),
      );

      await this.userRoleRepository.save(userRoles);
    }

    return this.findOne(savedUser.id);
  }

  // Backward-compatible API used by legacy tests and older callers.
  async update(id: string, input: LegacyUpdateUserInput): Promise<User> {
    const existing = await this.findOne(id);

    if (input.email && input.email !== existing.email) {
      await this.assertEmailUnique(input.email, id);
    }

    if (input.roleIds !== undefined) {
      await this.userRoleRepository.delete({ userId: id });
      if (input.roleIds.length > 0) {
        // Inline equivalent of the former assignRolesToUser helper so the legacy
        // `findBy([{id: ...}])`-shaped test mocks keep passing unchanged.
        const roles = await this.roleRepository.findBy(
          input.roleIds.map((rid) => ({ id: rid })),
        );

        if (roles.length !== input.roleIds.length) {
          const foundRoleIds = roles.map((r: Role) => r.id);
          const missingRoleIds = input.roleIds.filter(
            (rid) => !foundRoleIds.includes(rid),
          );
          throw new NotFoundException(
            `Roles not found: ${missingRoleIds.join(', ')}`,
          );
        }

        const userRoles = input.roleIds.map((roleId) =>
          this.userRoleRepository.create({
            userId: id,
            roleId,
          }),
        );

        await this.userRoleRepository.save(userRoles);
      }
    }

    const updatePayload: Partial<User> = {};
    if (input.username !== undefined) {
      updatePayload.username = input.username;
    }
    if (input.email !== undefined) {
      updatePayload.email = input.email;
    }
    if (input.isActive !== undefined) {
      updatePayload.isActive = input.isActive;
    }

    await this.userRepository.update(id, updatePayload);
    return Object.assign({}, existing, updatePayload);
  }

  // Backward-compatible API used by legacy tests and older callers.
  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.userRepository.update(id, {
      isActive: false,
      deactivatedAt: new Date(),
    });
  }

  async listUsers(query: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isActive?: boolean;
    userIds?: string[];
  }): Promise<PaginatedUsersResult> {
    const page = query.page || 1;
    const limit = query.limit || 10;

    const where: FindOptionsWhere<User> = {};
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.userRoles', 'userRoles')
      .leftJoinAndSelect('userRoles.role', 'role')
      .where(where);

    if (query.search) {
      queryBuilder.andWhere(
        '(user.username ILIKE :search OR user.email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.role) {
      queryBuilder.andWhere('role.name = :roleName', { roleName: query.role });
    }

    // Confines the directory to a caller-resolved set of user ids (e.g. the
    // role-assignments at a scope node), used by UsersController.listUsers
    // when a scopeNodeId is supplied.
    if (query.userIds !== undefined) {
      queryBuilder.andWhere('user.id IN (:...userIds)', {
        userIds: query.userIds.length > 0 ? query.userIds : [null],
      });
    }

    queryBuilder
      .skip((page - 1) * limit)
      .take(limit)
      .orderBy('user.createdAt', 'DESC');

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserById(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: { userRoles: { role: true } },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    return user;
  }

  /**
   * Looks up an ACTIVE user by email — `isActive: true` is included in the
   * SQL `where` clause, so deactivated users are never returned.
   *
   * This is the lookup that auth/login flows should use: deactivated accounts
   * must not authenticate. Callers that explicitly need to consider
   * deactivated users (e.g. admin tooling, re-registration of a previously
   * deactivated email) must use {@link findByEmailIncludingInactive} instead.
   *
   * @param email The email address to look up (matched exactly, case-folded
   *              by the database collation).
   * @returns The matching active user (with `userRoles.role` eagerly joined),
   *          or `null` when no active user has that email.
   */
  async findActiveByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email, isActive: true },
      relations: { userRoles: { role: true } },
    });
  }

  /**
   * Looks up a user by email WITHOUT any `isActive` filter — deactivated
   * users WILL be returned by this method.
   *
   * Intended for admin and migration flows where the caller needs to see
   * every row that matches the email regardless of soft-delete state.
   * Authentication flows must NOT use this method; they should use
   * {@link findActiveByEmail} instead.
   *
   * @param email The email address to look up (matched exactly, case-folded
   *              by the database collation).
   * @returns The matching user (with `userRoles.role` eagerly joined) — which
   *          may be deactivated — or `null` when no user has that email.
   */
  async findByEmailIncludingInactive(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      relations: { userRoles: { role: true } },
    });
  }

  async createUser(createUserDto: CreateUserRequest): Promise<User> {
    await this.assertEmailUnique(createUserDto.email);

    const user = this.userRepository.create({
      username: createUserDto.username,
      email: createUserDto.email,
      passwordHash: await this.validateAndHashPassword(createUserDto.password),
      isActive: createUserDto.isActive ?? true,
    });

    const savedUser = await this.userRepository.save(user);

    if (createUserDto.role) {
      const role = await this.roleRepository.findOne({
        where: { name: createUserDto.role },
      });
      if (role) {
        await this.applyUserRoles(savedUser.id, [role.id]);
      }
    }

    return this.getUserById(savedUser.id);
  }

  async updateUser(
    id: string,
    updateUserDto: UpdateUserRequest,
  ): Promise<User> {
    const user = await this.getUserById(id);

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      await this.assertEmailUnique(updateUserDto.email, id);
    }

    if (updateUserDto.role) {
      const role = await this.roleRepository.findOne({
        where: { name: updateUserDto.role },
      });
      if (role) {
        await this.applyUserRoles(id, [role.id]);
      }
    }

    const updateData: Partial<User> = {};
    if (updateUserDto.username) updateData.username = updateUserDto.username;
    if (updateUserDto.email) updateData.email = updateUserDto.email;
    if (updateUserDto.isActive !== undefined)
      updateData.isActive = updateUserDto.isActive;

    await this.userRepository.update(id, updateData);

    return this.getUserById(id);
  }

  async disableUser(id: string): Promise<void> {
    await this.softDeleteUser(id);
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found`);
    }

    const passwordHash = await this.validateAndHashPassword(newPassword);
    await this.userRepository.update(id, {
      passwordHash,
      passwordChangedAt: new Date(),
    });
  }

  async validatePassword(
    userId: string,
    plainPassword: string,
  ): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user || !user.passwordHash) {
      return false;
    }

    return this.passwordHashingService.verify(plainPassword, user.passwordHash);
  }

  /**
   * Asserts that no other ACTIVE user already uses `email`.
   *
   * Filters by `isActive: true` so that an admin can re-use the email of a
   * previously deactivated user (whose row stays in the table for audit).
   * Pass `excludeUserId` from update paths so the user being updated does not
   * conflict with itself.
   *
   * @throws when a different active user row matches; the message reads
   *         `User with email "${email}" already exists`.
   */
  private async assertEmailUnique(
    email: string,
    excludeUserId?: string,
  ): Promise<void> {
    const existing = await this.userRepository.findOne({
      where: { email, isActive: true },
    });
    if (existing && existing.id !== excludeUserId) {
      throw new ConflictException(`User with email "${email}" already exists`);
    }
  }

  /**
   * Marks a user as deactivated by setting `isActive = false` and stamping
   * `deactivatedAt`. Reversible only via a direct DB write — there is no
   * `reactivateUser` API in this module.
   *
   * @throws NotFoundException (via `getUserById`) when the user does not exist.
   */
  private async softDeleteUser(id: string): Promise<void> {
    await this.getUserById(id);
    await this.userRepository.update(id, {
      isActive: false,
      deactivatedAt: new Date(),
    });
  }

  /**
   * Ensures the user has EXACTLY the given set of role ids.
   *
   * Pipeline:
   *   1. Delete any existing `UserRole` rows for `userId`.
   *   2. If `roleIds` is empty, return early (the user is now role-less).
   *   3. Validate that every requested role id exists in `roleRepository`;
   *      throw `NotFoundException` listing the missing ids when any do not.
   *   4. Insert new `UserRole` rows for the surviving ids.
   *
   * @throws NotFoundException when one or more requested role ids do not exist.
   */
  private async applyUserRoles(
    userId: string,
    roleIds: string[],
  ): Promise<void> {
    await this.userRoleRepository.delete({ userId });

    if (roleIds.length === 0) {
      return;
    }

    const foundRoles = await this.roleRepository.find({
      where: { id: In(roleIds) },
    });
    const foundIds = new Set(foundRoles.map((r) => r.id));
    const missingIds = roleIds.filter((rid) => !foundIds.has(rid));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Role(s) not found: ${missingIds.join(', ')}`,
      );
    }

    const links = roleIds.map((roleId) =>
      this.userRoleRepository.create({ userId, roleId }),
    );
    await this.userRoleRepository.save(links);
  }

  /**
   * Canonical password-validation-then-hash pipeline.
   *
   * 1. Delegates to `PasswordValidationService.validatePassword(plain)`.
   * 2. Throws `ForbiddenException` with the joined error messages when invalid.
   * 3. Otherwise hashes the plaintext and returns the resulting hash.
   */
  private async validateAndHashPassword(plain: string): Promise<string> {
    const validation = this.passwordValidationService.validatePassword(plain);
    if (!validation.valid) {
      throw new ForbiddenException(validation.errors.join('; '));
    }
    return this.passwordHashingService.hash(plain);
  }
}
