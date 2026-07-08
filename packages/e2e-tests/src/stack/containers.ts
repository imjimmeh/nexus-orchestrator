// packages/e2e-tests/src/stack/containers.ts
export type {
  StartedPostgres,
  StartedApi,
  ApiContainerOptions,
  KanbanContainerOptions,
} from "./containers.types.js";
import type {
  StartedPostgres,
  StartedApi,
  ApiContainerOptions,
  KanbanContainerOptions,
} from "./containers.types.js";
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import type { ManagedNetwork } from "./network.js";

// Fixed host port for the e2e postgres container.
// A random port is avoided because Windows Hyper-V reserves large dynamic
// port ranges (54000–60000+), causing testcontainers port mappings to land
// in excluded ranges where connections time out. This port is outside all
// known Hyper-V exclusion ranges.
const E2E_POSTGRES_HOST_PORT = 25432;

export async function startPostgres(
  network: ManagedNetwork,
): Promise<StartedPostgres> {
  const container = await new GenericContainer("pgvector/pgvector:0.8.3-pg18")
    .withNetwork(network.startedNetwork)
    .withNetworkAliases("postgres")
    .withEnvironment({
      POSTGRES_USER: "nexus",
      POSTGRES_PASSWORD: "nexus_password",
      POSTGRES_DB: "nexus_orchestrator",
    })
    .withExposedPorts({ container: 5432, host: E2E_POSTGRES_HOST_PORT })
    .withHealthCheck({
      test: ["CMD-SHELL", "pg_isready -U nexus -d nexus_orchestrator"],
      interval: 5_000,
      timeout: 5_000,
      retries: 10,
      startPeriod: 5_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  return {
    container,
    hostConnectionString: `postgresql://nexus:nexus_password@localhost:${E2E_POSTGRES_HOST_PORT}/nexus_orchestrator`,
  };
}

export async function startRedis(
  network: ManagedNetwork,
): Promise<StartedTestContainer> {
  return new GenericContainer("redis:7-alpine")
    .withNetwork(network.startedNetwork)
    .withNetworkAliases("redis")
    .withExposedPorts(6379)
    .withHealthCheck({
      test: ["CMD", "redis-cli", "ping"],
      interval: 5_000,
      timeout: 5_000,
      retries: 10,
      startPeriod: 2_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
}

export async function startApi(
  options: ApiContainerOptions,
): Promise<StartedApi> {
  const { network, fakeLlmPort, jwtSecret, kanbanBaseUrl } = options;
  const fakeLlmUrl = `http://host.docker.internal:${fakeLlmPort}/v1`;

  const container = await new GenericContainer("nexus-api:latest")
    .withNetwork(network.startedNetwork)
    .withNetworkAliases("api")
    .withExposedPorts(3000, 3001)
    .withBindMounts([
      { source: "/var/run/docker.sock", target: "/var/run/docker.sock" },
    ])
    .withEnvironment({
      PORT: "3000",
      NODE_ENV: "test",
      NODE_OPTIONS: "--max-old-space-size=4096",
      LOG_LEVEL: "warn",
      DB_HOST: "postgres",
      DB_PORT: "5432",
      DB_USERNAME: "nexus",
      DB_PASSWORD: "nexus_password",
      DB_DATABASE: "nexus_orchestrator",
      REDIS_HOST: "redis",
      REDIS_PORT: "6379",
      BULLMQ_QUEUE_NAME: "bull:workflow_steps",
      DOCKER_SOCKET_PATH: "/var/run/docker.sock",
      JWT_SECRET: jwtSecret,
      WEBSOCKET_URL: "http://api:3001",
      CONTEXT_DISPATCH_BASE_URL: kanbanBaseUrl,
      NEXUS_DOCKER_NETWORK: network.name,
      NEXUS_WORKSPACE_BASE_PATH: "/data/nexus-workspaces",
      SECRET_ENCRYPTION_KEY: "nexus-e2e-secret-deterministic-testing-only",
      SEED_LLM_SECRET_FROM_ENV: "true",
      // Seed the OpenAI-compatible provider pointing at the fake LLM
      E2E_PROVIDER_NAME: "fake-openai",
      E2E_PROVIDER_BASE_URL: fakeLlmUrl,
      E2E_PROVIDER_API_KEY: "fake-key",
      MEMORY_BACKEND: "postgres",
      HONCHO_FALLBACK_ON_ERROR: "true",
      HONCHO_FALLBACK_ON_EMPTY: "true",
      CORS_ORIGIN: "*",
      ORCHESTRATION_AUTO_RESTART_COOLDOWN_SECONDS: "9999",
    })
    .withHealthCheck({
      test: [
        "CMD",
        "node",
        "-e",
        "const req=require('http').get('http://127.0.0.1:3000/api/health',(res)=>process.exit(res.statusCode===200?0:1));req.setTimeout(10000,()=>{req.destroy();process.exit(1)});req.on('error',()=>process.exit(1))",
      ],
      interval: 10_000,
      timeout: 15_000,
      retries: 12,
      startPeriod: 60_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();

  return {
    container,
    httpPort: container.getMappedPort(3000),
    wsPort: container.getMappedPort(3001),
  };
}

export async function startKanban(
  options: KanbanContainerOptions,
): Promise<StartedTestContainer> {
  const { network, jwtSecret, coreApiBaseUrl } = options;

  return new GenericContainer("nexus-kanban:latest")
    .withNetwork(network.startedNetwork)
    .withNetworkAliases("kanban")
    .withExposedPorts(3012)
    .withEnvironment({
      KANBAN_PORT: "3012",
      NODE_ENV: "test",
      DB_HOST: "postgres",
      DB_PORT: "5432",
      DB_USERNAME: "nexus",
      DB_PASSWORD: "nexus_password",
      DB_DATABASE: "nexus_orchestrator",
      REDIS_HOST: "redis",
      REDIS_PORT: "6379",
      KANBAN_CORE_BASE_URL: coreApiBaseUrl,
      KANBAN_SERVICE_BASE_URL: "http://kanban:3012/api",
      KANBAN_SERVICE_BEARER_TOKEN: "nexus-kanban-internal-token",
      KANBAN_SERVICE_JWT_AUDIENCE: "nexus-kanban-service",
      KANBAN_SERVICE_JWT_ISSUER: "nexus-api",
      KANBAN_CORE_JWT_AUDIENCE: "nexus-core-internal",
      KANBAN_CORE_JWT_ISSUER: "nexus-kanban",
      JWT_SECRET: jwtSecret,
      NEXUS_WORKSPACE_BASE_PATH: "/data/nexus-workspaces",
    })
    .withHealthCheck({
      test: [
        "CMD",
        "node",
        "-e",
        "require('http').get('http://127.0.0.1:3012/api/health',(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))",
      ],
      interval: 10_000,
      timeout: 5_000,
      retries: 6,
      startPeriod: 20_000,
    })
    .withWaitStrategy(Wait.forHealthCheck())
    .start();
}
