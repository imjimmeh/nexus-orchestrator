import { describe, expect, it } from 'vitest';
import {
  classifySharedCloneBlockers,
  parsePorcelainEntries,
} from './git-shared-clone-reconcile.helpers';

describe('parsePorcelainEntries', () => {
  it('parses NUL-separated porcelain v1 records including spaces and renames', () => {
    const stdout =
      '?? docs/notes/context 1.md\0 D .agents/skills/debugging/SKILL.md\0R  old.md -> new name.md\0';
    expect(parsePorcelainEntries(stdout)).toEqual([
      { status: '??', path: 'docs/notes/context 1.md' },
      { status: ' D', path: '.agents/skills/debugging/SKILL.md' },
      { status: 'R ', path: 'new name.md' },
    ]);
  });

  it('returns an empty list for empty output', () => {
    expect(parsePorcelainEntries('')).toEqual([]);
  });
});

describe('classifySharedCloneBlockers', () => {
  const sourceTracked = new Set([
    'docs/notes/context-1.md',
    '.agents/skills/debugging/SKILL.md',
    'src/feature.ts',
  ]);

  it('classifies tracked deletions as restorable', () => {
    const result = classifySharedCloneBlockers(
      [
        { status: ' D', path: '.agents/skills/debugging/SKILL.md' },
        { status: 'D ', path: 'src/feature.ts' },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: ['.agents/skills/debugging/SKILL.md', 'src/feature.ts'],
      quarantinable: [],
      ambiguous: [],
    });
  });

  it('classifies untracked source-tracked files as quarantinable and other untracked as non-blocking', () => {
    const result = classifySharedCloneBlockers(
      [
        { status: '??', path: 'docs/notes/context-1.md' },
        { status: '??', path: 'scratch/notes.md' },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: [],
      quarantinable: ['docs/notes/context-1.md'],
      ambiguous: [],
    });
  });

  it('classifies modified tracked files as ambiguous', () => {
    const result = classifySharedCloneBlockers(
      [
        { status: ' M', path: 'src/feature.ts' },
        { status: 'MM', path: 'docs/notes/context-1.md' },
      ],
      sourceTracked,
    );
    expect(result).toEqual({
      restorable: [],
      quarantinable: [],
      ambiguous: ['src/feature.ts', 'docs/notes/context-1.md'],
    });
  });
});
