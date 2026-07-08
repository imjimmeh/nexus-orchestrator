import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { ScopeModule } from '../scope/scope.module';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SecurityModule } from '../security/security.module';
import { Permission } from '../auth/database/entities/permission.entity';
import { Role } from '../auth/database/entities/role.entity';
import { RoleAssignment } from '../auth/database/entities/role-assignment.entity';
import { User } from '../users/database/entities/user.entity';
import { Workflow } from '../workflow/database/entities/workflow.entity';
import { AgentProfile } from '../ai-config/database/entities/agent-profile.entity';
import { Skill } from '../ai-config/database/entities/skill.entity';
import { IsNull, type Repository } from 'typeorm';

// 204H services
import { ConfigExportService } from './config-export.service';
import { ConfigValidationService } from './config-validation.service';
import type {
  GitOpsFileLoader,
  ValidationContextProvider,
} from './config-validation.service.types';

// 204I services
import { ReconciliationDiffService } from './reconciliation-diff.service';
import { DesiredStateLoaderService } from './desired-state-loader.service';
import { ActualStateReaderService } from './actual-state-reader.service';
import { ReconciliationApplyService } from './reconciliation-apply.service';
import { DriftDetectionService } from './drift-detection.service';
import { ReconciliationService } from './reconciliation.service';
import { GitOpsReconciliationLoopService } from './gitops-reconciliation-loop.service';
import { GitOpsStatusService } from './gitops-status.service';
import { GitOpsRepositoryBindingService } from './gitops-repository-binding.service';
import { GitOpsDesiredStateService } from './gitops-desired-state.service';
import { GitOpsInboundReconcileService } from './gitops-inbound-reconcile.service';
import { GitOpsEditPolicyService } from './gitops-edit-policy.service';
import { GitOpsPendingChangeService } from './gitops-pending-change.service';
import { GitOpsOutboundSyncService } from './gitops-outbound-sync.service';
import {
  DEFAULT_GITOPS_CREDENTIALS_OPTIONS,
  GITOPS_CREDENTIALS_OPTIONS,
  GitOpsCredentialsResolver,
} from './gitops-credentials-resolver.service';
import type { GitOpsCredentialsOptions } from './gitops-credentials-resolver.service.types';
import { GitOpsInvocationBuilder } from './gitops-invocation-builder';
import { loadYamlTreeFromDir } from './gitops-yaml-loader';
import { GitOpsController } from './gitops.controller';
import { GitCommandService } from '../common/git/git-command/git-command.service';
import { GITOPS_CONFIG } from './gitops.constants';
import type { GitOpsConfig } from './gitops.constants.types';
import {
  GitOpsObjectRegistryService,
  GITOPS_OBJECT_HANDLERS,
} from './objects/gitops-object-registry.service';
import { ScopeNodeGitopsHandler } from './objects/scope-node.gitops-handler';
import { RoleGitopsHandler } from './objects/role.gitops-handler';
import { RoleAssignmentGitopsHandler } from './objects/role-assignment.gitops-handler';
import { WorkflowGitopsHandler } from './objects/workflow.gitops-handler';
import { AgentProfileGitopsHandler } from './objects/agent-profile.gitops-handler';
import { SkillGitopsHandler } from './objects/skill.gitops-handler';

const FILE_LOADER_TOKEN = Symbol('FILE_LOADER');
const CONTEXT_PROVIDER_TOKEN = Symbol('CONTEXT_PROVIDER');

/**
 * Build the `GitOpsCredentialsOptions` injected via the
 * `GITOPS_CREDENTIALS_OPTIONS` token, sourcing the strict-mode
 * flag, the anonymous-allowed host list, and the resolver
 * cache TTL from environment variables read off
 * `process.env`. Defaults are inherited from
 * `DEFAULT_GITOPS_CREDENTIALS_OPTIONS` (see Milestone 1).
 *
 * Env vars consumed:
 *
 *  - `GITOPS_REQUIRE_CREDENTIALS` — `'true'` / `'1'` enables
 *    strict mode (default `'false'`).
 *  - `GITOPS_ANONYMOUS_ALLOWED_HOSTS` — comma-separated host
 *    list that overrides the default public-host list when
 *    set to a non-empty value.
 *  - `GITOPS_CREDENTIALS_TTL_MS` — integer millisecond TTL
 *    for the in-memory resolver cache. Falls back to the
 *    default (`60_000`) when unset, non-numeric, or
 *    non-positive.
 */
export function buildGitOpsCredentialsOptionsFromEnv(): GitOpsCredentialsOptions {
  const requireCredentials = parseBooleanEnv(
    process.env['GITOPS_REQUIRE_CREDENTIALS'],
  );
  const ttlMs = parseTtlEnv(
    process.env['GITOPS_CREDENTIALS_TTL_MS'],
    DEFAULT_GITOPS_CREDENTIALS_OPTIONS.ttlMs,
  );
  const anonymousAllowedHosts = parseHostsEnv(
    process.env['GITOPS_ANONYMOUS_ALLOWED_HOSTS'],
    DEFAULT_GITOPS_CREDENTIALS_OPTIONS.anonymousAllowedHosts,
  );
  return {
    requireCredentials,
    ttlMs,
    anonymousAllowedHosts,
  };
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return DEFAULT_GITOPS_CREDENTIALS_OPTIONS.requireCredentials;
  }
  const normalised = value.trim().toLowerCase();
  return normalised === 'true' || normalised === '1';
}

function parseTtlEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parseHostsEnv(
  value: string | undefined,
  fallback: readonly string[],
): string[] {
  if (value === undefined) {
    return [...fallback];
  }
  const hosts = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return hosts.length > 0 ? hosts : [...fallback];
}

@Module({
  imports: [
    ConfigModule,
    ScopeModule,
    AuthModule,
    AuthorizationModule,
    DatabaseModule,
    ObservabilityModule,
    SecurityModule,
    TypeOrmModule.forFeature([
      Permission,
      Role,
      RoleAssignment,
      User,
      Workflow,
      AgentProfile,
      Skill,
    ]),
  ],
  controllers: [GitOpsController],
  providers: [
    // 204H services
    ConfigExportService,
    GitCommandService,
    {
      provide: FILE_LOADER_TOKEN,
      useValue: {
        loadYamlTree: loadYamlTreeFromDir,
      } satisfies GitOpsFileLoader,
    },
    {
      provide: CONTEXT_PROVIDER_TOKEN,
      inject: [
        getRepositoryToken(Permission),
        getRepositoryToken(Role),
        getRepositoryToken(User),
        getRepositoryToken(Workflow),
        getRepositoryToken(AgentProfile),
        getRepositoryToken(Skill),
      ],
      useFactory: (
        permissionRepo: Repository<Permission>,
        roleRepo: Repository<Role>,
        userRepo: Repository<User>,
        workflowRepo: Repository<Workflow>,
        agentRepo: Repository<AgentProfile>,
        skillRepo: Repository<Skill>,
      ): ValidationContextProvider => ({
        build: async () => ({
          knownPermissions: new Set(
            (await permissionRepo.find({ select: { name: true } })).map(
              (permission) => permission.name,
            ),
          ),
          knownSystemRoles: new Set(
            (
              await roleRepo.find({
                select: { name: true },
                where: { ownerScopeNodeId: IsNull() },
              })
            ).map((role) => role.name),
          ),
          knownUsers: new Set(
            (await userRepo.find({ select: { username: true } })).map(
              (user) => user.username,
            ),
          ),
          knownDefaultAgents: new Set(
            (
              await agentRepo.find({
                select: { name: true },
                where: { scope_node_id: IsNull() },
              })
            ).map((agent) => agent.name),
          ),
          knownDefaultWorkflows: new Set(
            (
              await workflowRepo.find({
                select: { name: true },
                where: { scope_node_id: IsNull() },
              })
            ).map((workflow) => workflow.name),
          ),
          knownDefaultSkills: new Set(
            (
              await skillRepo.find({
                select: { name: true },
                where: { scope_node_id: IsNull() },
              })
            ).map((skill) => skill.name),
          ),
        }),
      }),
    },
    {
      provide: ConfigValidationService,
      useFactory: (loader: GitOpsFileLoader, ctx: ValidationContextProvider) =>
        new ConfigValidationService(loader, ctx),
      inject: [FILE_LOADER_TOKEN, CONTEXT_PROVIDER_TOKEN],
    },
    // 204J services
    GitOpsStatusService,
    GitOpsRepositoryBindingService,
    GitOpsDesiredStateService,
    GitOpsInboundReconcileService,
    GitOpsEditPolicyService,
    GitOpsPendingChangeService,
    GitOpsOutboundSyncService,
    // Milestone-1: GitOpsCredentialsResolver. Provides HTTPS /
    // SSH credential resolution for binding rows that carry a
    // `credentialsSecretId`. Milestone-2 wires this into the
    // inbound fetch and outbound push paths via
    // `GitOpsInvocationBuilder` (below).
    //
    // Strict mode is driven by `GITOPS_REQUIRE_CREDENTIALS`
    // (`true`/`1` enables it; default is OFF). The list of
    // hosts allowed to operate anonymously even under strict
    // mode is driven by `GITOPS_ANONYMOUS_ALLOWED_HOSTS`
    // (comma-separated). The in-memory resolver cache TTL is
    // driven by `GITOPS_CREDENTIALS_TTL_MS` (numeric). All
    // three env vars are documented in
    // `docs/architecture/gitops.md`.
    {
      provide: GITOPS_CREDENTIALS_OPTIONS,
      useFactory: (): GitOpsCredentialsOptions =>
        buildGitOpsCredentialsOptionsFromEnv(),
    },
    GitOpsCredentialsResolver,
    // Milestone-2: shared credential-aware git-invocation
    // builder. Used by `GitOpsOutboundSyncService` (push) and
    // `DesiredStateLoaderService` (inbound fetch/clone) so
    // both code paths share a single auth contract.
    GitOpsInvocationBuilder,
    ScopeNodeGitopsHandler,
    RoleGitopsHandler,
    RoleAssignmentGitopsHandler,
    WorkflowGitopsHandler,
    AgentProfileGitopsHandler,
    SkillGitopsHandler,
    {
      provide: GITOPS_OBJECT_HANDLERS,
      inject: [
        ScopeNodeGitopsHandler,
        RoleGitopsHandler,
        RoleAssignmentGitopsHandler,
        WorkflowGitopsHandler,
        AgentProfileGitopsHandler,
        SkillGitopsHandler,
      ],
      useFactory: (
        scopeNodeHandler: ScopeNodeGitopsHandler,
        roleHandler: RoleGitopsHandler,
        roleAssignmentHandler: RoleAssignmentGitopsHandler,
        workflowHandler: WorkflowGitopsHandler,
        agentProfileHandler: AgentProfileGitopsHandler,
        skillHandler: SkillGitopsHandler,
      ) => [
        scopeNodeHandler,
        roleHandler,
        roleAssignmentHandler,
        workflowHandler,
        agentProfileHandler,
        skillHandler,
      ],
    },
    GitOpsObjectRegistryService,
    // 204I services
    ReconciliationDiffService,
    DriftDetectionService,
    ActualStateReaderService,
    ReconciliationApplyService,
    DesiredStateLoaderService,
    ReconciliationService,
    GitOpsReconciliationLoopService,
    // GitOps config from environment
    {
      provide: GITOPS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): GitOpsConfig => ({
        enabled: config.get<string>('GITOPS_ENABLED') === 'true',
        repoUrl: config.get<string>('GITOPS_REPO_URL') ?? '',
        ref: config.get<string>('GITOPS_REF') ?? 'main',
        intervalMs: Number(
          config.get<string>('GITOPS_INTERVAL_MS') ?? '300000',
        ),
      }),
    },
  ],
  exports: [
    ConfigExportService,
    ReconciliationService,
    GitOpsInboundReconcileService,
    GitOpsEditPolicyService,
    GitOpsPendingChangeService,
    GitOpsOutboundSyncService,
    GitOpsReconciliationLoopService,
    GitOpsCredentialsResolver,
    GITOPS_CREDENTIALS_OPTIONS,
    GitOpsInvocationBuilder,
  ],
})
export class GitOpsModule {}
