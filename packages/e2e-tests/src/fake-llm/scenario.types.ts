// packages/e2e-tests/src/fake-llm/scenario.types.ts
import type { ScenarioBuilder } from "./scenario.js";
import type { Turn } from "./types.js";

export interface RuleBuilder {
  reply(...turns: Turn[]): ScenarioBuilder;
}
