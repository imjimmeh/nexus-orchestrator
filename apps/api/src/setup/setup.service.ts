import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SecretVaultService } from '../security/secret-vault.service';
import { SecretStore } from '../security/database/entities/secret-store.entity';
import { LlmProvider } from '../ai-config/database/entities/llm-provider.entity';
import { LlmModel } from '../ai-config/database/entities/llm-model.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { SetupConfig } from '../system/database/entities/setup-config.entity';
import { AgentProfilesFileSeedService } from '../database/seeds/agent-profiles';
import { WorkflowSeedService } from '../database/seeds/workflow/workflows.seed';
import { ScopedVariableSeedService } from '../database/seeds/variables/scoped-variables.seed';
import { InitializeSetupDto } from './dto/initialize-setup.dto';

const ARCHITECT_AGENT_NAME = 'architect-agent';
const DEFAULT_SECRET_KEY_NAME = 'OPENAI_API_KEY';
const DEFAULT_TOKEN_LIMIT = 128000;

import type { ToolPolicyDocument } from '@nexus/core';

interface ArchitectSeedProfile {
  prompt: string;
  tool_policy: ToolPolicyDocument;
}

import type { SetupStatusResponse } from '@nexus/core';

@Injectable()
export class SetupService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly vault: SecretVaultService,
    private readonly scopedVariableSeedService: ScopedVariableSeedService,
    private readonly workflowSeedService: WorkflowSeedService,
    private readonly agentProfilesFileSeedService: AgentProfilesFileSeedService,
  ) {}

  async getStatus(_userRoles: string[]): Promise<SetupStatusResponse> {
    const setupConfigRepo = this.dataSource.getRepository(SetupConfig);

    let setupConfig = await setupConfigRepo.findOne({
      where: { key: 'requires_setup' },
    });
    setupConfig ??=
      // Initialize if missing
      await setupConfigRepo.save(
        setupConfigRepo.create({
          key: 'requires_setup',
          requires_setup: true,
        }),
      );

    const requiresSetup = setupConfig.requires_setup;

    // Also return resource counts for optional frontend display
    const secretRepo = this.dataSource.getRepository(SecretStore);
    const providerRepo = this.dataSource.getRepository(LlmProvider);
    const modelRepo = this.dataSource.getRepository(LlmModel);
    const profileRepo = this.dataSource.getRepository(AgentProfile);

    const [secretCount, activeProviderCount, activeModelCount, architect] =
      await Promise.all([
        secretRepo.count(),
        providerRepo.count({ where: { is_active: true } }),
        modelRepo.count({ where: { is_active: true } }),
        profileRepo.findOne({ where: { name: ARCHITECT_AGENT_NAME } }),
      ]);

    return {
      requiresSetup,
      hasAnySecret: secretCount > 0,
      hasActiveProvider: activeProviderCount > 0,
      hasActiveModel: activeModelCount > 0,
      hasArchitectProfile: Boolean(architect?.is_active),
    };
  }

  async completeSetup(): Promise<void> {
    const setupConfigRepo = this.dataSource.getRepository(SetupConfig);
    await setupConfigRepo.update(
      { key: 'requires_setup' },
      { requires_setup: false },
    );
  }

  async skipSetup(): Promise<void> {
    await this.completeSetup();
  }

  async initialize(
    userRoles: string[],
    dto: InitializeSetupDto,
  ): Promise<{ initialized: true }> {
    this.assertAdminRole(userRoles);
    const normalized = this.normalizeInitializeDto(dto);
    this.validateInitializeInput(normalized);

    await this.dataSource.transaction(async (manager) => {
      await this.initializeWithinTransaction(
        manager,
        normalized,
        dto.tokenLimit,
      );
    });

    await this.seedWorkflowsBestEffort();

    // Mark setup as complete
    await this.completeSetup();

    return { initialized: true };
  }

  private assertAdminRole(userRoles: string[]): void {
    const normalizedRoles = userRoles.map((role) => role.toLowerCase());
    if (!normalizedRoles.includes('admin')) {
      throw new ForbiddenException('Only admins can initialize setup.');
    }
  }

  private normalizeInitializeDto(dto: InitializeSetupDto): {
    providerName: string;
    modelName: string;
    secretValue: string;
    secretKeyName: string;
    secretName: string;
    providerBaseUrl?: string;
  } {
    const providerName = dto.providerName.trim();
    const modelName = dto.modelName.trim();
    const secretValue = dto.secretValue.trim();
    const secretKeyName = (dto.secretKeyName || DEFAULT_SECRET_KEY_NAME).trim();

    return {
      providerName,
      modelName,
      secretValue,
      secretKeyName,
      secretName: (dto.secretName || `${providerName}-primary`).trim(),
      providerBaseUrl: dto.providerBaseUrl?.trim() || undefined,
    };
  }

  private validateInitializeInput(input: {
    providerName: string;
    modelName: string;
    secretValue: string;
    secretKeyName: string;
  }): void {
    if (!input.providerName) {
      throw new BadRequestException('providerName is required.');
    }
    if (!input.modelName) {
      throw new BadRequestException('modelName is required.');
    }
    if (!input.secretValue) {
      throw new BadRequestException('secretValue is required.');
    }
    if (!input.secretKeyName) {
      throw new BadRequestException('secretKeyName is invalid.');
    }
  }

  private async initializeWithinTransaction(
    manager: EntityManager,
    input: {
      providerName: string;
      modelName: string;
      secretValue: string;
      secretKeyName: string;
      secretName: string;
      providerBaseUrl?: string;
    },
    tokenLimit?: number,
  ): Promise<void> {
    const secretRepo = manager.getRepository(SecretStore);
    const providerRepo = manager.getRepository(LlmProvider);
    const modelRepo = manager.getRepository(LlmModel);
    const profileRepo = manager.getRepository(AgentProfile);

    const secret = await this.upsertSetupSecret(secretRepo, input);
    const provider = await this.upsertSetupProvider(
      providerRepo,
      input,
      secret.id,
    );

    await modelRepo
      .createQueryBuilder()
      .update(LlmModel)
      .set({
        default_for_execution: false,
        default_for_distillation: false,
        default_for_summarization: false,
        default_for_session: false,
      })
      .execute();

    const model = await this.upsertSetupModel(
      modelRepo,
      input.providerName,
      input.modelName,
      tokenLimit,
    );

    await this.upsertArchitectProfile(profileRepo, model.name, provider.name);
  }

  private async upsertSetupSecret(
    secretRepo: Repository<SecretStore>,
    input: {
      providerName: string;
      secretValue: string;
      secretKeyName: string;
      secretName: string;
    },
  ): Promise<SecretStore> {
    const encryptedValue = this.vault.encrypt(
      JSON.stringify({ [input.secretKeyName]: input.secretValue }),
    );

    const existing = await secretRepo.findOne({
      where: { name: input.secretName },
    });
    const merged = existing
      ? secretRepo.merge(existing, {
          encrypted_value: encryptedValue,
          metadata: {
            source: 'first-login-setup',
            provider: input.providerName,
            keyName: input.secretKeyName,
          },
        })
      : secretRepo.create({
          name: input.secretName,
          encrypted_value: encryptedValue,
          metadata: {
            source: 'first-login-setup',
            provider: input.providerName,
            keyName: input.secretKeyName,
          },
        });

    return secretRepo.save(merged);
  }

  private async upsertSetupProvider(
    providerRepo: Repository<LlmProvider>,
    input: { providerName: string; providerBaseUrl?: string },
    secretId: string,
  ): Promise<LlmProvider> {
    const runtimeEnv = input.providerBaseUrl
      ? { OPENAI_BASE_URL: input.providerBaseUrl }
      : {};
    const existing = await providerRepo.findOne({
      where: { name: input.providerName },
    });

    const merged = existing
      ? providerRepo.merge(existing, {
          auth_type: 'api_key',
          secret_id: secretId,
          runtime_env: runtimeEnv,
          is_active: true,
        })
      : providerRepo.create({
          name: input.providerName,
          auth_type: 'api_key',
          secret_id: secretId,
          runtime_env: runtimeEnv,
          is_active: true,
        });

    return providerRepo.save(merged);
  }

  private async upsertSetupModel(
    modelRepo: Repository<LlmModel>,
    providerName: string,
    modelName: string,
    tokenLimit?: number,
  ): Promise<LlmModel> {
    const existing = await modelRepo.findOne({ where: { name: modelName } });
    const modelPayload = {
      provider_name: providerName,
      token_limit: tokenLimit || DEFAULT_TOKEN_LIMIT,
      default_for_execution: true,
      default_for_distillation: true,
      default_for_summarization: true,
      default_for_session: true,
      is_active: true,
    };

    const merged = existing
      ? modelRepo.merge(existing, modelPayload)
      : modelRepo.create({ name: modelName, ...modelPayload });

    return modelRepo.save(merged);
  }

  private async upsertArchitectProfile(
    profileRepo: Repository<AgentProfile>,
    modelName: string,
    providerName: string,
  ): Promise<void> {
    const architectSeedProfile = this.resolveArchitectSeedProfile();
    const architect = await profileRepo.findOne({
      where: { name: ARCHITECT_AGENT_NAME },
    });

    if (!architect) {
      await this.createArchitectProfile(
        profileRepo,
        modelName,
        providerName,
        architectSeedProfile,
      );
      return;
    }

    await this.updateArchitectProfile(
      profileRepo,
      architect,
      modelName,
      providerName,
      architectSeedProfile,
    );
  }

  private async createArchitectProfile(
    profileRepo: Repository<AgentProfile>,
    modelName: string,
    providerName: string,
    seedProfile: ArchitectSeedProfile | null,
  ): Promise<void> {
    if (!seedProfile || !seedProfile.tool_policy) {
      throw new BadRequestException(
        'Setup cannot create architect-agent because its seed prompt or tool policy is missing from seed/agents.',
      );
    }

    await profileRepo.save(
      profileRepo.create({
        name: ARCHITECT_AGENT_NAME,
        system_prompt: seedProfile.prompt,
        model_name: modelName,
        provider_name: providerName,
        tier_preference: 'heavy',
        tool_policy: seedProfile.tool_policy,
        is_active: true,
      }),
    );
  }

  private async updateArchitectProfile(
    profileRepo: Repository<AgentProfile>,
    architect: AgentProfile,
    modelName: string,
    providerName: string,
    seedProfile: ArchitectSeedProfile | null,
  ): Promise<void> {
    const resolvedSystemPrompt = architect.system_prompt || seedProfile?.prompt;
    if (!resolvedSystemPrompt) {
      throw new BadRequestException(
        'Setup cannot update architect-agent because no system prompt is available.',
      );
    }

    const resolvedToolPolicy =
      architect.tool_policy || seedProfile?.tool_policy;
    if (!resolvedToolPolicy) {
      throw new BadRequestException(
        'Setup cannot update architect-agent because no tool policy is available.',
      );
    }

    await profileRepo.save(
      profileRepo.merge(architect, {
        system_prompt: resolvedSystemPrompt,
        model_name: modelName,
        provider_name: providerName,
        tier_preference: architect.tier_preference || 'heavy',
        tool_policy: resolvedToolPolicy,
        is_active: true,
      }),
    );
  }

  private resolveArchitectSeedProfile(): ArchitectSeedProfile | null {
    const { definitions } = this.agentProfilesFileSeedService.loadDefinitions();
    const architectDefinition = definitions.find(
      (definition) => definition.name === ARCHITECT_AGENT_NAME,
    );

    const prompt = architectDefinition?.system_prompt?.trim();
    if (!prompt || !architectDefinition?.tool_policy) {
      return null;
    }

    return {
      prompt,
      tool_policy: architectDefinition.tool_policy,
    };
  }

  private async seedWorkflowsBestEffort(): Promise<void> {
    try {
      await this.scopedVariableSeedService.seed();
      await this.workflowSeedService.seed();
    } catch (error) {
      const err = error as Error;
      console.error(`[SetupService] Failed to seed workflows: ${err.message}`);
      // Don't fail setup if workflow seeding fails; this is best-effort
    }
  }
}
