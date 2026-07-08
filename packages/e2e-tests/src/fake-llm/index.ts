// packages/e2e-tests/src/fake-llm/index.ts
export {
  createFakeLlmServer,
  UNMATCHED_SENTINEL,
  type FakeLlmServer,
} from "./server.js";
export {
  scenario,
  text,
  toolCall,
  isText,
  isToolCall,
  ScenarioBuilder,
} from "./scenario.js";
export type {
  CanonicalRequest,
  CanonicalMessage,
  Protocol,
  RecordedRequest,
  Rule,
  RuleMatch,
  Scenario,
  TextTurn,
  ToolCallTurn,
  Turn,
} from "./types.js";
export type { RequestRecorder } from "./recorder.js";
