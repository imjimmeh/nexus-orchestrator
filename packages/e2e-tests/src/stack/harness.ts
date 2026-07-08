// packages/e2e-tests/src/stack/harness.ts
import type { Readable } from "node:stream";
import { createFakeLlmServer } from "../fake-llm/index.js";
import {
  startApi,
  startKanban,
  startPostgres,
  startRedis,
} from "./containers.js";
import { createTestNetwork } from "./network.js";
import { seedAdminUser, seedAnthropicProvider } from "./seed.js";
import type { StackContext } from "./types.js";

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    stream.on("error", reject);
  });
}

// Must be at least 32 chars to pass API validation (JWT_SECRET + SECRET_ENCRYPTION_KEY).
const JWT_SECRET = "nexus-e2e-secret-deterministic-testing-only";

export async function startStack(): Promise<StackContext> {
  // 1. Verify required images exist (fail loud before spending time on infra)
  await assertImagesExist(["nexus-api:latest", "nexus-kanban:latest"]);

  // 2. In-process fake LLM — starts instantly, gives us the port
  const fakeLlm = await createFakeLlmServer();
  const fakeLlmUrl = `http://host.docker.internal:${fakeLlm.port}/v1`;

  // 3. Docker network
  const network = await createTestNetwork();

  // 4. Postgres + Redis (parallel)
  const [postgres, _redis] = await Promise.all([
    startPostgres(network),
    startRedis(network),
  ]);

  // 5. Seed Anthropic provider into DB before API starts
  seedAnthropicProvider(postgres.hostConnectionString, fakeLlmUrl);

  // 6. API (needs DB + Redis up first)
  const api = await startApi({
    network,
    fakeLlmPort: fakeLlm.port,
    jwtSecret: JWT_SECRET,
    kanbanBaseUrl: "http://kanban:3012/api",
  });

  const apiHttpUrl = `http://localhost:${api.httpPort}`;

  // 7. Seed the e2e admin user in the DB (after API started, migrations have run)
  await seedAdminUser(postgres.hostConnectionString);

  // 8. Kanban (needs API up because it validates the core connection on start)
  const kanban = await startKanban({
    network,
    jwtSecret: JWT_SECRET,
    coreApiBaseUrl: "http://api:3000/api",
  });

  const kanbanHttpUrl = `http://localhost:${kanban.getMappedPort(3012)}`;

  return {
    fakeLlm,
    jwtSecret: JWT_SECRET,
    apiHttp: apiHttpUrl,
    apiWs: `ws://localhost:${api.wsPort}`,
    kanbanHttp: kanbanHttpUrl,
    networkName: network.name,
    async containerLogs() {
      const [apiLogs, kanbanLogs] = await Promise.all([
        api.container.logs(),
        kanban.logs(),
      ]);
      return {
        api: await streamToString(apiLogs),
        kanban: await streamToString(kanbanLogs),
      };
    },
    async stop() {
      await Promise.allSettled([
        api.container.stop(),
        kanban.stop(),
        postgres.container.stop(),
        _redis.stop(),
        fakeLlm.close(),
        network.stop(),
      ]);
    },
  };
}

async function assertImagesExist(images: string[]): Promise<void> {
  const { execSync } = await import("node:child_process");
  for (const image of images) {
    try {
      execSync(`docker image inspect ${image}`, { stdio: "pipe" });
    } catch {
      throw new Error(
        `Required Docker image not found: ${image}\n` +
          `Run: docker compose build ${image.replace(":latest", "")} (from repo root)`,
      );
    }
  }
}
