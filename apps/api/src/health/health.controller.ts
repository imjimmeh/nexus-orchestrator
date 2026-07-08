import { Controller, Get } from '@nestjs/common';
import {
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthCheck,
  HealthCheckResult,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';
import { DockerHealthIndicator } from '../docker/docker.health';
import { ContextProviderHealthIndicator } from './context-provider.health';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private redis: RedisHealthIndicator,
    private docker: DockerHealthIndicator,
    private contextProviders: ContextProviderHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
      () => this.docker.isHealthy('docker'),
      () => this.contextProviders.check('context-providers'),
    ]);
  }
}
