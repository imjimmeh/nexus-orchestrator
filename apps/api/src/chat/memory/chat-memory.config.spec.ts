import { afterEach, describe, expect, it } from 'vitest';
import {
  isMemoryContextInjectionEnabled,
  resolveChatMemoryConfig,
} from './chat-memory.config';

describe('chat-memory.config', () => {
  const previousFlag = process.env.MEMORY_CONTEXT_INJECTION_ENABLED;

  afterEach(() => {
    if (typeof previousFlag === 'string') {
      process.env.MEMORY_CONTEXT_INJECTION_ENABLED = previousFlag;
    } else {
      delete process.env.MEMORY_CONTEXT_INJECTION_ENABLED;
    }
  });

  it('defaults memory context injection to enabled when the env var is absent', () => {
    delete process.env.MEMORY_CONTEXT_INJECTION_ENABLED;
    expect(isMemoryContextInjectionEnabled()).toBe(true);
    expect(resolveChatMemoryConfig().memoryContextInjectionEnabled).toBe(true);
  });

  it('enables memory context injection when MEMORY_CONTEXT_INJECTION_ENABLED=true', () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'true';
    expect(isMemoryContextInjectionEnabled()).toBe(true);
    expect(resolveChatMemoryConfig().memoryContextInjectionEnabled).toBe(true);
  });

  it('disables memory context injection when MEMORY_CONTEXT_INJECTION_ENABLED=false', () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'false';
    expect(isMemoryContextInjectionEnabled()).toBe(false);
    expect(resolveChatMemoryConfig().memoryContextInjectionEnabled).toBe(false);
  });

  it('treats surrounding whitespace and mixed case as valid booleans', () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = '  TRUE  ';
    expect(isMemoryContextInjectionEnabled()).toBe(true);

    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'False';
    expect(isMemoryContextInjectionEnabled()).toBe(false);
  });

  it('falls back to the default when the env var carries an unknown value', () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'yes-please';
    expect(isMemoryContextInjectionEnabled()).toBe(true);

    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = '0';
    expect(isMemoryContextInjectionEnabled()).toBe(true);
  });
});
