import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  PasswordRequirements,
  PasswordValidationResult,
} from '@nexus/core';

@Injectable()
export class PasswordValidationService {
  constructor(private configService: ConfigService) {}

  getPasswordRequirements(): PasswordRequirements {
    return {
      minLength: this.configService.get('PASSWORD_MIN_LENGTH', 8),
      requireUppercase: this.configService.get(
        'PASSWORD_REQUIRE_UPPERCASE',
        true,
      ),
      requireLowercase: this.configService.get(
        'PASSWORD_REQUIRE_LOWERCASE',
        true,
      ),
      requireNumbers: this.configService.get('PASSWORD_REQUIRE_NUMBERS', true),
      requireSpecial: this.configService.get('PASSWORD_REQUIRE_SPECIAL', true),
    };
  }

  validatePassword(password: string): PasswordValidationResult {
    const requirements = this.getPasswordRequirements();
    const errors: string[] = [];

    if (password.length < requirements.minLength) {
      errors.push(
        `Password must be at least ${requirements.minLength} characters`,
      );
    }

    if (requirements.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (requirements.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (requirements.requireNumbers && !/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (requirements.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  }
}
