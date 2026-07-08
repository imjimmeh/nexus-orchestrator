// packages/e2e-tests/src/scenarios/setup/global-setup.ts
import * as http from "node:http";
import { startStack } from "../../stack/harness.js";
import type { FakeLlmServer, Scenario } from "../../fake-llm/index.js";
import { writeStackContext } from "./stack-context-file.js";

/**
 * Start a tiny HTTP control server that exposes POST /scenario so that test
 * workers (which cannot share the FakeLlmServer instance across the globalSetup
 * process boundary) can load per-test scenarios into the fake LLM at runtime.
 *
 * The server listens on fakeLlmPort + 1 and is torn down alongside the stack.
 */
function startControlServer(
  fakeLlm: FakeLlmServer,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    (() => {
      if (req.method === "POST" && req.url === "/scenario") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          try {
            const body = JSON.parse(
              Buffer.concat(chunks).toString("utf-8"),
            ) as Partial<Scenario>;
            const scenarioObj: Scenario = {
              name: body.name ?? "test-scenario",
              rules: body.rules ?? [],
            };
            fakeLlm.loadScenario(scenarioObj);
            const payload = JSON.stringify({ ok: true });
            res.writeHead(200, {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(payload)),
            });
            res.end(payload);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const payload = JSON.stringify({ ok: false, error: message });
            res.writeHead(400, {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(payload)),
            });
            res.end(payload);
          }
        });
        return;
      }

      if (req.method === "POST" && req.url === "/reset") {
        fakeLlm.reset();
        const payload = JSON.stringify({ ok: true });
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    })();
  });

  return new Promise((resolve, reject) => {
    // Bind to fakeLlmPort + 1 (a predictable adjacent port)
    const controlPort = fakeLlm.port + 1;
    server.listen(controlPort, "127.0.0.1", () => {
      resolve({
        port: controlPort,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => {
              if (err) {
                rej(err);
              } else {
                res();
              }
            }),
          ),
      });
    });
    server.on("error", reject);
  });
}

// Vitest globalSetup: runs once before all spec workers.
// Return value is passed to globalTeardown as the teardown token.
export default async function setup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  const controlServer = await startControlServer(stack.fakeLlm);

  writeStackContext({
    apiHttp: stack.apiHttp,
    apiWs: stack.apiWs,
    kanbanHttp: stack.kanbanHttp,
    networkName: stack.networkName,
    jwtSecret: stack.jwtSecret,
    fakeLlmPort: stack.fakeLlm.port,
    fakeLlmControlPort: controlServer.port,
  });

  return async () => {
    await controlServer.close();
    await stack.stop();
  };
}
