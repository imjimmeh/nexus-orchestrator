// packages/e2e-tests/src/fake-llm/recorder.types.ts
import type { CanonicalRequest, Protocol, RecordedRequest } from "./types.js";

export interface RequestRecorder {
  record(request: CanonicalRequest): RecordedRequest;
  all(): RecordedRequest[];
  forProtocol(protocol: Protocol): RecordedRequest[];
  lastFor(protocol: Protocol): RecordedRequest | undefined;
  count(): number;
  reset(): void;
}
