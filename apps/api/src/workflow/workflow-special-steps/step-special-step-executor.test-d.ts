import { expectTypeOf, test } from 'vitest';
import type { IJob } from '@nexus/core';
import type { StepSpecialStepExecutorService } from './step-special-step-executor.service';

test('accepts normalized jobs at the special-step execution boundary', () => {
  type ExecuteSpecialStepArgs = Parameters<
    StepSpecialStepExecutorService['executeSpecialStep']
  >;

  expectTypeOf<ExecuteSpecialStepArgs[2]>().toEqualTypeOf<IJob>();
});
