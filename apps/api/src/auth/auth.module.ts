import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { InternalServiceScopeGuard } from './internal-service-scope.guard';
import { PasswordHashingService } from './password-hashing.service';
import { TokenService } from './token.service';
import { RefreshTokenService } from './refresh-token.service';
import {
  REFRESH_TOKEN_HMAC_KEY,
  REFRESH_TOKEN_HMAC_KEY_SOURCE,
  RefreshTokenHmacKeyProvider,
} from './refresh-token-key.provider';

@Module({
  imports: [
    DatabaseModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_ACCESS_EXPIRY',
            '15m',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    AuthService,
    TokenService,
    RefreshTokenService,
    JwtAuthGuard,
    InternalServiceScopeGuard,
    PasswordHashingService,
    RefreshTokenHmacKeyProvider,
    {
      provide: REFRESH_TOKEN_HMAC_KEY,
      useFactory: (provider: RefreshTokenHmacKeyProvider) =>
        provider.resolveHmacKey(),
      inject: [RefreshTokenHmacKeyProvider],
    },
    {
      provide: REFRESH_TOKEN_HMAC_KEY_SOURCE,
      useFactory: (provider: RefreshTokenHmacKeyProvider) =>
        provider.resolveSource(),
      inject: [RefreshTokenHmacKeyProvider],
    },
  ],
  exports: [
    JwtModule,
    AuthService,
    TokenService,
    RefreshTokenService,
    JwtAuthGuard,
    InternalServiceScopeGuard,
    PasswordHashingService,
    RefreshTokenHmacKeyProvider,
    REFRESH_TOKEN_HMAC_KEY,
    REFRESH_TOKEN_HMAC_KEY_SOURCE,
  ],
})
export class AuthModule {
  /** Authentication and Authorization Module */
  protected readonly _moduleName = 'AuthModule';
}
