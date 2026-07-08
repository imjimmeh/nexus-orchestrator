import { describe, expect, it } from 'vitest';
import { matchesAnchor } from './anchor-match.helper';
import type { AnchorMatchRow } from './anchor-match.types';

describe('matchesAnchor', () => {
  const rows: AnchorMatchRow[] = [
    { toolName: 'read_file', pathText: '{"path":"src/memory/decay.ts"}' },
    { toolName: 'run_command', pathText: '{"command":"npm test"}' },
  ];

  it('returns true when the anchored tool was invoked (exact tool-name match)', () => {
    expect(matchesAnchor(rows, { tool: 'run_command' })).toBe(true);
  });

  it('returns false for a tool that was not invoked', () => {
    expect(matchesAnchor(rows, { tool: 'write_file' })).toBe(false);
  });

  it('does a substring (not exact) match on the path leg', () => {
    expect(matchesAnchor(rows, { path: 'memory/decay.ts' })).toBe(true);
    expect(matchesAnchor(rows, { path: 'memory/missing.ts' })).toBe(false);
  });

  it('requires tool AND path to match on the SAME row when both are present', () => {
    // tool read_file is on the row whose path contains decay.ts → match
    expect(
      matchesAnchor(rows, { tool: 'read_file', path: 'memory/decay.ts' }),
    ).toBe(true);
    // run_command is present and decay.ts is present, but not on the same
    // row → no match (the tool was not invoked ON that path).
    expect(
      matchesAnchor(rows, { tool: 'run_command', path: 'memory/decay.ts' }),
    ).toBe(false);
  });

  it('does NOT count a lesson with no anchor (empty anchor → false)', () => {
    expect(matchesAnchor(rows, {})).toBe(false);
    expect(matchesAnchor(rows, { tool: '   ' })).toBe(false);
    expect(matchesAnchor(rows, { path: '' })).toBe(false);
  });

  it('returns false against an empty row set', () => {
    expect(matchesAnchor([], { tool: 'read_file' })).toBe(false);
  });

  it('tolerates rows missing one of the two fields', () => {
    const partial: AnchorMatchRow[] = [
      { toolName: 'read_file' },
      { pathText: 'src/a.ts' },
    ];
    expect(matchesAnchor(partial, { tool: 'read_file' })).toBe(true);
    expect(matchesAnchor(partial, { path: 'src/a.ts' })).toBe(true);
    // tool present on one row, path on another → no same-row match.
    expect(
      matchesAnchor(partial, { tool: 'read_file', path: 'src/a.ts' }),
    ).toBe(false);
  });
});
