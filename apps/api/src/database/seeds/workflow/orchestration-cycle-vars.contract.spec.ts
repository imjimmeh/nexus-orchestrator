import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { StateManagerService } from '../../../workflow/state-manager.service';

const SEED_PATH = resolve(
  __dirname,
  '../../../../../../seed/workflows/project-orchestration-cycle-ceo.workflow.yaml',
);

interface Job {
  id: string;
  condition?: string;
}

function jobsById(): Record<string, Job> {
  const def = load(readFileSync(SEED_PATH, 'utf8')) as { jobs: Job[] };
  return Object.fromEntries(def.jobs.map((j) => [j.id, j]));
}

// Minimal renderer: StateManagerService.substituteTemplate is pure w.r.t the
// run repo for condition rendering, so we can construct it with a no-op repo.
function render(
  condition: string,
  variables: Record<string, unknown>,
): boolean {
  const svc = new StateManagerService({} as never);
  return svc.substituteTemplate(condition, variables).trim() === 'true';
}

const DEFAULT_VARS = {
  vars: {
    gates: {
      rediscovery_merge_threshold: 10,
      ideation_starvation_cycles: 2,
      roadmap_when_no_active_initiative: true,
    },
    backlog: { ideation_enabled: true, bootstrap_enabled: true },
  },
};

function staleness(partial: Record<string, number>) {
  return {
    ...DEFAULT_VARS,
    jobs: {
      load_state: {
        output: {
          result: { strategic: { staleness: partial } },
        },
      },
    },
  };
}

describe('CEO cycle gate conditions read from vars', () => {
  it('rediscovery gate references vars, not a literal', () => {
    const cond = jobsById().rediscovery_gate.condition ?? '';
    expect(cond).toContain('vars.gates.rediscovery_merge_threshold');
    expect(cond).not.toMatch(/mergesSinceDiscovery 10\)/);
  });

  it('rediscovery gate behaves identically to the old >=10 literal', () => {
    const cond = jobsById().rediscovery_gate.condition ?? '';
    for (const merges of [0, 9, 10, 11, 50]) {
      const expected = merges >= 10;
      expect(render(cond, staleness({ mergesSinceDiscovery: merges }))).toBe(
        expected,
      );
    }
  });

  it('ideation gate behaves identically to the old (burn==0 OR forecast<=2) literal', () => {
    const cond = jobsById().ideation_gate.condition ?? '';
    const cases = [
      {
        recentBurnRatePerCycle: 0,
        starvationForecastCycles: 99,
        expected: true,
      },
      {
        recentBurnRatePerCycle: 5,
        starvationForecastCycles: 2,
        expected: true,
      },
      {
        recentBurnRatePerCycle: 5,
        starvationForecastCycles: 3,
        expected: false,
      },
    ];
    for (const c of cases) {
      expect(render(cond, staleness(c))).toBe(c.expected);
    }
  });

  it('promote_safe_backlog fires while todo_count is below the target depth buffer', () => {
    const cond = jobsById().promote_safe_backlog.condition ?? '';
    // Fix C: deterministic engine promotion keeps a shallow todo buffer rather
    // than back-filling only at exactly zero todo.
    expect(cond).toContain('vars.backlog.target_todo_depth');
    const vars = {
      vars: {
        ...DEFAULT_VARS.vars,
        backlog: { ...DEFAULT_VARS.vars.backlog, target_todo_depth: 3 },
        autonomy: { backlog_promotion: 'auto' },
      },
    };
    const withTodo = (todo_count: number) => ({
      ...vars,
      jobs: {
        strategize: { output: { groomed_board_summary: { todo_count } } },
      },
    });
    // Below the target depth → promote.
    expect(render(cond, withTodo(0))).toBe(true);
    expect(render(cond, withTodo(2))).toBe(true);
    // At/above the target depth → do not promote.
    expect(render(cond, withTodo(3))).toBe(false);
    expect(render(cond, withTodo(5))).toBe(false);
  });

  it('promote_safe_backlog only fires when backlog_promotion autonomy is auto', () => {
    const cond = jobsById().promote_safe_backlog.condition ?? '';
    const base = {
      vars: {
        ...DEFAULT_VARS.vars,
        backlog: { ...DEFAULT_VARS.vars.backlog, target_todo_depth: 3 },
      },
      jobs: {
        strategize: { output: { groomed_board_summary: { todo_count: 0 } } },
      },
    };
    expect(
      render(cond, {
        ...base,
        vars: { ...base.vars, autonomy: { backlog_promotion: 'auto' } },
      }),
    ).toBe(true);
    expect(
      render(cond, {
        ...base,
        vars: { ...base.vars, autonomy: { backlog_promotion: 'ask' } },
      }),
    ).toBe(false);
  });

  it('roadmap_planning_gate fires only when toggle is true and no active initiative', () => {
    const cond = jobsById().roadmap_planning_gate.condition ?? '';
    // toggle=true, no active initiative → fires
    expect(render(cond, staleness({ activeNowInitiativeCount: 0 }))).toBe(true);
    // toggle=true, active initiative exists → does not fire
    expect(render(cond, staleness({ activeNowInitiativeCount: 1 }))).toBe(
      false,
    );
    // toggle=false → never fires regardless
    const withToggleOff = {
      ...DEFAULT_VARS,
      vars: {
        ...DEFAULT_VARS.vars,
        gates: {
          ...DEFAULT_VARS.vars.gates,
          roadmap_when_no_active_initiative: false,
        },
      },
      jobs: {
        load_state: {
          output: {
            result: {
              strategic: { staleness: { activeNowInitiativeCount: 0 } },
            },
          },
        },
      },
    };
    expect(render(cond, withToggleOff)).toBe(false);
  });
});
