// packages/e2e-tests/src/fake-llm/server.ts
export type { FakeLlmServer } from "./server.types.js";
import type { FakeLlmServer } from "./server.types.js";
import * as http from "node:http";
import { selectResponse } from "./matcher.js";
import { parseAnthropicRequest } from "./protocols/anthropic-parse.js";
import {
  serializeAnthropicResponse,
  serializeAnthropicSse,
} from "./protocols/anthropic-serialize.js";
import { parseOpenAiRequest } from "./protocols/openai-parse.js";
import {
  serializeOpenAiResponse,
  serializeOpenAiSse,
} from "./protocols/openai-serialize.js";
import { createRequestRecorder, type RequestRecorder } from "./recorder.js";
import { text, toScenario } from "./scenario.js";
import type {
  CanonicalRequest,
  RecordedRequest,
  Scenario,
  Turn,
} from "./types.js";

export const UNMATCHED_SENTINEL = "__FAKE_LLM_NO_MATCHING_RULE__";

interface ServerState {
  scenario: Scenario;
  recorder: RequestRecorder;
  unmatched: RecordedRequest[];
  seed: number;
}

function collectHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers[key] = value;
    else if (Array.isArray(value)) headers[key] = value.join(", ");
  }
  return headers;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        resolve(raw);
      }
    });
  });
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendSse(res: http.ServerResponse, payload: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.end(payload);
}

function resolveTurns(state: ServerState, recorded: RecordedRequest): Turn[] {
  const turns = selectResponse(state.scenario, recorded, recorded.index);
  if (turns === null) {
    state.unmatched.push(recorded);
    return [text(UNMATCHED_SENTINEL)];
  }
  return turns;
}

function handleCompletion(
  state: ServerState,
  parsed: CanonicalRequest,
  res: http.ServerResponse,
): void {
  const recorded = state.recorder.record(parsed);
  const turns = resolveTurns(state, recorded);
  const seed = (state.seed += 1);

  if (parsed.protocol === "openai") {
    if (parsed.stream)
      sendSse(res, serializeOpenAiSse(turns, parsed.model, seed));
    else sendJson(res, 200, serializeOpenAiResponse(turns, parsed.model, seed));
    return;
  }
  if (parsed.stream)
    sendSse(res, serializeAnthropicSse(turns, parsed.model, seed));
  else
    sendJson(res, 200, serializeAnthropicResponse(turns, parsed.model, seed));
}

export function createFakeLlmServer(): Promise<FakeLlmServer> {
  const state: ServerState = {
    scenario: { name: "empty", rules: [] },
    recorder: createRequestRecorder(),
    unmatched: [],
    seed: 0,
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const headers = collectHeaders(req);
      if (req.method === "GET" && req.url === "/v1/models") {
        sendJson(res, 200, {
          object: "list",
          data: [{ id: "fake-model", object: "model", owned_by: "test" }],
        });
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        handleCompletion(
          state,
          parseOpenAiRequest(await readBody(req), headers),
          res,
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/messages") {
        handleCompletion(
          state,
          parseAnthropicRequest(await readBody(req), headers),
          res,
        );
        return;
      }
      sendJson(res, 404, { error: "not found" });
    })();
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to resolve fake LLM server address"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        requests: state.recorder,
        loadScenario(next) {
          state.scenario = toScenario(next);
        },
        unmatched() {
          return [...state.unmatched];
        },
        reset() {
          state.recorder.reset();
          state.unmatched = [];
          state.seed = 0;
        },
        close() {
          return new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
              } else {
                resolveClose();
              }
            });
          });
        },
      });
    });
  });
}
