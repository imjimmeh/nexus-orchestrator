import { describe, expect, it } from 'vitest';
import { filterMcpTools } from './mcp-filter.utils';

describe('filterMcpTools', () => {
  const tools = [
    { name: 'filesystem/read' },
    { name: 'filesystem/write' },
    { name: 'git/status' },
    { name: 'project/list' },
  ];

  it('returns all tools when no filters are provided', () => {
    const result = filterMcpTools(tools, undefined, undefined);
    expect(result).toEqual(tools);
  });

  it('applies include allowlist patterns before denylist patterns', () => {
    const result = filterMcpTools(
      tools,
      ['filesystem/*', 'git/*'],
      ['*/write*'],
    );
    expect(result.map((tool) => tool.name)).toEqual([
      'filesystem/read',
      'git/status',
    ]);
  });

  it('supports case-insensitive wildcard matching', () => {
    const result = filterMcpTools(tools, ['PROJECT/*'], []);
    expect(result.map((tool) => tool.name)).toEqual(['project/list']);
  });
});
