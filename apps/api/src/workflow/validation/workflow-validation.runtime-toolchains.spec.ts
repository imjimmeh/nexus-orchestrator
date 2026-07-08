import { describe, it, expect } from 'vitest';
import {
  parseStepRuntimeToolchainConfig,
  parseRunInputRuntimeToolchainConfig,
} from './workflow-validation.runtime-toolchains';
import { ToolchainValidationError } from '../workflow-runtime-toolchains/toolchain-validation';

describe('parseStepRuntimeToolchainConfig', () => {
  it('parses toolchains/apt_packages/caches from step inputs', () => {
    const config = parseStepRuntimeToolchainConfig({
      toolchains: [{ tool: 'python', version: '3.12' }],
      apt_packages: ['libpq-dev'],
      caches: [{ id: 'custom', path: '/root/.custom-cache' }],
      disable_caches: ['apt'],
    });

    expect(config).toEqual({
      toolchains: [{ tool: 'python', version: '3.12' }],
      aptPackages: ['libpq-dev'],
      caches: [{ id: 'custom', path: '/root/.custom-cache' }],
      disableCaches: ['apt'],
    });
  });

  it('returns undefined when no runtime toolchain keys are present', () => {
    expect(parseStepRuntimeToolchainConfig(undefined)).toBeUndefined();
    expect(
      parseStepRuntimeToolchainConfig({ some_other_input: 'value' }),
    ).toBeUndefined();
  });

  it('throws via validation on a bad tool', () => {
    expect(() =>
      parseStepRuntimeToolchainConfig({
        toolchains: [{ tool: 'haskell-evil', version: '1' }],
      }),
    ).toThrow(ToolchainValidationError);
  });
});

describe('parseRunInputRuntimeToolchainConfig', () => {
  it('parses the neutral runtime_toolchains field off the trigger record', () => {
    const config = parseRunInputRuntimeToolchainConfig({
      scopeId: 'proj-1',
      runtime_toolchains: {
        toolchains: [{ tool: 'go', version: '1.23' }],
      },
    });

    expect(config).toEqual({
      toolchains: [{ tool: 'go', version: '1.23' }],
    });
  });

  it('returns undefined when the trigger carries no runtime_toolchains field', () => {
    expect(parseRunInputRuntimeToolchainConfig(undefined)).toBeUndefined();
    expect(
      parseRunInputRuntimeToolchainConfig({ scopeId: 'proj-1' }),
    ).toBeUndefined();
  });

  it('returns undefined when runtime_toolchains is not shaped like a config', () => {
    expect(
      parseRunInputRuntimeToolchainConfig({ runtime_toolchains: 'nope' }),
    ).toBeUndefined();
    expect(
      parseRunInputRuntimeToolchainConfig({
        runtime_toolchains: { aptPackages: ['libpq-dev'] },
      }),
    ).toBeUndefined();
  });

  it('throws via validation on a bad tool', () => {
    expect(() =>
      parseRunInputRuntimeToolchainConfig({
        runtime_toolchains: {
          toolchains: [{ tool: 'haskell-evil', version: '1' }],
        },
      }),
    ).toThrow(ToolchainValidationError);
  });
});
