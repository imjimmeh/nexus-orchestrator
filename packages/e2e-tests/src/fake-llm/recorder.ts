// packages/e2e-tests/src/fake-llm/recorder.ts
export type { RequestRecorder } from "./recorder.types.js";
import type { RequestRecorder } from "./recorder.types.js";
import type { RecordedRequest } from "./types.js";

export function createRequestRecorder(): RequestRecorder {
  let requests: RecordedRequest[] = [];
  return {
    record(request) {
      const recorded: RecordedRequest = { ...request, index: requests.length };
      requests.push(recorded);
      return recorded;
    },
    all() {
      return [...requests];
    },
    forProtocol(protocol) {
      return requests.filter((entry) => entry.protocol === protocol);
    },
    lastFor(protocol) {
      const filtered = requests.filter((entry) => entry.protocol === protocol);
      return filtered[filtered.length - 1];
    },
    count() {
      return requests.length;
    },
    reset() {
      requests = [];
    },
  };
}
