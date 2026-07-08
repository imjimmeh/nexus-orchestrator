import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  normalizeTodoInputs,
  toWorkflowRunTodoRecord,
} from './workflow-run-todo.helpers';

describe('workflow-run-todo.helpers', () => {
  it('normalizes todo items with canonical shared statuses', () => {
    const normalized = normalizeTodoInputs([
      { title: 'A', status: 'not-started' },
      { title: 'B', status: 'in-progress' },
      { title: 'C', status: 'completed' },
    ]);

    expect(normalized).toEqual([
      {
        id: null,
        title: 'A',
        status: 'not-started',
        sourceContextItemId: null,
      },
      {
        id: null,
        title: 'B',
        status: 'in-progress',
        sourceContextItemId: null,
      },
      {
        id: null,
        title: 'C',
        status: 'completed',
        sourceContextItemId: null,
      },
    ]);
  });

  it('rejects statuses outside canonical shared values', () => {
    const invalidInput = [
      {
        title: 'A',
        status: 'blocked',
      },
    ] as unknown as Parameters<typeof normalizeTodoInputs>[0];

    expect(() => normalizeTodoInputs(invalidInput)).toThrow(
      BadRequestException,
    );
    expect(() => normalizeTodoInputs(invalidInput)).toThrow(
      'todo_list[0].status must be one of not-started, in-progress, completed',
    );
  });

  it('normalizes only the canonical source context item identifier', () => {
    const input = [
      {
        title: 'A',
        status: 'in-progress',
        source_context_item_id: 'context-a',
      },
      {
        title: 'B',
        status: 'completed',
        context_item_id: 'context-b',
        contextItemId: 'context-c',
      },
    ] as unknown as Parameters<typeof normalizeTodoInputs>[0];

    const normalized = normalizeTodoInputs(input);

    expect(normalized).toEqual([
      {
        id: null,
        title: 'A',
        status: 'in-progress',
        sourceContextItemId: 'context-a',
      },
      {
        id: null,
        title: 'B',
        status: 'completed',
        sourceContextItemId: null,
      },
    ]);
  });

  it('serializes todo readback with the canonical source context item identifier', () => {
    const record = toWorkflowRunTodoRecord({
      id: 'todo-1',
      title: 'Implement endpoint',
      status: 'in-progress',
      orderIndex: 0,
      sourceKind: 'context_source',
      sourceContextItemId: 'context-item-1',
      updatedAt: new Date('2026-04-12T00:00:00.000Z'),
    });

    expect(record).toEqual({
      id: 'todo-1',
      title: 'Implement endpoint',
      status: 'in-progress',
      order_index: 0,
      source_kind: 'context_source',
      source_context_item_id: 'context-item-1',
      updated_at: '2026-04-12T00:00:00.000Z',
    });
    expect(record).not.toHaveProperty('context_id');
  });
});
