import { registerAs } from '@nestjs/config';
import type { ContainerUrlsConfig } from './container-urls.config.types';

export const CONTAINER_URLS_CONFIG = 'containerUrls';

export type { ContainerUrlsConfig } from './container-urls.config.types';

export const containerUrlsConfig = registerAs(
  CONTAINER_URLS_CONFIG,
  (): ContainerUrlsConfig => ({
    websocketUrl:
      process.env.WEBSOCKET_URL?.trim() || 'http://host.docker.internal:3001',
    apiBaseUrl: process.env.API_BASE_URL?.trim() || 'http://nexus-api:3000',
    dockerNetwork: process.env.NEXUS_DOCKER_NETWORK?.trim() || 'nexus-network',
  }),
);
