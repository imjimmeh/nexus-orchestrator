import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

/**
 * Default bcrypt cost factor used when `PASSWORD_HASH_COST_FACTOR` is not set.
 *
 * Centralizing the cost-factor literal here keeps every call site consistent
 * and makes future password-rehash-on-login or work-factor migration a
 * one-file change instead of N.
 */
const DEFAULT_PASSWORD_HASH_COST_FACTOR = 12;

/**
 * Single source of truth for password hashing and verification in the
 * NestJS API. All `bcrypt.hash` / `bcrypt.compare` call sites must route
 * through this service so that:
 *
 * - the cost factor is read from config (env `PASSWORD_HASH_COST_FACTOR`)
 *   instead of being repeated at every call site;
 * - any future hardening (password-rehash-on-login, timing-attack
 *   mitigation, alternative algorithm) lands in one place.
 */
@Injectable()
export class PasswordHashingService {
  private readonly costFactor: number;

  constructor(configService: ConfigService) {
    this.costFactor = configService.get<number>(
      'PASSWORD_HASH_COST_FACTOR',
      DEFAULT_PASSWORD_HASH_COST_FACTOR,
    );
  }

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.costFactor);
  }

  async verify(plain: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plain, hashed);
  }
}
