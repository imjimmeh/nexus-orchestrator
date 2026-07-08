// packages/e2e-tests/src/fake-llm/server.types.ts
import type { RequestRecorder } from "./recorder.types.js";
import type { ScenarioBuilder } from "./scenario.js";
import type { RecordedRequest, Scenario } from "./types.js";

export interface FakeLlmServer {
  port: number;
  url: string;
  requests: RequestRecorder;
  loadScenario(scenario: Scenario | ScenarioBuilder): void;
  unmatched(): RecordedRequest[];
  reset(): void;
  close(): Promise<void>;
}
