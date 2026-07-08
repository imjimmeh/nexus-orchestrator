import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DockerModule } from '../docker/docker.module';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';
import { ContextProviderHealthIndicator } from './context-provider.health';
import { RedisModule } from '../redis/redis.module';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TerminusModule, DockerModule, RedisModule, SessionModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, ContextProviderHealthIndicator],
})
export class HealthModule {
  /** System health monitoring module */
  protected readonly _moduleName = 'HealthModule';
}
