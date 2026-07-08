import { expect } from 'vitest';

export function expectCeoAuthorityContract(params: {
  allowTools: readonly string[];
  prompt: string;
}): void {
  expect(params.allowTools).toEqual(
    expect.arrayContaining([
      'delegate_goal_backlog_planning',
      'delegate_imported_repo_discovery',
      'delegate_orchestration_advisor',
      'delegate_design_ingestion',
      'delegate_ui_ux_testing',
      'delegate_web_research',
    ]),
  );
  expect(params.allowTools).not.toContain('invoke_agent_workflow');

  expect(params.prompt).toContain(
    'You are the canonical mutating project orchestrator',
  );
  expect(params.prompt).toContain('Projected Delegation Cycle');
  expect(params.prompt).toContain('delegate_goal_backlog_planning');
  expect(params.prompt).toContain('delegate_imported_repo_discovery');
  expect(params.prompt).toContain('delegate_orchestration_advisor');
  expect(params.prompt).toContain('delegate_ui_ux_testing');
  expect(params.prompt).toContain('delegate_web_research');
  expect(params.prompt).toContain('Advisor is read-only');
  expect(params.prompt).toContain('Lifecycle Start Rules');
  expect(params.prompt).not.toContain('invoke_agent_workflow');
  expect(params.prompt).not.toContain('set_job_output');
  expectPromptOrder(params.prompt, [
    'REQUIRED MUTATING ACTION ORDER',
    '1.',
    '2.',
    'Mutating action',
    'Final decision',
    'step_complete',
  ]);
}

function expectPromptOrder(prompt: string, orderedFragments: string[]): void {
  let previousIndex = -1;

  for (const fragment of orderedFragments) {
    const index = prompt.indexOf(fragment, previousIndex + 1);
    expect(
      index,
      `Expected prompt to contain ${fragment}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      index,
      `Expected ${fragment} to appear after the previous authority sequence fragment`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = index;
  }
}
