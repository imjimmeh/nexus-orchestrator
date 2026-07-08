// packages/e2e-tests/src/fake-llm/scenario.ts
export type { RuleBuilder } from "./scenario.types.js";
import type { RuleBuilder } from "./scenario.types.js";
import type {
  Rule,
  RuleMatch,
  Scenario,
  TextTurn,
  ToolCallTurn,
  Turn,
} from "./types.js";

export function text(value: string): TextTurn {
  return { kind: "text", text: value };
}

export function toolCall(
  name: string,
  args: Record<string, unknown>,
): ToolCallTurn {
  return { kind: "tool_call", toolName: name, arguments: args };
}

export function isText(turn: Turn): turn is TextTurn {
  return turn.kind === "text";
}

export function isToolCall(turn: Turn): turn is ToolCallTurn {
  return turn.kind === "tool_call";
}

export class ScenarioBuilder {
  private readonly rules: Rule[] = [];

  constructor(private readonly scenarioName: string) {}

  when(match: RuleMatch): RuleBuilder {
    return {
      reply: (...turns: Turn[]): ScenarioBuilder => {
        this.rules.push({ match, respond: turns });
        return this;
      },
    };
  }

  whenTool(name: string): RuleBuilder {
    return this.when({ hasTool: name });
  }

  otherwise(...turns: Turn[]): this {
    this.rules.push({ match: {}, respond: turns });
    return this;
  }

  build(): Scenario {
    return { name: this.scenarioName, rules: [...this.rules] };
  }
}

export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name);
}

export function toScenario(value: Scenario | ScenarioBuilder): Scenario {
  return value instanceof ScenarioBuilder ? value.build() : value;
}
