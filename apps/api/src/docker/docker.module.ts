import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import Docker from 'dockerode';
import { ContainerOrchestratorService } from './container-orchestrator.service';
import { ContainerCleanupService } from './container-cleanup.service';
import { ContainerHttpClientService } from './container-http-client.service';
import { DockerHealthIndicator } from './docker.health';
import { DOCKER_CLIENT } from './docker.constants';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    BullModule.registerQueue({
      name: 'container-cleanup',
    }),
  ],
  providers: [
    {
      provide: DOCKER_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const socketPath = configService.get<string>('DOCKER_SOCKET_PATH');
        const host = configService.get<string>('DOCKER_HOST');

        if (host) {
          return new Docker({ host });
        }
        return new Docker({ socketPath });
      },
    },
    ContainerOrchestratorService,
    ContainerCleanupService,
    ContainerHttpClientService,
    DockerHealthIndicator,
  ],
  exports: [
    DOCKER_CLIENT,
    ContainerOrchestratorService,
    ContainerHttpClientService,
    DockerHealthIndicator,
  ],
})
export class DockerModule {
  /** Docker container orchestration module */
  protected readonly _moduleName = 'DockerModule';
}
