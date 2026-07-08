import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { CapabilityGovernanceModule } from '../capability-governance/capability-governance.module';
import { IAMPolicyService } from './iam-policy.service';
import { SecretScannerService } from './secret-scanner.service';
import { SecretManagerService } from './secret-manager.service';
import { YAMLValidationService } from './yaml-validation.service';
import { SecretReferenceResolver } from './secret-reference-resolver.service';
import { SecretUsageLookupService } from './secret-usage-lookup.service';
import { SecretCrudService } from './services/secret-crud.service';
import { SecretVaultService } from './secret-vault.service';
import { SecretsPublicController } from './controllers/secrets-public.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ConfigModule,
    CapabilityGovernanceModule,
  ],
  controllers: [SecretsPublicController],
  providers: [
    IAMPolicyService,
    SecretScannerService,
    SecretManagerService,
    YAMLValidationService,
    SecretReferenceResolver,
    SecretUsageLookupService,
    SecretCrudService,
    SecretVaultService,
  ],
  exports: [
    IAMPolicyService,
    SecretScannerService,
    SecretManagerService,
    YAMLValidationService,
    SecretReferenceResolver,
    SecretUsageLookupService,
    SecretCrudService,
    SecretVaultService,
  ],
})
export class SecurityModule {
  /** Production security and IAM module */
  protected readonly _moduleName = 'SecurityModule';
}
