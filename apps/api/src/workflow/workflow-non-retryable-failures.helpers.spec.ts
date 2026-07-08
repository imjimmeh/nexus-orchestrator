import { describe, it, expect } from 'vitest';
import { isNonRetryableWorkflowFailure } from './workflow-non-retryable-failures.helpers';

describe('isNonRetryableWorkflowFailure', () => {
  const testCases = [
    {
      name: 'refinement missing subtasks',
      jobId: 'validate_refinement_exit_readiness',
      reason:
        'Step validate_refinement_exit_readiness failed: missing_subtasks',
      expected: true,
    },
    {
      name: 'refinement exit readiness failed',
      jobId: 'validate_refinement_exit_readiness',
      reason: 'refinement exit readiness failed for context resource-1',
      expected: true,
    },
    {
      name: 'invalid workflow YAML',
      jobId: 'job_1',
      reason: 'Invalid workflow YAML: Missing workflow_id',
      expected: true,
    },
    {
      name: 'workflow validation failed',
      jobId: 'job_1',
      reason: 'Workflow validation failed: Missing name',
      expected: true,
    },
    {
      name: 'permission denied',
      jobId: 'job_1',
      reason: 'Permission denied: tool bash is not allowed',
      expected: true,
    },
    {
      name: 'policy denied',
      jobId: 'job_1',
      reason:
        'Tool is denied by agent profile allowed_tools or workflow/job policy.',
      expected: true,
    },
    {
      name: 'tool not available',
      jobId: 'job_1',
      reason:
        'Tool is not available in the resolved runtime tier or runner capability set.',
      expected: true,
    },
    {
      name: 'output contract invalid',
      jobId: 'job_1',
      reason:
        'output_contract.required must be a non-empty array of field names',
      expected: true,
    },
    {
      name: 'output contract exhausted retries',
      jobId: 'pm_refinement',
      reason:
        'Output contract missing required field(s): pm_summary, acceptance_clarifications after 5 attempt(s)',
      expected: true,
    },
    {
      name: 'workflow output_contract exhaustion message',
      jobId: 'refine_strategy_and_specs',
      reason:
        'Job refine_strategy_and_specs run 5aa76524-9f72-489e-90e6-166388398ba8: output_contract fields [decision, actions_taken] not provided. Max retries (0) exhausted — failing job.',
      expected: true,
    },
    {
      name: 'amend_entity create resource_subtask missing required fields',
      jobId: 'materialize_refinement_subtasks',
      reason:
        'Step materialize_refinement_subtasks: amend_entity create resource_subtask requires updates.subtask_id and updates.title',
      expected: true,
    },
    {
      name: 'amend_entity upsert resource_subtask missing subtask_id',
      jobId: 'materialize_refinement_subtasks',
      reason:
        'Step materialize_refinement_subtasks: amend_entity upsert resource_subtask requires updates.subtask_id',
      expected: true,
    },
    {
      name: 'max loop iterations exceeded',
      jobId: 'review_resource',
      reason: 'max_loop_iterations: review_resource -> record_feedback_reject',
      expected: true,
    },
    {
      name: 'intentional terminal failure step',
      jobId: 'terminate_failed_merge',
      reason: 'Job terminate_failed_merge failed at step fail_workflow',
      expected: true,
    },
    {
      name: 'pi session-integrity resume error (assistant leaf)',
      jobId: 'coordinate_investigation',
      reason: 'Cannot continue from message role: assistant',
      expected: true,
    },
    {
      name: 'transient network error (should retry)',
      jobId: 'job_1',
      reason: 'Network timeout connecting to agent runner',
      expected: false,
    },
    {
      name: 'unknown error (should retry)',
      jobId: 'job_1',
      reason: 'Something went wrong',
      expected: false,
    },
    {
      name: 'git author identity failure',
      jobId: 'commit_investigation_artifacts',
      reason:
        'Git command failed: git commit -m docs(discovery): persist imported repository investigation -- docs/project-context (Author identity unknown fatal: unable to auto-detect email address)',
      expected: true,
    },
    {
      name: 'direct mutation conflict key active',
      jobId: 'transition_to_review',
      reason:
        'MCP tool invocation failed: MCP HTTP request failed (-32000): Decision is not launchable: conflict_key_active',
      expected: true,
    },
  ];

  testCases.forEach(({ name, jobId, reason, expected }) => {
    it(`correctly identifies ${name} as ${expected ? 'non-retryable' : 'retryable'}`, () => {
      expect(isNonRetryableWorkflowFailure({ jobId, reason })).toBe(expected);
    });
  });
});
