import { describe, expect, it } from 'vitest';
import { WorkflowLaunchContractService } from './workflow-launch-contract.service';

describe('WorkflowLaunchContractService', () => {
  const service = new WorkflowLaunchContractService();

  it('builds a manual launch contract with context and typed inputs', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-1',
      name: 'Workflow One',
      trigger: {
        type: 'manual',
        launch: {
          context: 'required',
          allow_raw_json: true,
          inputs: [
            {
              key: 'objective',
              label: 'Objective',
              type: 'string',
              required: true,
            },
            {
              key: 'risk_level',
              label: 'Risk Level',
              type: 'string',
              required: false,
              default: 'medium',
            },
          ],
        },
      },
      jobs: [],
    });

    expect(contract.launchable).toBe(true);
    expect(contract.context).toBe('required');
    expect(contract.inputs).toEqual([
      {
        key: 'objective',
        label: 'Objective',
        type: 'string',
        required: true,
      },
      {
        key: 'risk_level',
        label: 'Risk Level',
        type: 'string',
        required: false,
        default: 'medium',
      },
    ]);
  });

  it('marks non-manual workflows as ineligible for on-demand launch', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-2',
      name: 'Workflow Two',
      trigger: {
        type: 'event',
      },
      jobs: [],
    });

    const eligibility = service.evaluateEligibility(contract, {
      scopeId: 'scope-1',
      contextId: null,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons[0]?.code).toBe('WORKFLOW_NOT_MANUAL');
  });

  it('rejects payload when required scope/context is missing', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-3',
      name: 'Workflow Three',
      trigger: {
        type: 'manual',
        launch: {
          context: 'required',
          inputs: [],
        },
      },
      jobs: [],
    });

    const result = service.validateLaunchPayload({
      contract,
      triggerData: {},
      context: {
        scopeId: null,
        contextId: null,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      'CONTEXT_REQUIRED',
    );
    expect(result.issues.map((issue) => issue.code)).toContain(
      'CONTEXT_ID_REQUIRED',
    );
  });

  it('normalizes required context into trigger payload and applies defaults', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-4',
      name: 'Workflow Four',
      trigger: {
        type: 'manual',
        launch: {
          context: 'required',
          inputs: [
            {
              key: 'risk_level',
              type: 'string',
              required: false,
              default: 'medium',
            },
          ],
        },
      },
      jobs: [],
    });

    const result = service.validateLaunchPayload({
      contract,
      triggerData: {},
      context: {
        scopeId: 'scope-1',
        contextId: 'context-1',
      },
    });

    expect(result.valid).toBe(true);
    expect(result.normalizedTriggerData).toMatchObject({
      scopeId: 'scope-1',
      risk_level: 'medium',
    });
  });

  it('rejects invalid typed input values', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-5',
      name: 'Workflow Five',
      trigger: {
        type: 'manual',
        launch: {
          context: 'none',
          inputs: [
            {
              key: 'priority',
              type: 'number',
              required: true,
            },
          ],
        },
      },
      jobs: [],
    });

    const result = service.validateLaunchPayload({
      contract,
      triggerData: {
        priority: 'high',
      },
      context: {},
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'INVALID_INPUT_TYPE',
        field: 'priority',
      }),
    );
  });

  it('builds a non-launchable contract for lifecycle-triggered workflows', () => {
    const contract = service.buildContract({
      workflow_id: 'workflow-6',
      name: 'Lifecycle Workflow',
      trigger: {
        type: 'lifecycle',
        phase: 'before_task_create',
        hook: 'before',
      },
      jobs: [],
    });

    expect(contract.triggerType).toBe('lifecycle');
    expect(contract.launchable).toBe(false);
  });
});
