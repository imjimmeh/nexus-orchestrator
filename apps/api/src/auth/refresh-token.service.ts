import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { hashRefreshToken } from './refresh-token-hash.util';
import { REFRESH_TOKEN_HMAC_KEY } from './refresh-token-key.provider';
import { RefreshTokenRepository } from '../security/database/repositories/refresh-token.repository';
import { RefreshToken } from '../security/database/entities/refresh-token.entity';
import { User } from '../users/database/entities/user.entity';

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(REFRESH_TOKEN_HMAC_KEY) private readonly hmacKey: string,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly configService: ConfigService,
  ) {}

  async createRefreshToken(
    user: User,
    rememberMe: boolean = false,
    deviceInfo?: string,
  ): Promise<string> {
    const plainToken = crypto.randomBytes(64).toString('hex');
    const tokenHash = hashRefreshToken(plainToken, this.hmacKey);

    const expiryDays = rememberMe
      ? this.readNumericSetting('JWT_REFRESH_REMEMBER_ME_DAYS', 30)
      : this.readRefreshExpiryDays();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    await this.refreshTokenRepository.save(
      this.refreshTokenRepository.create({
        user,
        tokenHash,
        expiresAt,
        deviceInfo,
      }),
    );

    return plainToken;
  }

  async validateRefreshToken(plainToken: string): Promise<RefreshToken | null> {
    const tokenHash = hashRefreshToken(plainToken, this.hmacKey);
    const row = await this.refreshTokenRepository.findByTokenHash(tokenHash);
    if (!row) return null;
    if (row.expiresAt < new Date()) return null;
    if (row.isRevoked) return null;
    return row;
  }

  async revokeRefreshToken(plainToken: string): Promise<RefreshToken | null> {
    const tokenHash = hashRefreshToken(plainToken, this.hmacKey);
    const row = await this.refreshTokenRepository.findByTokenHash(tokenHash);
    if (!row) return null;
    if (row.isRevoked) return null;
    row.isRevoked = true;
    await this.refreshTokenRepository.save(row);
    return row;
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { user: { id: userId }, isRevoked: false },
      { isRevoked: true },
    );
  }

  private readNumericSetting(key: string, fallback: number): number {
    const raw = this.configService.get<unknown>(key);
    if (raw === undefined) {
      return fallback;
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }

    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return fallback;
  }

  private readRefreshExpiryDays(): number {
    const legacyDays = this.readNumericSetting('JWT_REFRESH_EXPIRY_DAYS', -1);
    if (legacyDays > 0) {
      return legacyDays;
    }

    const configured = this.configService.get<unknown>('JWT_REFRESH_EXPIRY');
    if (typeof configured === 'number' && Number.isFinite(configured)) {
      return Math.max(1, Math.floor(configured));
    }

    if (typeof configured === 'string') {
      const normalized = configured.trim().toLowerCase();
      const numberOnly = Number.parseInt(normalized, 10);
      if (Number.isFinite(numberOnly) && String(numberOnly) === normalized) {
        return Math.max(1, numberOnly);
      }

      const durationMatch = normalized.match(/^(\d+)([smhd])$/);
      if (durationMatch) {
        const [, amountRaw, unit] = durationMatch;
        const amount = Number.parseInt(amountRaw, 10);
        if (Number.isFinite(amount)) {
          const secondsByUnit: Record<'s' | 'm' | 'h' | 'd', number> = {
            s: 1,
            m: 60,
            h: 3600,
            d: 86400,
          };
          const seconds = amount * secondsByUnit[unit as 's' | 'm' | 'h' | 'd'];
          return Math.max(1, Math.ceil(seconds / 86400));
        }
      }
    }

    return 7;
  }
}
