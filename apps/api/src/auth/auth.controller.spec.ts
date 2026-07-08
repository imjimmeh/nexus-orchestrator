// apps/api/src/auth/auth.controller.spec.ts
import { describe, it, beforeEach, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  RegisterRequestSchema,
  LoginRequestSchema,
  RefreshTokenRequestSchema,
} from '@nexus/core';

const mockAuthService = {
  register: vi.fn(),
  login: vi.fn(),
  refreshToken: vi.fn(),
  logout: vi.fn(),
};

describe('AuthController — input validation', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
    vi.clearAllMocks();
  });

  describe('happy path', () => {
    it('register — calls authService with valid input', async () => {
      const validInput = {
        username: 'alice',
        password: 'P@ssw0rd1!',
        email: 'alice@example.com',
      };
      const mockResult = {
        id: '123',
        username: 'alice',
        email: 'alice@example.com',
      };
      mockAuthService.register.mockResolvedValue(mockResult);

      const result = await controller.register(validInput);

      expect(result).toHaveProperty('success', true);
      expect(result.data).toEqual(mockResult);
      expect(mockAuthService.register).toHaveBeenCalledWith(validInput);
    });

    it('login — calls authService with valid input', async () => {
      const validInput = {
        username: 'alice',
        password: 'P@ssw0rd1!',
        rememberMe: false,
      };
      const mockResult = {
        accessToken: 'token123',
        refreshToken: 'refresh123',
      };
      mockAuthService.login.mockResolvedValue(mockResult);

      const result = await controller.login(validInput);

      expect(result).toHaveProperty('success', true);
      expect(result.data).toEqual(mockResult);
      expect(mockAuthService.login).toHaveBeenCalledWith(validInput);
    });

    it('refresh — calls authService with valid input', async () => {
      const validInput = {
        refreshToken: 'refresh123',
      };
      const mockResult = {
        accessToken: 'new_token123',
        refreshToken: 'new_refresh123',
      };
      mockAuthService.refreshToken.mockResolvedValue(mockResult);

      const result = await controller.refresh(validInput);

      expect(result).toHaveProperty('success', true);
      expect(result.data).toEqual(mockResult);
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith(validInput);
    });
  });

  describe('validation errors', () => {
    it('register — rejects invalid email', () => {
      const pipe = new ZodValidationPipe(RegisterRequestSchema);
      expect(() =>
        pipe.transform(
          { username: 'alice', password: 'P@ssw0rd1', email: 'not-an-email' },
          { type: 'body' } as any,
        ),
      ).toThrow(BadRequestException);
    });

    it('login — rejects empty password', () => {
      const pipe = new ZodValidationPipe(LoginRequestSchema);
      expect(() =>
        pipe.transform({ username: 'alice', password: '', rememberMe: false }, {
          type: 'body',
        } as any),
      ).toThrow(BadRequestException);
    });

    it('refresh — rejects missing refreshToken', () => {
      const pipe = new ZodValidationPipe(RefreshTokenRequestSchema);
      expect(() => pipe.transform({}, { type: 'body' } as any)).toThrow(
        BadRequestException,
      );
    });
  });
});
