import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SecurityModule } from '../security/security.module';
import { CapabilityInfraModule } from '../capability-infra/capability-infra.module';
import { AiConfigurationService } from './ai-configuration.service';
import { AiConfigAdminService } from './ai-config-admin.service';
import {
  ProvidersController,
  ModelsController,
  AgentProfilesController,
  AgentSkillsController,
  SecretsController,
  SecretsInternalController,
  ModelsInternalController,
  ProviderOAuthController,
  FallbackChainsController,
} from './controllers';
import {
  DatabaseModelStrategy,
  EnvironmentModelStrategy,
  ModelSelectionFactory,
} from './strategies/model-selection';
import {
  ProviderCrudService,
  ModelCrudService,
  ProfileCrudService,
} from './services/crud';
import { AgentFactoryService } from './services/agent-factory.service';
import { AgentSkillsService } from './services/agent-skills.service';
import { AgentSkillLibraryService } from './services/agent-skill-library.service';
import { ArtifactLibraryService } from './services/artifact-library.service';
import { ProviderReferenceService } from './services/provider-reference.service';
import { ProviderOAuthService } from './services/provider-oauth.service';
import { ProviderOAuthLinkService } from './services/provider-oauth-link.service';
import { OAuthModule } from '../oauth/oauth.module';
import { SkillIndexService } from './services/skill-search/skill-index.service';
import { TokenMatchStrategy } from './services/skill-search/strategies/token-match.strategy';
import { FuzzyMatchStrategy } from './services/skill-search/strategies/fuzzy-match.strategy';
import { TfIdfMatchStrategy } from './services/skill-search/strategies/tfidf-match.strategy';
import { SkillSearchPipelineService } from './services/skill-search/skill-search-pipeline.service';
import { AgentProfileResolutionService } from './services/agent-profile-resolution.service';
import { SkillService } from './services/skill.service';
import { ConfigResolutionModule } from '../config-resolution/config-resolution.module';
import { GitOpsModule } from '../gitops/gitops.module';
import { ProviderCredentialService } from './services/provider-credential.service';
import { RunnerProviderSelectionService } from './services/runner-provider-selection.service';
import { ThinkingLevelCapabilityService } from './services/thinking-level-capability.service';
import { ThinkingLevelResolver } from './services/thinking-level-resolver.service';
import { FallbackChainResolverService } from './fallback/fallback-chain-resolver.service';
import { ProviderFallbackService } from './fallback/provider-fallback.service';
import { ScopeModule } from '../scope/scope.module';
import { AgentProfileSkillBindingService } from './services/agent-profile-skill-binding.service';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    ConfigModule,
    ConfigResolutionModule,
    GitOpsModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    CapabilityInfraModule,
    OAuthModule,
    ScopeModule,
  ],
  controllers: [
    ProvidersController,
    ModelsController,
    AgentProfilesController,
    AgentSkillsController,
    SecretsController,
    SecretsInternalController,
    ModelsInternalController,
    ProviderOAuthController,
    FallbackChainsController,
  ],
  providers: [
    AiConfigurationService,
    AiConfigAdminService,
    ProviderCrudService,
    ProviderCredentialService,
    RunnerProviderSelectionService,
    ModelCrudService,
    ProfileCrudService,
    SkillIndexService,
    TokenMatchStrategy,
    FuzzyMatchStrategy,
    TfIdfMatchStrategy,
    SkillSearchPipelineService,
    AgentSkillLibraryService,
    ArtifactLibraryService,
    AgentSkillsService,
    AgentFactoryService,
    ProviderReferenceService,
    ProviderOAuthService,
    ProviderOAuthLinkService,
    DatabaseModelStrategy,
    EnvironmentModelStrategy,
    ModelSelectionFactory,
    AgentProfileResolutionService,
    SkillService,
    ThinkingLevelCapabilityService,
    ThinkingLevelResolver,
    FallbackChainResolverService,
    ProviderFallbackService,
    AgentProfileSkillBindingService,
  ],
  exports: [
    AiConfigurationService,
    AiConfigAdminService,
    AgentFactoryService,
    AgentSkillsService,
    ArtifactLibraryService,
    SkillService,
    AgentProfileResolutionService,
    ThinkingLevelCapabilityService,
    ThinkingLevelResolver,
    FallbackChainResolverService,
    ProviderFallbackService,
    AgentProfileSkillBindingService,
  ],
})
export class AiConfigModule {
  /** AI configuration and secret resolution module */
  protected readonly _moduleName = 'AiConfigModule';
}
