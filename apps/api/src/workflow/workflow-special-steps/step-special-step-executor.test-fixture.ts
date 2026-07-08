import type { ModuleRef } from '@nestjs/core';
import type { IWorkflowStep } from '@nexus/core';
import { type Mock, vi } from 'vitest';
import { GitMergeService } from '../../common/git/git-merge.service';
import { GitWorktreeService } from '../../common/git/git-worktree.service';
import { GitCommitPathsService } from '../../common/git/git-commit-paths.service';
import { WorkflowRepository } from '../database/repositories/workflow.repository';
import { WorkflowRunRepository } from '../database/repositories/workflow-run.repository';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import { resolveTemplatedInputs } from '../workflow-step-execution/step-support-inputs.helpers';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { WORKFLOW_ENGINE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import { StepGitOperationSpecialStepHandler } from './step-git-operation-special-step.handler';
import { MergeBranchResolverService } from './git-actions/merge-branch-resolver.service';
import { MergeGitActionStrategy } from './git-actions/merge-git-action.strategy';
import { MergePrepareGitActionStrategy } from './git-actions/merge-prepare-git-action.strategy';
import { MergeIntegrateGitActionStrategy } from './git-actions/merge-integrate-git-action.strategy';
import { IntegrationStrategyResolver } from '../../common/git/integration/integration-strategy.resolver';
import type { MergeProviderFactory } from '../../common/git/integration/merge-provider.factory';
import type { PullRequestTrackingRepository } from '../../common/git/integration/pull-request-tracking.repository';
import { ProvisionWorktreeGitActionStrategy } from './git-actions/provision-worktree-git-action.strategy';
import { RemoveWorktreeGitActionStrategy } from './git-actions/remove-worktree-git-action.strategy';
import { CreateBranchGitActionStrategy } from './git-actions/create-branch-git-action.strategy';
import { CommitPathsGitActionStrategy } from './git-actions/commit-paths-git-action.strategy';
import { StepInvokeWorkflowSpecialStepHandler } from './step-invoke-workflow-special-step.handler';
import { StepRegisterToolSpecialStepHandler } from './step-register-tool-special-step.handler';
import {
  ISpecialStepHandler,
  SpecialStepHandlerResult,
  SpecialStepOwningDomain,
} from './step-special-step.types';
import { StepSpecialStepExecutorService } from './step-special-step-executor.service';
import { SpecialStepForEachCoordinator } from './special-step-for-each.coordinator';
import { StepSpecialStepRegistryService } from './step-special-step-registry.service';

type WorkflowEngineMock = {
  handleJobComplete: Mock;
  startWorkflow: Mock;
};

type StepSpecialStepExecutorFixture = {
  service: StepSpecialStepExecutorService;
  registry: StepSpecialStepRegistryService;
  workflowEngine: WorkflowEngineMock;
  workflowRepoFindAll: Mock;
  mergeWithConflictDetectionMock: Mock;
  runRepoFindById: Mock;
  listRemoteBranchesMock: Mock;
  manageToolCandidateExecuteMock: Mock;
  webAutomationExecuteMock: Mock;
  mcpToolCallExecuteMock: Mock;
};

type FixtureMocks = Omit<
  StepSpecialStepExecutorFixture,
  'service' | 'registry'
>;

function createFixtureMocks(): FixtureMocks {
  return {
    workflowEngine: {
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
      startWorkflow: vi.fn().mockResolvedValue('child-run-1'),
    },
    workflowRepoFindAll: vi.fn().mockResolvedValue([]),
    mergeWithConflictDetectionMock: vi.fn(),
    runRepoFindById: vi.fn(),
    listRemoteBranchesMock: vi.fn().mockResolvedValue(['main']),
    manageToolCandidateExecuteMock: vi.fn(),
    webAutomationExecuteMock: vi.fn(),
    mcpToolCallExecuteMock: vi.fn().mockResolvedValue({
      result: {
        status: 'completed',
        mode: 'mcp_tool_call',
        serverId: 'test-mcp',
        toolName: 'test.tool_action',
      },
      output: { ok: true },
    } satisfies SpecialStepHandlerResult),
  };
}

function createRegistry(
  handlers: ISpecialStepHandler[],
): StepSpecialStepRegistryService {
  const registry = new StepSpecialStepRegistryService(handlers);
  registry.onModuleInit();
  return registry;
}

function createHandlers(mocks: FixtureMocks): ISpecialStepHandler[] {
  const support = createStepSupportService();
  return [
    new StepRegisterToolSpecialStepHandler(createToolRegistryService()),
    new StepInvokeWorkflowSpecialStepHandler(
      createModuleRef(mocks.workflowEngine),
      support,
      createEventPublisher(),
      createWorkflowRepository(mocks.workflowRepoFindAll),
      createWorkflowRunRepository(mocks.runRepoFindById),
    ),
    createStubHandler('run_command', 'core', 'inputs.command'),
    createStubHandler(
      'web_automation',
      'core',
      'inputs.action',
      mocks.webAutomationExecuteMock,
    ),
    createStubHandler('emit_event', 'core', 'inputs.event_name'),
    createStubHandler('http_webhook', 'core', 'inputs.url + inputs.method'),
    createStubHandler(
      'mcp_tool_call',
      'core',
      'inputs.server_id + inputs.tool_name',
      mocks.mcpToolCallExecuteMock,
    ),
    createGitOperationHandler(mocks),
    createStubHandler(
      'manage_tool_candidate',
      'core',
      'inputs.action + inputs.artifact_id',
      mocks.manageToolCandidateExecuteMock,
    ),
  ];
}

function createStubHandler(
  type: string,
  owningDomain: SpecialStepOwningDomain,
  inputContract: string,
  execute: Mock = vi.fn().mockResolvedValue({
    result: { status: 'completed', source: 'plugin', mode: type },
    output: { ok: true },
  } satisfies SpecialStepHandlerResult),
): ISpecialStepHandler {
  return {
    type,
    descriptor: { type, owningDomain, inputContract },
    execute,
  };
}

function createStepSupportService(): StepSupportService {
  return {
    resolveJobInputs: vi.fn(
      (
        inputs: Record<string, unknown> | undefined,
        variables: Record<string, unknown>,
      ) => resolveTemplatedInputs(inputs, variables, (value) => value),
    ),
    resolveInvokedWorkflowId: vi.fn((step: IWorkflowStep) => step.workflow_id),
    waitForWorkflowRunCompletion: vi.fn().mockResolvedValue({
      status: 'COMPLETED',
      stateVariables: { summary: 'done' },
    }),
  } as unknown as StepSupportService;
}

function createEventPublisher(): StepEventPublisherService {
  return {
    createEvent: vi.fn((eventType: string, payload: unknown) => ({
      event_type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    })),
    publishBestEffort: vi.fn().mockResolvedValue(undefined),
    publishProcessEvent: vi.fn().mockResolvedValue(undefined),
  } as unknown as StepEventPublisherService;
}

function createModuleRef(workflowEngine: WorkflowEngineMock): ModuleRef {
  return {
    get: vi.fn((token: unknown) => {
      if (token === WORKFLOW_ENGINE_SERVICE) {
        return workflowEngine;
      }
      return undefined;
    }),
  } as unknown as ModuleRef;
}

function createToolRegistryService(): ToolRegistryService {
  return {
    upsertTool: vi.fn().mockResolvedValue({ id: 'tool-1', name: 't1' }),
  } as unknown as ToolRegistryService;
}

function createWorkflowRepository(
  workflowRepoFindAll: Mock,
): WorkflowRepository {
  return {
    findAll: workflowRepoFindAll,
  } as unknown as WorkflowRepository;
}

function createWorkflowRunRepository(
  runRepoFindById: Mock,
): WorkflowRunRepository {
  return {
    findById: runRepoFindById,
    findActiveChildRunForParentStep: vi.fn().mockResolvedValue(null),
  } as unknown as WorkflowRunRepository;
}

function createGitOperationHandler(
  mocks: FixtureMocks,
): StepGitOperationSpecialStepHandler {
  const gitMergeService = createGitMergeService(
    mocks.mergeWithConflictDetectionMock,
  );
  const gitWorktreeService = createGitWorktreeService(
    mocks.listRemoteBranchesMock,
  );
  const gitCommitPathsService = createGitCommitPathsService();
  const runRepo = createWorkflowRunRepository(mocks.runRepoFindById);
  const branchResolver = new MergeBranchResolverService(gitWorktreeService);

  return new StepGitOperationSpecialStepHandler(
    runRepo,
    new MergeGitActionStrategy(gitMergeService, branchResolver),
    new MergePrepareGitActionStrategy(gitMergeService, branchResolver),
    new MergeIntegrateGitActionStrategy(
      gitMergeService,
      branchResolver,
      new IntegrationStrategyResolver(),
      {} as MergeProviderFactory,
      {} as PullRequestTrackingRepository,
    ),
    new ProvisionWorktreeGitActionStrategy(gitWorktreeService, runRepo),
    new RemoveWorktreeGitActionStrategy(gitWorktreeService, runRepo),
    new CreateBranchGitActionStrategy(gitWorktreeService),
    new CommitPathsGitActionStrategy(gitWorktreeService, gitCommitPathsService),
  );
}

function createGitMergeService(
  mergeWithConflictDetectionMock: Mock,
): GitMergeService {
  return {
    mergeWithConflictDetection: mergeWithConflictDetectionMock,
    prepareMergeInWorktree: vi.fn(),
    integrateAndPush: vi.fn(),
  } as unknown as GitMergeService;
}

function createGitWorktreeService(
  listRemoteBranchesMock: Mock,
): GitWorktreeService {
  return {
    resolveProjectDefaultBranch: vi.fn().mockResolvedValue('main'),
    getExistingWorktreePath: vi.fn().mockResolvedValue('/workspace'),
    provisionWorktree: vi.fn().mockResolvedValue('/workspace'),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    listManagedWorktrees: vi.fn().mockResolvedValue([]),
    listRemoteBranches: listRemoteBranchesMock,
  } as unknown as GitWorktreeService;
}

function createGitCommitPathsService(): GitCommitPathsService {
  return {
    commitPaths: vi.fn().mockResolvedValue({
      committed: false,
      status: 'clean',
      changed_files: [],
      commit_sha: null,
    }),
  } as unknown as GitCommitPathsService;
}

export function createStepSpecialStepExecutorTestFixture(): StepSpecialStepExecutorFixture {
  const mocks = createFixtureMocks();
  const support = createStepSupportService();
  const registry = createRegistry(createHandlers(mocks));
  const eventPublisher = createEventPublisher();
  const forEachCoordinator = new SpecialStepForEachCoordinator(
    mocks.workflowEngine as unknown as IWorkflowEngineService,
    eventPublisher,
    support,
  );
  const service = new StepSpecialStepExecutorService(
    mocks.workflowEngine as unknown as IWorkflowEngineService,
    eventPublisher,
    registry,
    support,
    forEachCoordinator,
  );

  return {
    service,
    registry,
    ...mocks,
  };
}
