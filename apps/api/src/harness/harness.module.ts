import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module.js';
import { AuthorizationModule } from '../auth/authorization/authorization.module.js';
import { ScopeModule } from '../scope/scope.module.js';
import { OAuthModule } from '../oauth/oauth.module.js';
import { SecurityModule } from '../security/security.module.js';
import { HarnessProviderRegistryService } from './harness-provider-registry.service.js';
import { HarnessDefinitionEntity } from './entities/harness-definition.entity.js';
import { HarnessCredentialBindingEntity } from './entities/harness-credential-binding.entity.js';
import { HarnessDefinitionRepository } from './harness-definition.repository.js';
import { HarnessCredentialBindingRepository } from './harness-credential-binding.repository.js';
import { HarnessCredentialResolverService } from './harness-credential-resolver.service.js';
import { HarnessConfigService } from './harness-config.service.js';
import { HarnessConfigController } from './harness-config.controller.js';
import { HarnessCredentialController } from './harness-credential.controller.js';
import { HARNESS_HTTP_CLIENT } from './harness-http-client.port.js';
import { FetchHarnessHttpClient } from './fetch-harness-http-client.js';
import { HarnessOAuthLinkService } from './harness-oauth-link.service.js';
import { HarnessOAuthController } from './harness-oauth.controller.js';
import { ScopedAiDefaultEntity } from './entities/scoped-ai-default.entity.js';
import { ScopedAiDefaultRepository } from './scoped-ai-default.repository.js';
import { ScopedAiDefaultService } from './scoped-ai-default.service.js';
import { ScopedAiDefaultResolver } from './scoped-ai-default-resolver.js';
import { HarnessScopedDefaultsController } from './harness-scoped-defaults.controller.js';
import { HarnessAssetEntity } from './assets/harness-asset.entity.js';
import { HarnessAssetRepository } from './assets/harness-asset.repository.js';
import { HarnessAssetService } from './assets/harness-asset.service.js';
import { HarnessAssetController } from './assets/harness-asset.controller.js';
import { AssetImporterService } from './import/asset-importer.service.js';
import { AssetImportController } from './import/asset-import.controller.js';
import {
  DefaultSourceFetcher,
  SOURCE_FETCHER,
} from './import/source-fetcher.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      HarnessDefinitionEntity,
      HarnessCredentialBindingEntity,
      ScopedAiDefaultEntity,
      HarnessAssetEntity,
    ]),
    AuthModule,
    AuthorizationModule,
    ScopeModule,
    OAuthModule,
    SecurityModule,
  ],
  controllers: [
    HarnessConfigController,
    HarnessCredentialController,
    HarnessOAuthController,
    HarnessScopedDefaultsController,
    HarnessAssetController,
    AssetImportController,
  ],
  providers: [
    HarnessProviderRegistryService,
    HarnessDefinitionRepository,
    HarnessCredentialBindingRepository,
    HarnessCredentialResolverService,
    HarnessConfigService,
    HarnessOAuthLinkService,
    { provide: HARNESS_HTTP_CLIENT, useClass: FetchHarnessHttpClient },
    ScopedAiDefaultRepository,
    ScopedAiDefaultService,
    ScopedAiDefaultResolver,
    HarnessAssetRepository,
    HarnessAssetService,
    { provide: SOURCE_FETCHER, useClass: DefaultSourceFetcher },
    AssetImporterService,
  ],
  exports: [
    HarnessProviderRegistryService,
    HarnessConfigService,
    HarnessCredentialResolverService,
    ScopedAiDefaultService,
    ScopedAiDefaultResolver,
    HarnessAssetRepository,
  ],
})
export class HarnessModule {}
