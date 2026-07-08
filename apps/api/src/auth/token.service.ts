import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/database/entities/user.entity';
import { parseDurationToSeconds } from '../config/duration';

export type { TokenPayload, TokenPair } from './token.service.types';
import type { TokenPair, TokenPayload } from './token.service.types';

@Injectable()
export class TokenService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  generateTokens(
    user: User,
    roles: string[],
    _rememberMe?: boolean,
  ): TokenPair {
    const payload: TokenPayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      roles,
    };

    const accessExpiry = this.readAccessExpiry();

    // signOptions.expiresIn is configured at the JwtModule level in
    // auth.module.ts (reads JWT_ACCESS_EXPIRY from ConfigService), so we let
    // the module-level default govern token expiry here rather than passing a
    // redundant per-call override.
    const accessToken = this.jwtService.sign(payload);

    const expiresIn = parseDurationToSeconds(accessExpiry);

    return {
      accessToken,
      expiresIn,
    };
  }

  verifyAccessToken(token: string): TokenPayload {
    return this.jwtService.verify<TokenPayload>(token);
  }

  private readAccessExpiry(): string {
    const raw = this.configService.get<unknown>('JWT_ACCESS_EXPIRY');
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }

    return '15m';
  }
}
