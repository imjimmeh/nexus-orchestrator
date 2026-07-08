import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AiConfigModule } from '../../ai-config/ai-config.module';
import { ObservabilityModule } from '../../observability/observability.module';
import { SecurityModule } from '../../security/security.module';
import { GitWorktreeService } from './git-worktree.service';
import { GitInitService } from './git-init.service';
import { GitMergeService } from './git-merge.service';
import { GitAuthEnvResolverService } from './git-auth-env-resolver.service';
import { GitCommandService } from './git-command/git-command.service';
import { BranchOperationsService } from './branch/branch-operations.service';
import { RepositoryLockService } from './locking/repository-lock.service';
import { GitPathService } from './path/git-path.service';
import { WorktreeOperationsService } from './worktree/worktree-operations.service';
import { GitCommitPathsService } from './git-commit-paths.service';
import { GitController } from './git.controller';
import { GitRepositoryMetadataService } from './git-repository-metadata.service';
import { DefaultBranchSyncService } from './sync/default-branch-sync.service';
import { GitHubCredentialResolver } from './integration/github-credential.resolver';
import { GitHubMergeProvider } from './integration/github-merge.provider';
import { GitLabCredentialResolver } from './integration/gitlab-credential.resolver';
import { GitLabMergeProvider } from './integration/gitlab-merge.provider';
import { BitbucketCredentialResolver } from './integration/bitbucket-credential.resolver';
import { BitbucketMergeProvider } from './integration/bitbucket-merge.provider';
import { FetchHttpJsonClient } from './integration/http-json-client';
import { HTTP_JSON_CLIENT } from './integration/http-json-client.types';
import { MergeProviderFactory } from './integration/merge-provider.factory';
import {
  GITHUB_OCTOKIT_FACTORY,
  type OctokitFactory,
} from './integration/github-octokit.factory.types';
import { defaultOctokitFactory } from './integration/github-octokit.factory';
import { MERGE_PROVIDER } from './integration/merge-provider.interface';

@Module({
  imports: [
    AiConfigModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
  ],
  controllers: [GitController],
  providers: [
    GitWorktreeService,
    GitInitService,
    GitMergeService,
    GitAuthEnvResolverService,
    GitCommandService,
    BranchOperationsService,
    RepositoryLockService,
    GitPathService,
    WorktreeOperationsService,
    GitCommitPathsService,
    GitRepositoryMetadataService,
    DefaultBranchSyncService,
    GitHubCredentialResolver,
    GitHubMergeProvider,
    GitLabCredentialResolver,
    GitLabMergeProvider,
    BitbucketCredentialResolver,
    BitbucketMergeProvider,
    MergeProviderFactory,
    {
      provide: GITHUB_OCTOKIT_FACTORY,
      useValue: defaultOctokitFactory satisfies OctokitFactory,
    },
    { provide: HTTP_JSON_CLIENT, useClass: FetchHttpJsonClient },
    { provide: MERGE_PROVIDER, useExisting: GitHubMergeProvider },
  ],
  exports: [
    GitWorktreeService,
    GitInitService,
    GitMergeService,
    GitAuthEnvResolverService,
    GitCommandService,
    BranchOperationsService,
    RepositoryLockService,
    GitPathService,
    WorktreeOperationsService,
    GitCommitPathsService,
    GitRepositoryMetadataService,
    MergeProviderFactory,
    GitHubMergeProvider,
    MERGE_PROVIDER,
  ],
})
export class GitWorktreeModule {}
