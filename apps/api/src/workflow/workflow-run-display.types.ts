import type { IWorkflowRun } from '@nexus/core';

export type WorkflowRunDisplayItem = IWorkflowRun & {
  display_name: string;
  workflow_name: string | null;
  source_type?: 'seed' | 'user' | 'repository';
};
