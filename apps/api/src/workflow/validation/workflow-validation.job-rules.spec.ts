import { describe, it, expect } from 'vitest';
import type { IJob } from '@nexus/core';
import { DefaultValidationCollector } from './workflow-validation.collector';
import { validateJobControlFieldsByRules } from './workflow-validation.job-rules';

function makeJob(overrides: Partial<IJob> = {}): IJob {
  return {
    id: 'test-job',
    type: 'execution',
    tier: 'light',
    output_contract: {
      required: ['result'],
      optional: ['summary'],
      types: { result: 'string', summary: 'object' },
    },
    ...overrides,
  };
}

describe('validateOutputContractTypes', () => {
  it('rejects unknown type value', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['result'],
          types: { result: 'list' as never },
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types.result must be a valid output contract type",
      ]),
    );
  });

  it('rejects typed field not declared in required/optional', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['result'],
          types: { result: 'string', undeclared: 'number' },
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types.undeclared references field not declared in required/optional",
      ]),
    );
  });

  it('passes without errors for valid types', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['result'],
          optional: ['summary'],
          types: { result: 'string', summary: 'object' },
        },
      }),
      collector,
    );
    expect(
      collector.toMessages().filter((m) => m.includes('output_contract.types')),
    ).toHaveLength(0);
  });

  it('accepts nested array and object schemas', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['entries'],
          types: {
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: 'string', count: 'integer' },
              },
            },
          },
        },
      }),
      collector,
    );
    expect(
      collector.toMessages().filter((m) => m.includes('output_contract.types')),
    ).toHaveLength(0);
  });

  it('rejects nested schema with invalid item type', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['entries'],
          types: {
            entries: {
              type: 'array',
              items: 'float' as never,
            },
          },
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types.entries must be a valid output contract type",
      ]),
    );
  });

  it('rejects object schema with invalid property type', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['entry'],
          types: {
            entry: {
              type: 'object',
              properties: { name: 'float' as never },
            },
          },
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types.entry must be a valid output contract type",
      ]),
    );
  });

  it('handles types not being an object', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['result'],
          types: 'not-an-object' as never,
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types must be an object",
      ]),
    );
  });

  it('returns early when types is undefined', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: ['result'],
        },
      }),
      collector,
    );
    expect(
      collector.toMessages().filter((m) => m.includes('output_contract.types')),
    ).toHaveLength(0);
  });

  it('rejects empty field name in types key', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: {
          required: [''],
          types: { '': 'string' },
        },
      }),
      collector,
    );
    expect(collector.toMessages()).toEqual(
      expect.arrayContaining([
        "Job 'test-job' output_contract.types contains invalid field name",
      ]),
    );
  });
});

describe('validateRuntimeToolchainInputs', () => {
  it('rejects a step with an unsupported toolchain tool', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: undefined,
        inputs: {
          toolchains: [{ tool: 'evil', version: '1' }],
        },
      }),
      collector,
    );
    expect(
      collector
        .toMessages()
        .some((message) =>
          message.includes("Job 'test-job' has an invalid runtime toolchain"),
        ),
    ).toBe(true);
  });

  it('accepts a job with a valid runtime toolchain config', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: undefined,
        inputs: {
          toolchains: [{ tool: 'python', version: '3.12' }],
          apt_packages: ['libpq-dev'],
        },
      }),
      collector,
    );
    expect(
      collector
        .toMessages()
        .filter((message) => message.includes('runtime toolchain')),
    ).toHaveLength(0);
  });

  it('does nothing when inputs carry no runtime toolchain keys', () => {
    const collector = new DefaultValidationCollector();
    validateJobControlFieldsByRules(
      makeJob({
        output_contract: undefined,
        inputs: { some_other_input: 'value' },
      }),
      collector,
    );
    expect(collector.hasErrors()).toBe(false);
  });
});
