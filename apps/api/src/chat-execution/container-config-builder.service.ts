import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContainerTier,
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
  IContainerConfig,
} from '@nexus/core';
import type { ResolvedRunnerProviderConfig } from '../ai-config/ai-configuration.service';
import type { ContainerUrlsConfig } from '../config/container-urls.config';
import { CONTAINER_URLS_CONFIG } from '../config/container-urls.config';
import type { ContainerBuildInput } from './container-config-builder.service.types';

export type { ContainerBuildInput } from './container-config-builder.service.types';

@Injectable()
export class ContainerConfigBuilderService {
  constructor(private readonly configService: ConfigService) {}

  build(input: ContainerBuildInput): IContainerConfig {
    const tier = this.resolveContainerTier(input.containerTier);
    const image = this.resolveContainerImage(tier);

    const containerUrls = this.configService.get<ContainerUrlsConfig>(
      CONTAINER_URLS_CONFIG,
    );
    if (!containerUrls) {
      throw new Error('Container URLs configuration is not available');
    }

    const env: Record<string, string> = {
      CHAT_SESSION_ID: input.chatSessionId,
      STEP_ID: input.chatSessionId,
      AGENT_JWT: input.agentToken,
      WEBSOCKET_URL: containerUrls.websocketUrl,
      API_BASE_URL: containerUrls.apiBaseUrl,
      WORKSPACE_PATH: '/workspace',
      EXTENSIONS_PATH: CONTAINER_EXTENSIONS_PATH,
      SESSION_PATH: CONTAINER_SESSION_PATH,
      AGENT_PROFILE: input.agentProfileName,
      INITIAL_MESSAGE: input.initialMessage,
      MODEL: input.aiSettings.model,
      ...this.buildProviderRuntimeEnv(input.providerConfig),
    };

    const volumes = [
      {
        hostPath: input.toolMountPath,
        containerPath: CONTAINER_EXTENSIONS_PATH,
        readOnly: true,
      },
    ];

    const labels: Record<string, string> = {
      'nexus.chat_session_id': input.chatSessionId,
      'nexus.agent_profile': input.agentProfileName,
      'nexus.managed': 'true',
      'nexus.tier': tier,
    };

    return {
      image,
      tier,
      env,
      volumes,
      labels,
    };
  }

  private resolveContainerTier(containerTier: number | string): ContainerTier {
    return String(containerTier).trim() === '2'
      ? ContainerTier.HEAVY
      : ContainerTier.LIGHT;
  }

  private resolveContainerImage(tier: ContainerTier): string {
    const imageEnvVar =
      tier === ContainerTier.HEAVY
        ? 'NEXUS_HEAVY_CONTAINER_IMAGE'
        : 'NEXUS_LIGHT_CONTAINER_IMAGE';
    return (
      process.env[imageEnvVar] ||
      (tier === ContainerTier.HEAVY
        ? 'nexus-heavy:latest'
        : 'nexus-light:latest')
    );
  }

  private buildProviderRuntimeEnv(
    providerConfig: ResolvedRunnerProviderConfig,
  ): Record<string, string> {
    const baseEnv: Record<string, string> = {
      PROVIDER: providerConfig.provider,
    };

    if (providerConfig.auth.type !== 'api_key') {
      return baseEnv;
    }

    return {
      ...baseEnv,
      ...(providerConfig.apiKey ? { API_KEY: providerConfig.apiKey } : {}),
      ...providerConfig.providerEnv,
    };
  }
}
