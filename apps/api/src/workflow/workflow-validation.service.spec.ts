import { WorkflowValidationService } from './workflow-validation.service';
import { ToolRegistryRepository } from '../tool/database/repositories/tool-registry.repository';
import { DAGResolverService } from './dag-resolver.service';
import { IWorkflowDefinition, ToolPolicyEffect } from '@nexus/core';
import { RESERVED_SPECIAL_STEP_TYPES } from '@nexus/plugin-sdk';
import { vi, Mock, describe, it, expect, beforeEach } from 'vitest';
import type {
  ISpecialStepHandler,
  SpecialStepHandlerLookup,
} from './workflow-special-steps/step-special-step.types';
import { CORE_SPECIAL_STEP_TYPES } from './workflow-special-steps/step-special-step.types';

describe('WorkflowValidationService', () => {
  let service: WorkflowValidationService;
  let mockToolRepo: { findByName: Mock };
  let mockDagResolver: { buildDependencyGraph: Mock };
  let mockSpecialStepRegistry: SpecialStepHandlerLookup & { getHandler: Mock };

  beforeEach(() => {
    mockToolRepo = {
      findByName: vi.fn().mockResolvedValue({ id: 'tool-1', name: 'read' }),
    };

    mockDagResolver = {
      buildDependencyGraph: vi.fn(),
    };

    mockSpecialStepRegistry = {
      getHandler: vi.fn().mockReturnValue(null),
    };

    service = new WorkflowValidationService(
      mockToolRepo as unknown as ToolRegistryRepository,
      mockDagResolver as unknown as DAGResolverService,
      mockSpecialStepRegistry,
    );
  });

  const makeWorkflow = (
    overrides: Partial<IWorkflowDefinition> = {},
  ): IWorkflowDefinition => ({
    workflow_id: 'parent_workflow',
    name: 'Parent Workflow',
    jobs: [
      {
        id: 'step_1',
        type: 'execution',
        tier: 'light',
        steps: [{ id: 'default', prompt: 'Test prompt' }],
      },
    ],
    ...overrides,
  });

  it('marks invoke_workflow step invalid when workflow_id is missing', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'invoke_child',
          type: 'invoke_workflow',
          tier: 'light',
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'invoke_child' has type 'invoke_workflow' but is missing workflow_id",
    );
  });

  it('marks invoke_workflow step invalid when it references its own workflow id', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'invoke_self',
          type: 'invoke_workflow',
          tier: 'light',
          workflow_id: 'parent_workflow',
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'invoke_self' cannot invoke its own workflow 'parent_workflow'",
    );
  });

  it('accepts invoke_workflow step when workflow_id is provided in inputs', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'invoke_child',
          type: 'invoke_workflow',
          tier: 'light',
          inputs: {
            workflow_id: 'child_workflow',
          },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('marks register_tool step invalid when required inputs are missing', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'register_tool',
          type: 'register_tool',
          tier: 'light',
          inputs: {
            name: 'missing_schema_and_code',
          },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'register_tool' has type 'register_tool' but is missing one of inputs.name, inputs.schema, inputs.typescript_code",
    );
  });

  it('marks manage_tool_candidate step invalid when action is missing', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'validate_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { artifact_id: 'artifact-1' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'validate_candidate' has type 'manage_tool_candidate' but is missing inputs.action",
    );
  });

  it('marks manage_tool_candidate step invalid when artifact_id is missing', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'publish_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'publish' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'publish_candidate' has type 'manage_tool_candidate' but is missing inputs.artifact_id",
    );
  });

  it('accepts manage_tool_candidate validate/publish jobs when action and artifact_id are provided', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'validate_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'validate', artifact_id: 'artifact-1' },
          steps: [],
        },
        {
          id: 'publish_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          depends_on: ['validate_candidate'],
          inputs: { action: 'publish', artifact_id: 'artifact-1' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
  });

  it('marks web_automation job invalid when action is missing', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'web_action_missing',
          type: 'web_automation',
          tier: 'light',
          inputs: {},
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'web_action_missing' has type 'web_automation' but is missing inputs.action",
    );
  });

  it('accepts web_automation click job with selector strategy inputs', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'web_click',
          type: 'web_automation',
          tier: 'light',
          inputs: {
            action: 'click',
            selector_alias: 'primary_button',
          },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(true);
  });

  it('marks workflow permissions invalid when tool_policy.rules is not an array', async () => {
    const workflow = makeWorkflow({
      permissions: {
        tool_policy: {
          default: ToolPolicyEffect.ALLOW,
          rules: 'not-an-array' as any,
        },
      },
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Workflow permissions.tool_policy.rules must be an array',
    );
  });

  it('marks workflow permissions invalid when allow_host_mounts is not an array', async () => {
    const workflow = makeWorkflow({
      permissions: {
        allow_host_mounts: 'not-an-array',
      } as unknown as { allow_host_mounts: string[] },
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Workflow permissions.allow_host_mounts must be an array',
    );
  });

  it('marks job invalid when host_mounts is not an array', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'step_1',
          type: 'execution',
          tier: 'heavy',
          host_mounts: 'invalid' as unknown as Array<{ alias: string }>,
          steps: [{ id: 'default', prompt: 'Test' }],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'step_1' host_mounts must be an array",
    );
  });

  it('marks job invalid when host_mounts contains unsafe subpath', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'step_1',
          type: 'execution',
          tier: 'heavy',
          host_mounts: [
            {
              alias: 'docs',
              subpath: '../escape',
              mode: 'ro',
            },
          ],
          steps: [{ id: 'default', prompt: 'Test' }],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'step_1' host_mounts[0].subpath must be a safe relative path",
    );
  });

  it('accepts valid host_mounts on execution jobs', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'step_1',
          type: 'execution',
          tier: 'heavy',
          permissions: {
            allow_host_mounts: ['docs'],
            allow_host_mount_rw: ['docs'],
          },
          host_mounts: [
            {
              alias: 'docs',
              subpath: 'engineering/specs',
              mode: 'rw',
            },
          ],
          steps: [{ id: 'default', prompt: 'Test' }],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(true);
  });

  describe('job control field validation', () => {
    it('accepts valid output_contract', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            output_contract: {
              required: ['decision'],
            },
            max_retries: 2,
            retry_prompt: 'Please call the tool.',
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('rejects empty output_contract.required', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            output_contract: {
              required: [],
            },
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_1' output_contract.required must be a non-empty array",
      );
    });

    it('rejects invalid output_contract.required entries', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            output_contract: {
              required: [''],
            },
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_1' output_contract.required contains invalid entry",
      );
    });

    it('rejects negative max_retries', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            max_retries: -1,
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_1' max_retries must be a non-negative integer",
      );
    });

    it('rejects non-integer max_retries', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            max_retries: 1.5,
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_1' max_retries must be a non-negative integer",
      );
    });

    it('rejects empty retry_prompt', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_1',
            type: 'execution',
            tier: 'heavy',
            retry_prompt: '',
            steps: [{ id: 'default', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_1' retry_prompt must be a non-empty string",
      );
    });

    it('rejects git_operation job without action', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'cleanup_worktree',
            type: 'git_operation',
            tier: 'light',
            inputs: {},
            steps: [],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'cleanup_worktree' has type 'git_operation' but is missing inputs.action",
      );
    });

    it('rejects git_operation job without generic repository context', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'cleanup_worktree',
            type: 'git_operation',
            tier: 'light',
            inputs: { action: 'remove_worktree' },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'cleanup_worktree' has type 'git_operation' but is missing inputs.repository_id",
      );
      expect(result.errors).toContain(
        "Job 'cleanup_worktree' has type 'git_operation' but is missing inputs.worktree_id",
      );
    });

    it('accepts git_operation job with generic repository inputs', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'cleanup_worktree',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'remove_worktree',
              repository_id: 'repo-1',
              worktree_id: 'worktree-1',
              target_branch: 'feature/worktree-1',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('accepts commit_paths git_operation job with paths and message', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
              paths: ['docs/project-context'],
              message: 'docs(discovery): persist investigation',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('rejects commit_paths job missing paths', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
              message: 'docs(discovery): persist investigation',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'commit_investigation_artifacts' has type 'git_operation' but is missing inputs.paths",
      );
    });

    it('rejects commit_paths job missing message', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
              paths: ['docs/project-context'],
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'commit_investigation_artifacts' has type 'git_operation' but is missing inputs.message",
      );
    });

    it('rejects commit_paths job missing both paths and message', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'commit_investigation_artifacts' has type 'git_operation' but is missing inputs.paths",
      );
      expect(result.errors).toContain(
        "Job 'commit_investigation_artifacts' has type 'git_operation' but is missing inputs.message",
      );
    });

    it('rejects commit_paths job with empty-string path entry', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
              paths: ['docs/project-context', ''],
              message: 'docs(discovery): persist investigation',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
    });

    it('rejects commit_paths job with non-string path entry', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'commit_investigation_artifacts',
            type: 'git_operation',
            tier: 'light',
            inputs: {
              action: 'commit_paths',
              repository_id: 'repo-1',
              paths: ['docs/project-context', 123 as unknown as string],
              message: 'docs(discovery): persist investigation',
            },
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
    });
  });

  describe('step-level control-flow validation', () => {
    it('accepts run_command step with valid command and done transition', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            max_step_loops: 3,
            steps: [
              {
                id: 'check',
                type: 'run_command',
                command: 'git status --porcelain',
                transitions: [
                  {
                    condition: 'steps.check.output.stdout == ""',
                    next: 'done',
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts agent step that uses prompt_file instead of inline prompt', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'implement',
                type: 'agent',
                prompt_file: 'prompts/workflow-environment-repair/repair.md',
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
    });

    it('rejects agent step that sets both prompt and prompt_file', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'implement',
                type: 'agent',
                prompt: 'inline prompt',
                prompt_file: 'prompts/workflow-environment-repair/repair.md',
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'implement' in job 'step_control' cannot define both prompt and prompt_file",
      );
    });

    it('rejects run_command step without command', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'check',
                type: 'run_command',
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'check' in job 'step_control' with type 'run_command' requires command",
      );
    });

    it('accepts run_command step with a timeout_ms within the maximum', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'run_gate',
                type: 'run_command',
                command: 'npm run build && npm test',
                timeout_ms: 1_200_000,
                transitions: [{ condition: 'true', next: 'done' }],
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects run_command step whose timeout_ms exceeds the maximum', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'run_gate',
                type: 'run_command',
                command: 'npm run build && npm test',
                timeout_ms: 3_600_000,
                transitions: [{ condition: 'true', next: 'done' }],
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'run_gate' in job 'step_control' with type 'run_command' timeout_ms 3600000 exceeds the maximum of 1800000ms",
      );
    });

    it('rejects run_command step whose timeout_ms is not a positive integer', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'run_gate',
                type: 'run_command',
                command: 'npm test',
                timeout_ms: -5,
                transitions: [{ condition: 'true', next: 'done' }],
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'run_gate' in job 'step_control' with type 'run_command' timeout_ms must be a positive integer",
      );
    });

    it('rejects invalid step transition targets', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'check',
                type: 'agent',
                prompt: 'Check',
                transitions: [
                  {
                    condition: 'true',
                    next: 'unknown_step',
                  },
                ],
              },
            ],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Step 'check' in job 'step_control' transitions to unknown step 'unknown_step'",
      );
    });

    it('rejects non-positive max_step_loops', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            max_step_loops: 0,
            steps: [{ id: 'agent', type: 'agent', prompt: 'Test' }],
          },
        ],
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "Job 'step_control' max_step_loops must be a positive integer",
      );
    });

    it('rejects non-string on_error value without throwing', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'check',
                type: 'agent',
                prompt: 'Check',
                on_error: 123 as unknown as 'fail',
              },
            ],
          },
        ],
      });

      await expect(service.validateWorkflow(workflow)).resolves.toMatchObject({
        valid: false,
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.errors).toContain(
        "Step 'check' in job 'step_control' has invalid on_error value '123'",
      );
    });

    it('rejects non-string transition target without throwing', async () => {
      const workflow = makeWorkflow({
        jobs: [
          {
            id: 'step_control',
            type: 'execution',
            tier: 'heavy',
            steps: [
              {
                id: 'check',
                type: 'agent',
                prompt: 'Check',
                transitions: [
                  {
                    condition: 'true',
                    next: 42 as unknown as string,
                  },
                ],
              },
            ],
          },
        ],
      });

      await expect(service.validateWorkflow(workflow)).resolves.toMatchObject({
        valid: false,
      });

      const result = await service.validateWorkflow(workflow);
      expect(result.errors).toContain(
        "Step 'check' in job 'step_control' transition target must be a string",
      );
    });
  });

  it('rejects unsupported job type', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'invalid_job_type',
          type: 'not_supported' as unknown as 'execution',
          tier: 'light',
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'invalid_job_type' has unsupported type 'not_supported'",
    );
  });

  it('accepts registered plugin special-step job types', async () => {
    const pluginHandler = {
      type: 'acme.send_webhook',
      descriptor: {
        type: 'acme.send_webhook',
        inputContract: 'Webhook payload',
        owningDomain: 'plugin',
        pluginId: 'acme',
      },
      execute: vi.fn(),
    } satisfies ISpecialStepHandler;
    mockSpecialStepRegistry.getHandler.mockReturnValue(pluginHandler);
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'send_webhook',
          type: 'acme.send_webhook' as never,
          tier: 'light',
          inputs: {
            url: 'https://example.com/webhook',
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockSpecialStepRegistry.getHandler).toHaveBeenCalledWith(
      'acme.send_webhook',
    );
  });

  it('rejects unregistered plugin-looking job types', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'send_webhook',
          type: 'acme.send_webhook' as never,
          tier: 'light',
          inputs: {},
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'send_webhook' has unsupported type 'acme.send_webhook'",
    );
  });

  it('rejects deprecated legacy types even when a plugin handler is registered for that type', async () => {
    const pluginHandler = {
      type: 'record_metadata',
      descriptor: {
        type: 'record_metadata',
        inputContract: 'Legacy metadata payload',
        owningDomain: 'plugin',
        pluginId: 'acme',
      },
      execute: vi.fn(),
    } satisfies ISpecialStepHandler;
    mockSpecialStepRegistry.getHandler.mockReturnValue(pluginHandler);
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'legacy_job',
          type: 'record_metadata' as never,
          tier: 'light',
          inputs: {},
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'legacy_job' has unsupported type 'record_metadata'",
    );
    expect(mockSpecialStepRegistry.getHandler).not.toHaveBeenCalledWith(
      'record_metadata',
    );
  });

  describe('rejects all deprecated legacy special job types', () => {
    const legacyTypes = RESERVED_SPECIAL_STEP_TYPES.filter(
      (reservedType) =>
        reservedType !== 'execution' &&
        !CORE_SPECIAL_STEP_TYPES.includes(
          reservedType as (typeof CORE_SPECIAL_STEP_TYPES)[number],
        ),
    );

    for (const legacyType of legacyTypes) {
      it(`rejects type '${legacyType}'`, async () => {
        const workflow = makeWorkflow({
          jobs: [
            {
              id: 'legacy_job',
              type: legacyType as never,
              tier: 'light',
              inputs: {},
            },
          ],
        });

        const result = await service.validateWorkflow(workflow);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(
          `Job 'legacy_job' has unsupported type '${legacyType}'`,
        );
      });
    }
  });

  it('rejects deprecated output_tool and required_tool_calls fields', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'legacy_output_capture',
          type: 'execution',
          tier: 'heavy',
          steps: [{ id: 'review', type: 'agent', prompt: 'Review' }],
          output_tool: 'submit_qa_decision',
          required_tool_calls: ['submit_qa_decision'],
        } as never,
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'legacy_output_capture' uses deprecated field 'output_tool'; use output_contract + set_job_output instead",
    );
    expect(result.errors).toContain(
      "Job 'legacy_output_capture' uses deprecated field 'required_tool_calls'; use output_contract + set_job_output instead",
    );
  });

  it('rejects workflow permissions when policy is not an object', async () => {
    const workflow = makeWorkflow({
      permissions: '' as never,
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Workflow permissions must be an object');
  });

  it('rejects manage_tool_candidate job without artifact_id', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'validate_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'validate' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'validate_candidate' has type 'manage_tool_candidate' but is missing inputs.artifact_id",
    );
  });

  it('accepts manage_tool_candidate validate job with artifact_id', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'validate_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'validate', artifact_id: 'artifact-1' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
  });

  it('rejects manage_tool_candidate publish job without artifact_id', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'publish_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'publish' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'publish_candidate' has type 'manage_tool_candidate' but is missing inputs.artifact_id",
    );
  });

  it('accepts manage_tool_candidate publish job with artifact_id', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'publish_candidate',
          type: 'manage_tool_candidate',
          tier: 'light',
          inputs: { action: 'publish', artifact_id: 'artifact-1' },
          steps: [],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
  });

  it('accepts sdk-native job tools without requiring registry rows', async () => {
    mockToolRepo.findByName.mockResolvedValue(null);

    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'implement_and_commit',
          type: 'execution',
          tier: 'heavy',
          tools: ['read', 'write', 'bash'],
          steps: [{ id: 'default', prompt: 'Test prompt' }],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
  });

  it('rejects removed aggregate scoped action tool names', async () => {
    const removedAggregateTool = 'nexus_orchestrator:step_complete';
    mockToolRepo.findByName.mockResolvedValue(null);

    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'execute_scoped_actions',
          type: 'execution',
          tier: 'heavy',
          tools: [removedAggregateTool],
          steps: [{ id: 'default', prompt: 'Test prompt' }],
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`unknown tool '${removedAggregateTool}'`),
      ]),
    );
  });

  it('accepts mcp_tool_call jobs with explicit policy controls', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'update_external',
          type: 'mcp_tool_call',
          tier: 'light',
          inputs: {
            server_id: 'external-mcp',
            tool_name: 'external.resource_update',
            params: { scope_id: 'p1', contextId: 'w1' },
            policy: {
              allowed_servers: ['external-mcp'],
              allowed_tools: ['external.*'],
            },
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
  });

  it('rejects mcp_tool_call jobs without explicit policy controls', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'update_external',
          type: 'mcp_tool_call',
          tier: 'light',
          inputs: {
            server_id: 'external-mcp',
            tool_name: 'external.resource_update',
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'update_external' has type 'mcp_tool_call' but is missing inputs.policy.allowed_servers",
    );
    expect(result.errors).toContain(
      "Job 'update_external' has type 'mcp_tool_call' but is missing inputs.policy.allowed_tools",
    );
  });

  it('accepts emit_event jobs with payload containing source field', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'emit_cycle_request',
          type: 'emit_event',
          tier: 'light',
          inputs: {
            event_name: 'ProjectOrchestrationCycleRequestedEvent',
            payload: {
              event: 'ProjectOrchestrationCycleRequestedEvent',
              scopeId: '{{ trigger.scopeId }}',
              source: 'specs_ready',
              reason: 'Discovery workflow completed',
            },
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts http_webhook jobs with explicit policy controls', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'notify_external',
          type: 'http_webhook',
          tier: 'light',
          inputs: {
            url: 'https://external.internal/projects/p1/resources/w1/status',
            method: 'PATCH',
            body: { status: 'done' },
            policy: {
              allowed_urls: ['https://external.internal/projects/*'],
              allowed_methods: ['PATCH'],
            },
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);

    expect(result.valid).toBe(true);
  });

  it('rejects http_webhook jobs without explicit URL policy controls', async () => {
    const workflow = makeWorkflow({
      jobs: [
        {
          id: 'notify_external',
          type: 'http_webhook',
          tier: 'light',
          inputs: {
            url: 'https://external.internal/projects/p1/resources/w1/status',
          },
        },
      ],
    });

    const result = await service.validateWorkflow(workflow);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Job 'notify_external' has type 'http_webhook' but is missing inputs.policy.allowed_urls",
    );
  });
});
