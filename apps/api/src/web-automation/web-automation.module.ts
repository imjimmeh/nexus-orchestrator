import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WebAutomationActionExecutorService } from './web-automation-action-executor.service';
import { WebAutomationActionRunnerService } from './web-automation-action-runner.service';
import { WebAutomationArtifactQueryService } from './web-automation-artifact-query.service';
import { WebAutomationFailureArtifactService } from './web-automation-failure-artifact.service';
import { WebAutomationPlaywrightDriverService } from './web-automation-playwright-driver.service';
import { WebAutomationPolicyService } from './web-automation-policy.service';
import { WebAutomationRequestParserService } from './web-automation-request-parser.service';
import { WebAutomationSelectorResolverService } from './web-automation-selector-resolver.service';
import { WebAutomationSessionStoreService } from './web-automation-session-store.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    WebAutomationPlaywrightDriverService,
    WebAutomationSessionStoreService,
    WebAutomationRequestParserService,
    WebAutomationPolicyService,
    WebAutomationSelectorResolverService,
    WebAutomationActionRunnerService,
    WebAutomationActionExecutorService,
    WebAutomationFailureArtifactService,
    WebAutomationArtifactQueryService,
  ],
  exports: [
    WebAutomationActionExecutorService,
    WebAutomationSessionStoreService,
    WebAutomationArtifactQueryService,
  ],
})
export class WebAutomationModule {}
