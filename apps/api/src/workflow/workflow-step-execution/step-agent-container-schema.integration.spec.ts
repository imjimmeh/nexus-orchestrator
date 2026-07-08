import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IJob, IToolRegistry } from '@nexus/core';
import { MemoryManagerService } from '../../memory/memory-manager.service';
import { MemoryMetricsService } from '../../memory/memory-metrics.service';
import { MetricsService } from '../../observability/metrics.service';
import { WorkflowParserService } from '../workflow-parser.service';
import { StepSupportService } from './step-support.service';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import { IAMPolicyService } from '../../security/iam-policy.service';
import { PolicyEngineService } from '../../capability-governance/policy-engine.service';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { AiConfigurationService } from '../../ai-config/ai-configuration.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
} from '../kernel/interfaces/workflow-kernel.ports';
import { StateManagerService } from '../state-manager.service';
import { GitWorktreeService } from '../../common/git/git-worktree.service';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { StepAgentContainerSupportService } from './step-agent-container-support.service';
import { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import { ToolRegistryService } from '../../tool-registry/tool-registry.service';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { StepEventPublisherService } from './step-event-publisher.service';
import { HostMountResolutionService } from '../workflow-host-mount/host-mount-resolution.service';
import { HostMountAuditService } from '../workflow-host-mount/host-mount-audit.service';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import type { JobQueueData } from '../job-execution.types';
import { HarnessImageResolver } from '../workflow-runtime-toolchains/harness-image-resolver.service';
import { PackageCacheVolumeService } from '../workflow-runtime-toolchains/package-cache-volume.service';
import { ToolchainResolverService } from '../workflow-runtime-toolchains/toolchain-resolver.service';
import { MemoryRetrievalService } from '../../memory/signals/memory-retrieval.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../../../seed/workflows/project-orchestration-cycle-ceo.workflow.yaml',
);

function readWorkflowYaml(): string {
  return fs.readFileSync(WORKFLOW_PATH, 'utf8');
}

function buildBaseSetJobOutputTool(): IToolRegistry {
  return {
    id: 'tool-set-job-output',
    name: 'set_job_output',
    description: 'Persist structured output data for the current job.',
    schema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          properties: {},
          additionalProperties: {},
          description:
            'Native JSON object containing the output fields for this job.',
        },
      },
    },
    typescript_code:
      'export default async function setJobOutput() { return { ok: true }; }',
    tier_restriction: 1,
    source: 'decorator_provider',
    runtime_owner: 'api',
    transport: 'api_callback',
    api_callback: {
      method: 'POST',
      path_template: '/api/workflow-runtime/jobs/set-output',
      body_mapping: { data: 'data' },
    },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function buildReadTool(): IToolRegistry {
  return {
    id: 'tool-read',
    name: 'read',
    description: 'Read a file.',
    schema: {
      type: 'object',
      required: ['file_path'],
      properties: {
        file_path: { type: 'string' },
      },
    },
    typescript_code:
      "export default async function read() { return { content: '' }; }",
    tier_restriction: 1,
    source: 'decorator_provider',
    runtime_owner: 'runner',
    transport: 'runner_local',
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('set_job_output schema enrichment integration', () => {
  let parser: WorkflowParserService;
  let support: StepSupportService;
  let toolMounting: ToolMountingService;
  let mountKey: string;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        WorkflowParserService,
        StepSupportService,
        ToolMountingService,
        {
          provide: IAMPolicyService,
          useValue: { getProfile: () => undefined },
        },
        {
          provide: PolicyEngineService,
          useValue: { decide: () => ({ status: 'allow' }) },
        },
        {
          provide: ToolPolicyEvaluatorService,
          useValue: { evaluate: () => ({ effect: 'allow' }) },
        },
        { provide: AiConfigurationService, useValue: {} },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: {} },
        { provide: WORKFLOW_DEFINITION_REPOSITORY_PORT, useValue: {} },
        { provide: StateManagerService, useValue: {} },
        { provide: GitWorktreeService, useValue: {} },
        { provide: WorkflowStageSkillPolicyService, useValue: {} },
        { provide: MemoryManagerService, useValue: {} },
        // StepSupportService was extended in work item 88d7654e
        // to take `MemoryMetricsService` and `MetricsService` as
        // explicit constructor deps for the
        // `nexus_learning_lesson_injected_total` metric wiring
        // (in production those come from the global `MemoryModule`
        // and `ObservabilityModule`; this integration test wires
        // empty stubs since the asserted code paths do not
        // exercise the metric).
        { provide: MemoryMetricsService, useValue: {} },
        { provide: MetricsService, useValue: {} },
        { provide: MemoryRetrievalService, useValue: {} },
        { provide: SystemSettingsService, useValue: {} },
        // StepSupportService also takes `SystemPromptAssemblyService`
        // for the pre-assembly system prompt hook (origin/main).
        SystemPromptAssemblyService,
      ],
    }).compile();

    parser = module.get(WorkflowParserService);
    support = module.get(StepSupportService);
    toolMounting = module.get(ToolMountingService);
    mountKey = `integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    toolMounting?.cleanupToolMount(mountKey);
  });

  it('enriches the mounted set_job_output schema with the strategize output contract', () => {
    const definition = parser.parseWorkflow(readWorkflowYaml());
    const job = definition.jobs?.find((j) => j.id === 'strategize');
    expect(job).toBeDefined();
    if (!job) {
      throw new Error('strategize job not found in workflow');
    }

    expect(job.output_contract).toEqual({
      required: ['groomed_board_summary'],
      types: {
        groomed_board_summary: {
          type: 'object',
          properties: {
            todo_count: 'number',
            backlog_count: 'number',
            linkedRunCount: 'number',
            dispatchableTodoCount: 'number',
            autonomous_mode: 'boolean',
            promotion_candidates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  candidateId: 'string',
                  title: 'string',
                  priority: 'string',
                  initiativeId: 'string',
                },
              },
            },
            strategic_intent: 'string',
            groomed_changes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  changedResourceId: 'string',
                  change: 'string',
                },
              },
            },
          },
        },
      },
    });

    const tools: IToolRegistry[] = [
      buildReadTool(),
      buildBaseSetJobOutputTool(),
    ];
    const selected = support.selectToolsForJob(tools, job);

    const setJobOutput = selected.find((t) => t.name === 'set_job_output');
    expect(setJobOutput).toBeDefined();
    const dataSchema = getDataSchema(setJobOutput?.schema);
    expect(dataSchema?.required).toEqual(['groomed_board_summary']);
    expect(dataSchema?.properties).toHaveProperty('groomed_board_summary');

    const groomedSchema = getPropertySchema(
      dataSchema?.properties as Record<string, unknown> | undefined,
      'groomed_board_summary',
    );
    expect(groomedSchema?.properties).toHaveProperty('todo_count');
    expect(groomedSchema?.properties).toHaveProperty('backlog_count');
    expect(groomedSchema?.properties).toHaveProperty('linkedRunCount');
    expect(groomedSchema?.properties).toHaveProperty('dispatchableTodoCount');
    expect(groomedSchema?.properties).toHaveProperty('autonomous_mode');
    expect(groomedSchema?.properties).toHaveProperty('promotion_candidates');
    expect(groomedSchema?.properties).toHaveProperty('strategic_intent');
    expect(groomedSchema?.properties).toHaveProperty('groomed_changes');

    const mountPath = toolMounting.prepareToolMount(mountKey, selected);
    const mountedFilePath = path.join(mountPath, 'set_job_output.ts');
    const mountedContent = fs.readFileSync(mountedFilePath, 'utf8');
    const metadata = extractMountedMetadata(mountedContent);

    expect(metadata).not.toBeNull();
    const mountedDataSchema = getDataSchema(metadata?.schema);
    expect(mountedDataSchema?.required).toEqual(['groomed_board_summary']);
    expect(mountedDataSchema?.properties).toHaveProperty(
      'groomed_board_summary',
    );

    const mountedGroomedSchema = getPropertySchema(
      mountedDataSchema?.properties as Record<string, unknown> | undefined,
      'groomed_board_summary',
    );
    expect(mountedGroomedSchema?.properties).toHaveProperty('todo_count');
    expect(mountedGroomedSchema?.properties).toHaveProperty('backlog_count');
    expect(mountedGroomedSchema?.properties).toHaveProperty('linkedRunCount');
    expect(mountedGroomedSchema?.properties).toHaveProperty(
      'dispatchableTodoCount',
    );
    expect(mountedGroomedSchema?.properties).toHaveProperty('autonomous_mode');
    expect(mountedGroomedSchema?.properties).toHaveProperty(
      'promotion_candidates',
    );
    expect(mountedGroomedSchema?.properties).toHaveProperty('strategic_intent');
    expect(mountedGroomedSchema?.properties).toHaveProperty('groomed_changes');
  });

  it('keeps the base schema when the job has no output_contract', () => {
    const definition = parser.parseWorkflow(readWorkflowYaml());
    const job = definition.jobs?.find((j) => j.id === 'strategize');
    expect(job).toBeDefined();
    const jobWithoutContract = { ...job, output_contract: undefined } as IJob;

    const tools: IToolRegistry[] = [buildBaseSetJobOutputTool()];
    const selected = support.selectToolsForJob(tools, jobWithoutContract);

    const setJobOutput = selected.find((t) => t.name === 'set_job_output');
    const dataSchema = getDataSchema(setJobOutput?.schema);
    expect(dataSchema?.properties).toEqual({});

    const mountPath = toolMounting.prepareToolMount(mountKey, selected);
    const mountedFilePath = path.join(mountPath, 'set_job_output.ts');
    const mountedContent = fs.readFileSync(mountedFilePath, 'utf8');
    const metadata = extractMountedMetadata(mountedContent);

    const mountedDataSchema = getDataSchema(metadata?.schema);
    expect(mountedDataSchema?.properties).toEqual({});
  });
});

describe('set_job_output schema enrichment via provisionJobContainer', () => {
  let parser: WorkflowParserService;
  let supportService: StepAgentContainerSupportService;
  let toolMounting: ToolMountingService;
  let skillMounting: SkillMountingService;
  let containerOrchestrator: ContainerOrchestratorService;
  let mountKey: string;

  beforeEach(async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? 'test-jwt-secret-for-integration';

    const module = await Test.createTestingModule({
      providers: [
        WorkflowParserService,
        StepSupportService,
        StepAgentContainerSupportService,
        ToolMountingService,
        SkillMountingService,
        HarnessProviderRegistryService,
        {
          provide: ToolRegistryService,
          useValue: {
            getToolsForTier: vi
              .fn()
              .mockResolvedValue([
                buildReadTool(),
                buildBaseSetJobOutputTool(),
              ]),
          },
        },
        {
          provide: AiConfigurationService,
          useValue: {
            getAgentProfileByName: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ContainerOrchestratorService,
          useValue: {
            provisionContainer: vi.fn().mockResolvedValue('container-id-123'),
          },
        },
        {
          provide: ToolchainResolverService,
          useValue: { resolve: vi.fn().mockResolvedValue({ toolchains: [] }) },
        },
        {
          provide: HarnessImageResolver,
          useValue: {
            resolveImageRef: vi.fn().mockResolvedValue('nexus-light:latest'),
          },
        },
        {
          provide: PackageCacheVolumeService,
          useValue: {
            resolveCacheMounts: vi
              .fn()
              .mockResolvedValue({ env: {}, volumes: [] }),
          },
        },
        { provide: StepEventPublisherService, useValue: {} },
        {
          provide: HostMountResolutionService,
          useValue: {
            resolveHostMountBindingsPreflight: vi.fn().mockResolvedValue({
              status: 'resolved',
              bindings: [],
              approvals_required: [],
            }),
          },
        },
        {
          provide: HostMountAuditService,
          useValue: { emitContainerLifecycle: vi.fn() },
        },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: {} },
        { provide: WORKFLOW_DEFINITION_REPOSITORY_PORT, useValue: {} },
        {
          provide: StateManagerService,
          useValue: { substituteTemplate: vi.fn((value: string) => value) },
        },
        { provide: GitWorktreeService, useValue: {} },
        { provide: MemoryManagerService, useValue: {} },
        {
          provide: WorkflowStageSkillPolicyService,
          useValue: {
            resolveAssignedSkills: vi.fn().mockResolvedValue({ skills: [] }),
          },
        },
        {
          provide: IAMPolicyService,
          useValue: {
            getProfile: (name: string) => ({ name, tier: 1 }),
          },
        },
        {
          provide: PolicyEngineService,
          useValue: { decide: () => ({ status: 'allow' }) },
        },
        {
          provide: ToolPolicyEvaluatorService,
          useValue: { evaluate: () => ({ effect: 'allow' }) },
        },
        { provide: DOCKER_CLIENT, useValue: {} },
        // StepSupportService was extended in work item 88d7654e
        // to take `MemoryMetricsService` and `MetricsService` as
        // explicit constructor deps for the
        // `nexus_learning_lesson_injected_total` metric wiring
        // (the production wiring comes from the global
        // `MemoryModule` and `ObservabilityModule`; this
        // integration test wires empty stubs since the asserted
        // code paths do not exercise the metric).
        { provide: MemoryMetricsService, useValue: {} },
        { provide: MetricsService, useValue: {} },
        { provide: MemoryRetrievalService, useValue: {} },
        { provide: SystemSettingsService, useValue: {} },
        // StepSupportService also takes `SystemPromptAssemblyService`
        // for the pre-assembly system prompt hook (origin/main).
        SystemPromptAssemblyService,
      ],
    }).compile();

    parser = module.get(WorkflowParserService);
    supportService = module.get(StepAgentContainerSupportService);
    toolMounting = module.get(ToolMountingService);
    skillMounting = module.get(SkillMountingService);
    containerOrchestrator = module.get(ContainerOrchestratorService);
    mountKey = `integration-provision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });

  afterEach(() => {
    toolMounting.cleanupToolMount(mountKey);
    skillMounting.cleanupSkillMount(mountKey);
    vi.clearAllMocks();
  });

  it('mounts set_job_output enriched by the strategize output contract', async () => {
    const definition = parser.parseWorkflow(readWorkflowYaml());
    const job = definition.jobs?.find((j) => j.id === 'strategize');
    expect(job).toBeDefined();
    if (!job) {
      throw new Error('strategize job not found in workflow');
    }

    const data: JobQueueData = {
      workflowRunId: '7123a92c-6c8c-40fc-9f98-8254d77cbd89',
      jobId: 'strategize',
      job: job,
    };

    const provisionSpy = vi.spyOn(containerOrchestrator, 'provisionContainer');

    const containerId = await supportService.provisionJobContainer(
      data,
      { trigger: { scopeId: 'test-scope' } },
      mountKey,
      'pi',
    );

    expect(containerId).toBe('container-id-123');

    const config = provisionSpy.mock.calls[0]?.[0] as
      | { volumes: Array<{ hostPath: string }> }
      | undefined;
    expect(config).toBeDefined();
    const mountPath = config?.volumes[0]?.hostPath;
    expect(mountPath).toBeDefined();

    const mountedFilePath = path.join(mountPath!, 'set_job_output.ts');
    const mountedContent = fs.readFileSync(mountedFilePath, 'utf8');
    const metadata = extractMountedMetadata(mountedContent);

    expect(metadata).not.toBeNull();
    const mountedDataSchema = getDataSchema(metadata?.schema);
    expect(mountedDataSchema?.required).toEqual(['groomed_board_summary']);
    expect(mountedDataSchema?.properties).toHaveProperty(
      'groomed_board_summary',
    );
  });
});

function getDataSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  const properties = schema.properties as Record<string, unknown> | undefined;
  return properties?.data as Record<string, unknown> | undefined;
}

function getPropertySchema(
  properties: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }
  const value = properties[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractMountedMetadata(
  fileContent: string,
): { schema: Record<string, unknown> } | null {
  const match = /export\s+const\s+metadata\s*=\s*(.+?);?\s*$/ms.exec(
    fileContent,
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return JSON.parse(match[1]) as { schema: Record<string, unknown> };
  } catch {
    return null;
  }
}
