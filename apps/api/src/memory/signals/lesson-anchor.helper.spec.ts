import { describe, expect, it } from 'vitest';
import { extractLessonAnchor } from './lesson-anchor.helper';

describe('extractLessonAnchor', () => {
  it('returns {} for null / undefined / primitive / array metadata', () => {
    expect(extractLessonAnchor(null)).toEqual({});
    expect(extractLessonAnchor(undefined)).toEqual({});
    expect(extractLessonAnchor('not-an-object')).toEqual({});
    expect(extractLessonAnchor(42)).toEqual({});
    expect(extractLessonAnchor([{ tool: 'read' }])).toEqual({});
  });

  it('returns {} for an empty or anchor-less metadata blob', () => {
    expect(extractLessonAnchor({})).toEqual({});
    expect(
      extractLessonAnchor({ source: 'learning_candidate', confidence: 0.9 }),
    ).toEqual({});
  });

  it('reads direct anchored_tool / anchored_path fields', () => {
    expect(
      extractLessonAnchor({
        anchored_tool: 'run_command',
        anchored_path: 'apps/api/src/main.ts',
      }),
    ).toEqual({ tool: 'run_command', path: 'apps/api/src/main.ts' });
  });

  it('falls back to tool / filePath direct fields and trims them', () => {
    expect(
      extractLessonAnchor({ tool: '  edit  ', filePath: '  src/a.ts ' }),
    ).toEqual({ tool: 'edit', path: 'src/a.ts' });
  });

  it('honours direct-field precedence order (anchored_* wins)', () => {
    expect(
      extractLessonAnchor({
        anchored_tool: 'first',
        tool: 'second',
        anchored_path: 'first/path',
        path: 'second/path',
      }),
    ).toEqual({ tool: 'first', path: 'first/path' });
  });

  it('derives a path from a drift_reference of kind file', () => {
    expect(
      extractLessonAnchor({
        drift_reference: { kind: 'file', reference: 'packages/core/src/x.ts' },
      }),
    ).toEqual({ path: 'packages/core/src/x.ts' });
  });

  it('ignores a non-file drift_reference for the path leg', () => {
    expect(
      extractLessonAnchor({
        drift_reference: { kind: 'schema', reference: 'table.column' },
      }),
    ).toEqual({});
  });

  it('derives tool and path from an evidence array entry', () => {
    expect(
      extractLessonAnchor({
        evidence: [
          { note: 'no anchor here' },
          { tool_name: 'grep', file: 'apps/web/src/App.tsx' },
        ],
      }),
    ).toEqual({ tool: 'grep', path: 'apps/web/src/App.tsx' });
  });

  it('prefers a direct field over an evidence entry', () => {
    expect(
      extractLessonAnchor({
        tool: 'direct_tool',
        evidence: [{ tool: 'evidence_tool', path: 'e/path.ts' }],
      }),
    ).toEqual({ tool: 'direct_tool', path: 'e/path.ts' });
  });

  it('omits a leg entirely when only the other is resolvable', () => {
    expect(extractLessonAnchor({ tool: 'read' })).toEqual({ tool: 'read' });
    expect(extractLessonAnchor({ filePath: 'a.ts' })).toEqual({ path: 'a.ts' });
  });

  it('skips blank-string and non-string anchor values', () => {
    expect(
      extractLessonAnchor({ anchored_tool: '   ', anchored_path: 123 }),
    ).toEqual({});
  });

  it('never throws on a malformed evidence array', () => {
    expect(() =>
      extractLessonAnchor({ evidence: [null, 7, 'str', { tool: 'ok' }] }),
    ).not.toThrow();
    expect(
      extractLessonAnchor({ evidence: [null, 7, 'str', { tool: 'ok' }] }),
    ).toEqual({ tool: 'ok' });
  });
});
