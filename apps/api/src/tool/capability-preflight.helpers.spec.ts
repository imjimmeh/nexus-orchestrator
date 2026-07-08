import { describe, expect, it } from 'vitest';
import { isCapabilityRegistered } from './capability-preflight.helpers';

describe('isCapabilityRegistered', () => {
  it('matches an exact registered tool name', () => {
    expect(
      isCapabilityRegistered({
        toolName: 'set_job_output',
        selectedRegisteredTools: [{ name: 'set_job_output' }],
        runnerRuntimeTools: [],
      }),
    ).toBe(true);
  });

  it('matches an exact runner runtime tool name', () => {
    expect(
      isCapabilityRegistered({
        toolName: 'bash',
        selectedRegisteredTools: [],
        runnerRuntimeTools: ['bash', 'read', 'write'],
      }),
    ).toBe(true);
  });

  it('matches a runner-native tool regardless of casing (SDK PascalCase vs runner lowercase)', () => {
    // The Claude Agent SDK emits PascalCase built-in tool names (Bash/Read/
    // Write/Edit/Grep) while the runner-native set is lowercase. These name the
    // same host capability, so the gate must not reject one casing.
    for (const toolName of ['Bash', 'Read', 'Write', 'Edit', 'Grep']) {
      expect(
        isCapabilityRegistered({
          toolName,
          selectedRegisteredTools: [],
          runnerRuntimeTools: ['read', 'write', 'edit', 'bash', 'grep'],
        }),
      ).toBe(true);
    }
  });

  it('returns false when the tool is in neither set', () => {
    expect(
      isCapabilityRegistered({
        toolName: 'RemoteTrigger',
        selectedRegisteredTools: [{ name: 'set_job_output' }],
        runnerRuntimeTools: ['bash'],
      }),
    ).toBe(false);
  });
});
