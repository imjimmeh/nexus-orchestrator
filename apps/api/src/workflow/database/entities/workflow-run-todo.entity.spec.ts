import { describe, expect, it } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { WorkflowRunTodo } from './workflow-run-todo.entity';

describe('WorkflowRunTodo entity', () => {
  it('maps context projection identity to a neutral column and index predicate', () => {
    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === WorkflowRunTodo)
      .map((column) => column.options.name ?? column.propertyName);
    const indexes = getMetadataArgsStorage().indices.filter(
      (index) => index.target === WorkflowRunTodo,
    );

    expect(columns).toContain('source_context_item_id');
    expect(columns).not.toContain('source_subtask_id');
    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: 'uq_workflow_run_todos_run_context_item',
        where: '"source_context_item_id" IS NOT NULL',
      }),
    );
  });
});
