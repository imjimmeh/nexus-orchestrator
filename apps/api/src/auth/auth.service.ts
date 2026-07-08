import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { UserRepository } from '../users/database/repositories/user.repository';
import { RoleRepository } from './database/repositories/role.repository';
import { UserRoleRepository } from './database/repositories/user-role.repository';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import { PasswordHashingService } from './password-hashing.service';
import {
  RegisterRequest,
  LoginRequest,
  RegisterResponse,
  LoginResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
} from '@nexus/core';

@Injectable()
export class AuthService {
  constructor(
    private readonly passwordHashingService: PasswordHashingService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly roleRepository: RoleRepository,
    private readonly tokenService: TokenService,
    private readonly userRepository: UserRepository,
    private readonly userRoleRepository: UserRoleRepository,
  ) {}

  async register(dto: RegisterRequest): Promise<RegisterResponse> {
    const existingUser = await this.userRepository.findByUsername(dto.username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const existingEmail = await this.userRepository.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictException('Email already exists');
    }

    const passwordHash = await this.passwordHashingService.hash(dto.password);

    const userCount = await this.userRepository.count();
    const roleName = userCount === 0 ? 'admin' : 'user';
    const role = await this.roleRepository.findOne({
      where: { name: roleName },
    });

    if (!role) {
      throw new Error(`Role ${roleName} not found`);
    }

    const user = this.userRepository.create({
      username: dto.username,
      email: dto.email,
      passwordHash,
    });
    await this.userRepository.save(user);

    await this.userRoleRepository.save({
      user,
      role,
    });

    const { accessToken } = this.tokenService.generateTokens(user, [roleName]);
    const refreshToken =
      await this.refreshTokenService.createRefreshToken(user);

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: [roleName],
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken,
    };
  }

  async login(dto: LoginRequest): Promise<LoginResponse> {
    const user = await this.userRepository.findByUsername(dto.username);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await this.passwordHashingService.verify(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Account is disabled');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const userWithRoles = await this.userRepository.findWithRoles(user.id);
    const roles = userWithRoles?.userRoles.map((ur) => ur.role.name) || [];

    const { accessToken, expiresIn } = this.tokenService.generateTokens(
      user,
      roles,
      dto.rememberMe,
    );
    const refreshToken = await this.refreshTokenService.createRefreshToken(
      user,
      dto.rememberMe,
    );

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        roles: roles as ('admin' | 'user')[],
        createdAt: user.createdAt.toISOString(),
      },
      accessToken,
      refreshToken,
      expiresIn,
    };
  }

  async refreshToken(dto: RefreshTokenRequest): Promise<RefreshTokenResponse> {
    const row = await this.refreshTokenService.validateRefreshToken(
      dto.refreshToken,
    );
    if (!row) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.refreshTokenService.revokeRefreshToken(dto.refreshToken);

    const user = row.user;
    const userWithRoles = await this.userRepository.findWithRoles(user.id);
    const roles = userWithRoles?.userRoles.map((ur) => ur.role.name) || [];

    const { accessToken, expiresIn } = this.tokenService.generateTokens(
      user,
      roles,
    );
    const newRefreshToken =
      await this.refreshTokenService.createRefreshToken(user);

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn,
    };
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.refreshTokenService.revokeRefreshToken(refreshToken);
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserTokens(userId);
  }

  async getMe(userId: string) {
    const user = await this.userRepository.findWithRoles(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      roles,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
