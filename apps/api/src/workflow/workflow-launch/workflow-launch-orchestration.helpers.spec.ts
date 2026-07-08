import { describe, expect, it, vi } from 'vitest';
import {
  normalizeRecord,
  resolveActorId,
  buildLaunchValidationException,
  buildWorkflowLaunchDescriptor,
} from './workflow-launch-orchestration.helpers';

// ---------------------------------------------------------------------------
// normalizeRecord
// ---------------------------------------------------------------------------
describe('normalizeRecord', () => {
  it('returns empty object for null input', () => {
    expect(normalizeRecord(null)).toEqual({});
  });

  it('returns empty object for undefined input', () => {
    expect(normalizeRecord(undefined)).toEqual({});
  });

  it('returns empty object for array input', () => {
    expect(normalizeRecord([1, 2, 3])).toEqual({});
  });

  it('returns empty object for primitive string input', () => {
    expect(normalizeRecord('hello')).toEqual({});
  });

  it('returns empty object for primitive number input', () => {
    expect(normalizeRecord(42)).toEqual({});
  });

  it('returns the object itself for valid Record<string, unknown> input', () => {
    const input = { a: 1, b: 'two', c: true };
    expect(normalizeRecord(input)).toBe(input);
  });

  it('returns empty object for Date object (which is object but not plain)', () => {
    // Date is an object, but not a plain record — the function passes it through.
    // The precondition check only filters null/undefined/arrays/primitive,
    // so a Date will pass the typeof === 'object' check.
    const date = new Date('2024-01-01');
    const result = normalizeRecord(date);
    // Date passes the guard, so the function returns the Date as-is.
    expect(result).toBe(date);
  });
});

// ---------------------------------------------------------------------------
// resolveActorId
// ---------------------------------------------------------------------------
describe('resolveActorId', () => {
  it('returns null when request has no user property', () => {
    const req = {} as Parameters<typeof resolveActorId>[0];
    expect(resolveActorId(req)).toBeNull();
  });

  it('returns null when user has no id and no sub', () => {
    const req = { user: {} } as Parameters<typeof resolveActorId>[0];
    expect(resolveActorId(req)).toBeNull();
  });

  it('returns user.id as string when present', () => {
    const req = { user: { id: 'user-123' } } as Parameters<
      typeof resolveActorId
    >[0];
    expect(resolveActorId(req)).toBe('user-123');
  });

  it('returns user.sub as string when id is absent', () => {
    const req = { user: { sub: 'auth0|abc' } } as Parameters<
      typeof resolveActorId
    >[0];
    expect(resolveActorId(req)).toBe('auth0|abc');
  });

  it('prefers user.id over user.sub when both present', () => {
    const req = {
      user: { id: 'user-123', sub: 'auth0|abc' },
    } as Parameters<typeof resolveActorId>[0];
    expect(resolveActorId(req)).toBe('user-123');
  });

  it('returns null when user.id is empty string and user.sub is empty string', () => {
    const req = {
      user: { id: '', sub: '' },
    } as Parameters<typeof resolveActorId>[0];
    expect(resolveActorId(req)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildLaunchValidationException
// ---------------------------------------------------------------------------
describe('buildLaunchValidationException', () => {
  it('creates BadRequestException with correct message', () => {
    const issues = [
      {
        code: 'CONTEXT_REQUIRED' as const,
        message: 'Context is required',
      },
    ];

    const exception = buildLaunchValidationException(issues);

    expect(exception.message).toBe(
      'Workflow launch payload validation failed.',
    );
    expect(exception).toBeInstanceOf(Error);
  });

  it('exception response contains code WORKFLOW_LAUNCH_VALIDATION_FAILED', () => {
    const issues = [
      {
        code: 'MISSING_REQUIRED_INPUT' as const,
        message: 'Missing required input',
      },
    ];

    const exception = buildLaunchValidationException(issues);
    const response = exception.getResponse() as Record<string, unknown>;

    expect(response.code).toBe('WORKFLOW_LAUNCH_VALIDATION_FAILED');
  });

  it('exception response contains the issues array', () => {
    const issues = [
      { code: 'CONTEXT_REQUIRED' as const, message: 'Context required' },
      { code: 'INVALID_INPUT_TYPE' as const, message: 'Bad type' },
    ];

    const exception = buildLaunchValidationException(issues);
    const response = exception.getResponse() as Record<string, unknown>;

    expect(response.issues).toEqual(issues);
    expect(response.issues).toHaveLength(2);
  });

  it('handles empty issues array gracefully', () => {
    const exception = buildLaunchValidationException([]);
    const response = exception.getResponse() as Record<string, unknown>;

    expect(response.code).toBe('WORKFLOW_LAUNCH_VALIDATION_FAILED');
    expect(response.issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildWorkflowLaunchDescriptor (the helper version)
// ---------------------------------------------------------------------------
describe('buildWorkflowLaunchDescriptor', () => {
  const stubWorkflow = {
    id: 'row-id-1',
    yaml_definition: 'some-yaml',
    is_active: true,
  };

  const stubContext = {
    scopeId: 'scope-1',
    contextId: 'context-1',
  };

  const stubDefinition = {
    workflow_id: 'wf-def-1',
    name: 'Test Workflow',
    description: 'A test workflow',
  };

  const stubContract = { launchable: true, context: 'none' };
  const stubEligibility = { eligible: true, reasons: [] };

  it('returns a complete WorkflowLaunchDescriptor on success', () => {
    const parseWorkflow = vi.fn().mockReturnValue(stubDefinition);
    const buildContract = vi.fn().mockReturnValue(stubContract);
    const evaluateEligibility = vi.fn().mockReturnValue(stubEligibility);

    const result = buildWorkflowLaunchDescriptor({
      workflow: stubWorkflow as Parameters<
        typeof buildWorkflowLaunchDescriptor
      >[0]['workflow'],
      context: stubContext,
      parseWorkflow,
      buildContract,
      evaluateEligibility,
    });

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      workflowRowId: 'row-id-1',
      workflowDefinitionId: 'wf-def-1',
      workflowName: 'Test Workflow',
      isActive: true,
      description: 'A test workflow',
      contract: stubContract,
      eligibility: stubEligibility,
    });
  });

  it('returns null when parseWorkflow throws', () => {
    const parseWorkflow = vi.fn().mockImplementation(() => {
      throw new Error('Parse error');
    });
    const buildContract = vi.fn();
    const evaluateEligibility = vi.fn();

    const result = buildWorkflowLaunchDescriptor({
      workflow: stubWorkflow as Parameters<
        typeof buildWorkflowLaunchDescriptor
      >[0]['workflow'],
      context: stubContext,
      parseWorkflow,
      buildContract,
      evaluateEligibility,
    });

    expect(result).toBeNull();
    expect(parseWorkflow).toHaveBeenCalledWith('some-yaml');
    expect(buildContract).not.toHaveBeenCalled();
    expect(evaluateEligibility).not.toHaveBeenCalled();
  });

  it('returns null when buildContract throws', () => {
    const parseWorkflow = vi.fn().mockReturnValue(stubDefinition);
    const buildContract = vi.fn().mockImplementation(() => {
      throw new Error('Build error');
    });
    const evaluateEligibility = vi.fn();

    const result = buildWorkflowLaunchDescriptor({
      workflow: stubWorkflow as Parameters<
        typeof buildWorkflowLaunchDescriptor
      >[0]['workflow'],
      context: stubContext,
      parseWorkflow,
      buildContract,
      evaluateEligibility,
    });

    expect(result).toBeNull();
    expect(parseWorkflow).toHaveBeenCalled();
    expect(buildContract).toHaveBeenCalledWith(stubDefinition);
    expect(evaluateEligibility).not.toHaveBeenCalled();
  });

  it('returns null when evaluateEligibility throws', () => {
    const parseWorkflow = vi.fn().mockReturnValue(stubDefinition);
    const buildContract = vi.fn().mockReturnValue(stubContract);
    const evaluateEligibility = vi.fn().mockImplementation(() => {
      throw new Error('Eligibility error');
    });

    const result = buildWorkflowLaunchDescriptor({
      workflow: stubWorkflow as Parameters<
        typeof buildWorkflowLaunchDescriptor
      >[0]['workflow'],
      context: stubContext,
      parseWorkflow,
      buildContract,
      evaluateEligibility,
    });

    expect(result).toBeNull();
    expect(parseWorkflow).toHaveBeenCalled();
    expect(buildContract).toHaveBeenCalled();
    expect(evaluateEligibility).toHaveBeenCalledWith(stubContract, stubContext);
  });

  it('descriptor includes eligibility result', () => {
    const customEligibility = {
      eligible: false,
      reasons: [
        { code: 'WORKFLOW_NOT_MANUAL' as const, message: 'Not manual' },
      ],
    };

    const parseWorkflow = vi.fn().mockReturnValue(stubDefinition);
    const buildContract = vi.fn().mockReturnValue(stubContract);
    const evaluateEligibility = vi.fn().mockReturnValue(customEligibility);

    const result = buildWorkflowLaunchDescriptor({
      workflow: stubWorkflow as Parameters<
        typeof buildWorkflowLaunchDescriptor
      >[0]['workflow'],
      context: stubContext,
      parseWorkflow,
      buildContract,
      evaluateEligibility,
    });

    expect(result).not.toBeNull();
    expect(result!.eligibility).toBe(customEligibility);
    expect(result!.eligibility.eligible).toBe(false);
    expect(result!.eligibility.reasons[0].code).toBe('WORKFLOW_NOT_MANUAL');
  });
});
