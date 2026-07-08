import { describe, it, expect } from 'vitest';
import { ToolPolicyEffect } from '@nexus/core';
import type { IWorkflowDefinition } from '@nexus/core';
import { DefaultValidationCollector } from './workflow-validation.collector';
import { createValidationContext } from './workflow-validation.types';
import {
  validateWorkflowStructure,
  validateJobStructuralFields,
} from './workflow-validation.workflow-validators';

function makeDefinition(
  overrides: Partial<IWorkflowDefinition> = {},
): IWorkflowDefinition {
  return {
    workflow_id: 'test-wf',
    name: 'Test WF',
    jobs: [
      {
        id: 'job1',
        type: 'execution',
        tier: 'light',
        steps: [{ id: 'step1', type: 'agent', prompt: 'do it' }],
      },
    ],
    ...overrides,
  };
}

describe('validateToolPolicyShape', () => {
  it('accepts valid tool_policy on workflow permissions', () => {
    const collector = new DefaultValidationCollector();
    validateWorkflowStructure(
      createValidationContext(
        makeDefinition({
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [{ effect: ToolPolicyEffect.ALLOW, tool: 'read' }],
            },
          },
        }),
      ),
      collector,
    );
    expect(
      collector.toMessages().filter((e) => e.includes('tool_policy')),
    ).toHaveLength(0);
  });

  it('rejects tool_policy with invalid default effect', () => {
    const collector = new DefaultValidationCollector();
    validateWorkflowStructure(
      createValidationContext(
        makeDefinition({
          permissions: {
            tool_policy: { default: 'invalid' as never, rules: [] },
          },
        }),
      ),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some((e) => e.includes('tool_policy') && e.includes('default')),
    ).toBe(true);
  });

  it('rejects tool_policy with rule missing tool field', () => {
    const collector = new DefaultValidationCollector();
    validateWorkflowStructure(
      createValidationContext(
        makeDefinition({
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: [{ effect: ToolPolicyEffect.ALLOW } as never],
            },
          },
        }),
      ),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some((e) => e.includes('tool_policy') && e.includes('tool')),
    ).toBe(true);
  });

  it('accepts tool_policy with string shorthand rules', () => {
    const collector = new DefaultValidationCollector();
    validateWorkflowStructure(
      createValidationContext(
        makeDefinition({
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: ['allow read *', 'deny write *'],
            },
          },
        }),
      ),
      collector,
    );
    expect(
      collector.toMessages().filter((e) => e.includes('tool_policy')),
    ).toHaveLength(0);
  });

  it('rejects tool_policy with rules that is not an array', () => {
    const collector = new DefaultValidationCollector();
    validateWorkflowStructure(
      createValidationContext(
        makeDefinition({
          permissions: {
            tool_policy: {
              default: ToolPolicyEffect.DENY,
              rules: 'not-an-array' as never,
            },
          },
        }),
      ),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some((e) => e.includes('tool_policy') && e.includes('rules')),
    ).toBe(true);
  });
});

describe('validateJobStructuralFields tool_policy', () => {
  it('accepts valid tool_policy on job permissions', () => {
    const collector = new DefaultValidationCollector();
    validateJobStructuralFields(
      createValidationContext(
        makeDefinition({
          jobs: [
            {
              id: 'job1',
              type: 'execution',
              tier: 'light',
              steps: [{ id: 'step1', type: 'agent', prompt: 'do it' }],
              permissions: {
                tool_policy: {
                  default: ToolPolicyEffect.ALLOW,
                  rules: [{ effect: ToolPolicyEffect.DENY, tool: 'write' }],
                },
              },
            },
          ],
        }),
      ),
      collector,
    );
    expect(
      collector.toMessages().filter((e) => e.includes('tool_policy')),
    ).toHaveLength(0);
  });

  it('rejects tool_policy with invalid default on job permissions', () => {
    const collector = new DefaultValidationCollector();
    validateJobStructuralFields(
      createValidationContext(
        makeDefinition({
          jobs: [
            {
              id: 'job1',
              type: 'execution',
              tier: 'light',
              steps: [{ id: 'step1', type: 'agent', prompt: 'do it' }],
              permissions: {
                tool_policy: { default: 'bogus' as never, rules: [] },
              },
            },
          ],
        }),
      ),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some(
          (e) =>
            e.includes('tool_policy') &&
            e.includes('default') &&
            e.includes('job1'),
        ),
    ).toBe(true);
  });

  it('rejects tool_policy with rule missing tool on job permissions', () => {
    const collector = new DefaultValidationCollector();
    validateJobStructuralFields(
      createValidationContext(
        makeDefinition({
          jobs: [
            {
              id: 'job1',
              type: 'execution',
              tier: 'light',
              steps: [{ id: 'step1', type: 'agent', prompt: 'do it' }],
              permissions: {
                tool_policy: {
                  default: ToolPolicyEffect.DENY,
                  rules: [{ effect: ToolPolicyEffect.ALLOW } as never],
                },
              },
            },
          ],
        }),
      ),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some(
          (e) =>
            e.includes('tool_policy') &&
            e.includes('tool') &&
            e.includes('job1'),
        ),
    ).toBe(true);
  });
});
