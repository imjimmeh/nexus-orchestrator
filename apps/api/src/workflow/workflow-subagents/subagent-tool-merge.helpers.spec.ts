import { describe, expect, it } from 'vitest';
import {
  SDK_NATIVE_SUBAGENT_TOOLS,
  mergeSdkNativeToolsForSubagent,
} from './subagent-tool-merge.helpers';

describe('SDK_NATIVE_SUBAGENT_TOOLS constant', () => {
  it('includes all SDK-native runner tools', () => {
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('read');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('write');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('edit');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('bash');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('ls');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('find');
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toContain('grep');
  });

  it('has exactly 7 SDK-native tools', () => {
    expect(SDK_NATIVE_SUBAGENT_TOOLS).toHaveLength(7);
  });
});

describe('mergeSdkNativeToolsForSubagent', () => {
  describe('basic merging', () => {
    it('adds SDK-native tools to an empty tools list', () => {
      const result = mergeSdkNativeToolsForSubagent([]);
      expect(result).toEqual(expect.arrayContaining(SDK_NATIVE_SUBAGENT_TOOLS));
      expect(result).toHaveLength(SDK_NATIVE_SUBAGENT_TOOLS.length);
    });

    it('adds SDK-native tools to a list with only API tools', () => {
      const result = mergeSdkNativeToolsForSubagent([
        'spawn_subagent_async',
        'check_subagent_status',
      ]);
      expect(result).toContain('spawn_subagent_async');
      expect(result).toContain('check_subagent_status');
      expect(result).toEqual(expect.arrayContaining(SDK_NATIVE_SUBAGENT_TOOLS));
    });

    it('preserves caller-specified tools', () => {
      const result = mergeSdkNativeToolsForSubagent([
        'spawn_subagent_async',
        'custom_tool',
      ]);
      expect(result).toContain('spawn_subagent_async');
      expect(result).toContain('custom_tool');
    });
  });

  describe('deduplication', () => {
    it('does not duplicate SDK-native tools already in the list', () => {
      const result = mergeSdkNativeToolsForSubagent(['bash', 'read', 'ls']);
      const bashCount = result.filter((t) => t === 'bash').length;
      const readCount = result.filter((t) => t === 'read').length;
      const lsCount = result.filter((t) => t === 'ls').length;
      expect(bashCount).toBe(1);
      expect(readCount).toBe(1);
      expect(lsCount).toBe(1);
    });

    it('handles all SDK-native tools already present', () => {
      const result = mergeSdkNativeToolsForSubagent([
        ...SDK_NATIVE_SUBAGENT_TOOLS,
      ]);
      expect(result).toHaveLength(SDK_NATIVE_SUBAGENT_TOOLS.length);
    });
  });

  describe('edge cases', () => {
    it('returns sorted array', () => {
      const result = mergeSdkNativeToolsForSubagent(['write', 'bash']);
      const sorted = [...result].sort();
      expect(result).toEqual(sorted);
    });

    it('handles undefined input gracefully', () => {
      const result = mergeSdkNativeToolsForSubagent(
        undefined as unknown as string[],
      );
      expect(result).toEqual(expect.arrayContaining(SDK_NATIVE_SUBAGENT_TOOLS));
    });

    it('handles null input gracefully', () => {
      const result = mergeSdkNativeToolsForSubagent(
        null as unknown as string[],
      );
      expect(result).toEqual(expect.arrayContaining(SDK_NATIVE_SUBAGENT_TOOLS));
    });
  });
});
