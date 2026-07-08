import { describe, it, expect } from 'vitest';
import {
  validateRuntimeToolchainConfig,
  ToolchainValidationError,
} from './toolchain-validation';

describe('validateRuntimeToolchainConfig', () => {
  it('accepts a supported tool + safe version', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: 'python', version: '3.12' }],
      });
    }).not.toThrow();
  });

  it('rejects an unknown tool naming the offender', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: 'haskell-evil', version: '1' }],
      });
    }).toThrow(/haskell-evil/);
  });

  it('rejects a version with shell metacharacters', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [{ tool: 'python', version: '3.12; rm -rf /' }],
      });
    }).toThrow(ToolchainValidationError);
  });

  it('rejects an apt package with bad charset', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        aptPackages: ['libpq-dev && curl evil'],
      });
    }).toThrow(ToolchainValidationError);
  });

  it('rejects a cache id outside [a-z0-9-]', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'BAD_ID', path: '/x' }],
      });
    }).toThrow(/BAD_ID/);
  });

  it('rejects a non-absolute or traversing cache path and sensitive mounts', () => {
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: 'rel' }],
      });
    }).toThrow();
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/x/../y' }],
      });
    }).toThrow();
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/workspace' }],
      });
    }).toThrow();
  });

  it('rejects path variants of blocked mounts (trailing slash, double slash, ./ segments)', () => {
    // /workspace with trailing slash
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/workspace/' }],
      });
    }).toThrow(/Cache path not allowed/);

    // /workspace with double leading slash
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '//workspace' }],
      });
    }).toThrow(/Cache path not allowed/);

    // /workspace with ./ segment
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/./workspace' }],
      });
    }).toThrow(/Cache path not allowed/);

    // /app with trailing slash
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/app/' }],
      });
    }).toThrow(/Cache path not allowed/);

    // / (root) with ./ prefix
    expect(() => {
      validateRuntimeToolchainConfig({
        toolchains: [],
        caches: [{ id: 'a', path: '/./' }],
      });
    }).toThrow(/Cache path not allowed/);
  });
});
