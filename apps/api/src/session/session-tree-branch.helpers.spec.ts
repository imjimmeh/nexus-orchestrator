import { describe, it, expect } from 'vitest';
import { resolveContinuationParentId } from './session-tree-branch.helpers';

type Node = Record<string, unknown>;

const userTurn = (id: string, parentId?: string): Node => ({
  id,
  type: 'message',
  parentId,
  message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
});

const toolResult = (id: string, parentId?: string): Node => ({
  id,
  type: 'message',
  parentId,
  message: { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] },
});

const abortedAssistant = (id: string, parentId?: string): Node => ({
  id,
  type: 'message',
  parentId,
  message: { role: 'assistant', stopReason: 'aborted', content: [] },
});

const completedAssistant = (id: string, parentId?: string): Node => ({
  id,
  type: 'message',
  parentId,
  message: {
    role: 'assistant',
    stopReason: 'end_turn',
    content: [{ type: 'text', text: 'done' }],
  },
});

describe('resolveContinuationParentId', () => {
  it('returns the requested parent unchanged when it is a tool_result turn', () => {
    const nodes = [userTurn('u1'), toolResult('t1', 'u1')];
    expect(resolveContinuationParentId(nodes, 't1')).toBe('t1');
  });

  it('skips past a trailing aborted assistant to its parent', () => {
    // u1 -> t1(toolResult) -> a1(aborted assistant). A resume result attached to
    // a1 would keep the aborted turn in the active branch and crash the pi SDK.
    const nodes = [
      userTurn('u1'),
      toolResult('t1', 'u1'),
      abortedAssistant('a1', 't1'),
    ];
    expect(resolveContinuationParentId(nodes, 'a1')).toBe('t1');
  });

  it('skips past an empty-content assistant even without an aborted stop reason', () => {
    const empty: Node = {
      id: 'a1',
      type: 'message',
      parentId: 't1',
      message: { role: 'assistant', content: [] },
    };
    const nodes = [userTurn('u1'), toolResult('t1', 'u1'), empty];
    expect(resolveContinuationParentId(nodes, 'a1')).toBe('t1');
  });

  it('skips past multiple stacked interrupted assistant turns', () => {
    const nodes = [
      toolResult('t1'),
      abortedAssistant('a1', 't1'),
      abortedAssistant('a2', 'a1'),
    ];
    expect(resolveContinuationParentId(nodes, 'a2')).toBe('t1');
  });

  it('does NOT skip a completed (end_turn) assistant turn', () => {
    const nodes = [userTurn('u1'), completedAssistant('a1', 'u1')];
    expect(resolveContinuationParentId(nodes, 'a1')).toBe('a1');
  });

  it('returns the requested parent when the node is not present', () => {
    const nodes = [userTurn('u1')];
    expect(resolveContinuationParentId(nodes, 'missing')).toBe('missing');
  });

  it('returns an empty string unchanged (fresh tree, no leaf)', () => {
    expect(resolveContinuationParentId([], '')).toBe('');
  });
});
