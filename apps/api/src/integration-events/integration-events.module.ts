import { Module } from '@nestjs/common';
import { GitWorktreeModule } from '../common/git/git-worktree.module';
import { DatabaseModule } from '../database/database.module';
import { RedisModule } from '../redis/redis.module';
import { SecurityModule } from '../security/security.module';
import { IntegrationLifecycleStreamPublisher } from './integration-lifecycle-stream.publisher';
import { PrMergeFinalizerService } from './pr-merge-finalizer.service';
import { PrPollReconcilerService } from './pr-poll-reconciler.service';
import { PrWebhookController } from './pr-webhook.controller';
import { WebhookSecretResolver } from './webhook-secret.resolver';
import { GithubWebhookVerificationStrategy } from './github-webhook-verification.strategy';
import { GitlabWebhookVerificationStrategy } from './gitlab-webhook-verification.strategy';
import { BitbucketWebhookVerificationStrategy } from './bitbucket-webhook-verification.strategy';
import { WebhookVerificationStrategyRegistry } from './webhook-verification-strategy.registry';
import { WEBHOOK_VERIFICATION_STRATEGIES } from './webhook-verification-strategy.types';

@Module({
  imports: [RedisModule, DatabaseModule, GitWorktreeModule, SecurityModule],
  controllers: [PrWebhookController],
  providers: [
    IntegrationLifecycleStreamPublisher,
    PrMergeFinalizerService,
    PrPollReconcilerService,
    WebhookSecretResolver,
    GithubWebhookVerificationStrategy,
    GitlabWebhookVerificationStrategy,
    BitbucketWebhookVerificationStrategy,
    {
      provide: WEBHOOK_VERIFICATION_STRATEGIES,
      useFactory: (
        github: GithubWebhookVerificationStrategy,
        gitlab: GitlabWebhookVerificationStrategy,
        bitbucket: BitbucketWebhookVerificationStrategy,
      ) => [github, gitlab, bitbucket],
      inject: [
        GithubWebhookVerificationStrategy,
        GitlabWebhookVerificationStrategy,
        BitbucketWebhookVerificationStrategy,
      ],
    },
    WebhookVerificationStrategyRegistry,
  ],
  exports: [PrMergeFinalizerService],
})
export class IntegrationEventsModule {
  protected readonly _moduleName = 'IntegrationEventsModule';
}
