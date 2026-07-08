import * as fs from 'node:fs';
import * as path from 'node:path';

function runtimeTodoProperties(): Record<string, unknown> {
  return {
    id: { type: 'string' },
    title: { type: 'string' },
    status: {
      type: 'string',
      enum: ['not-started', 'in-progress', 'completed'],
    },
    source_context_item_id: { type: 'string' },
  };
}

function runtimeTodoArraySchema(description: string): Record<string, unknown> {
  return {
    oneOf: [
      {
        type: 'array',
        description,
        items: {
          type: 'object',
          properties: runtimeTodoProperties(),
          required: ['status'],
        },
      },
      {
        type: 'string',
        description: `JSON-stringified ${description.toLowerCase()}`,
      },
    ],
  };
}

export function writeToolMountFiles(mountDir: string): void {
  if (fs.existsSync(mountDir)) {
    fs.rmSync(mountDir, { recursive: true, force: true });
  }
  fs.mkdirSync(mountDir, { recursive: true });

  const toolMetadata = JSON.stringify({
    name: 'manage_todo_list',
    schema: {
      type: 'object',
      properties: {
        workflow_run_id: {
          type: 'string',
          description: 'Optional workflow run ID',
        },
        todoList: runtimeTodoArraySchema('Full replacement todo list'),
        todo_list: runtimeTodoArraySchema('Full replacement todo list'),
      },
    },
    tier: 1,
    runtimeOwner: 'api',
    transport: 'api_callback',
    api_callback: {
      method: 'POST',
      path_template: '/api/workflow-runtime/manage-todo-list',
      body_mapping: {
        workflow_run_id: 'workflow_run_id',
        todoList: 'todoList',
        todo_list: 'todo_list',
      },
    },
  });

  fs.writeFileSync(
    path.join(mountDir, 'manage_todo_list.ts'),
    `\nexport const metadata = ${toolMetadata};\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(mountDir, '_sdk_tool_allowlist.json'),
    JSON.stringify(['read', 'write', 'bash', 'ls']),
    'utf-8',
  );
}
