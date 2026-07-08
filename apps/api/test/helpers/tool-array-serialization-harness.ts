import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import Docker from 'dockerode';
import jwt from 'jsonwebtoken';
import { Server as SocketIOServer } from 'socket.io';
import {
  createFakeLlmServer,
  scenario,
  toolCall,
} from '../../../../packages/e2e-tests/src/fake-llm/index.js';
import { writeToolMountFiles } from './tool-array-serialization-mounts.js';
import type {
  ApiCallbackLog,
  ContainerExecutionResult,
  ContainerNetworkInfo,
  ToolArraySerializationContext,
} from './tool-array-serialization-harness.types.js';

export type {
  ApiCallbackLog,
  ToolArraySerializationContext,
} from './tool-array-serialization-harness.types.js';

const JWT_SECRET = 'test-jwt-secret-for-e2e-array-serialization';
const RUNNER_IMAGE = 'nexus-heavy:latest';
const CONTAINER_PORT = 8374;
const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const STEP_EXECUTION_TIMEOUT_MS = 120_000;
const HEALTH_CHECK_INTERVAL_MS = 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForContainerHealth(
  host: string,
  port: number,
  timeoutMs = HEALTH_CHECK_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      void error;
    }
    await wait(HEALTH_CHECK_INTERVAL_MS);
  }
  throw new Error(
    `Container health check timed out after ${timeoutMs}ms at ${host}:${port}`,
  );
}

function createAgentJwt(payload: {
  workflowRunId: string;
  jobId: string;
  stepId: string;
}): string {
  return jwt.sign(
    {
      sub: `agent:${payload.workflowRunId}:${payload.jobId}`,
      workflowRunId: payload.workflowRunId,
      role: 'agent',
      stepId: payload.stepId,
      jobId: payload.jobId,
      roles: ['Agent'],
    },
    JWT_SECRET,
    { expiresIn: '2h' },
  );
}

function parseJsonOrRaw(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch (error) {
    void error;
    return rawBody;
  }
}

function normalizeHeaders(
  headers: http.IncomingHttpHeaders,
): Record<string, string> {
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      requestHeaders[key] = value;
    } else if (Array.isArray(value)) {
      requestHeaders[key] = value.join(', ');
    }
  }
  return requestHeaders;
}

function writeJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const responseBody = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(responseBody),
  });
  res.end(responseBody);
}

function handleApiCallback(
  callbackLogs: ApiCallbackLog[],
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawBody: string,
  parsedBody: unknown,
): boolean {
  if (
    req.url !== '/api/workflow-runtime/manage-todo-list' ||
    req.method !== 'POST'
  ) {
    return false;
  }

  callbackLogs.push({
    method: req.method,
    url: req.url,
    headers: normalizeHeaders(req.headers),
    body: parsedBody,
    rawBody,
  });

  const body = parsedBody as Record<string, unknown>;
  const itemCount = Array.isArray(body.todoList)
    ? body.todoList.length
    : Array.isArray(body.todo_list)
      ? body.todo_list.length
      : 0;

  writeJson(res, 200, {
    success: true,
    data: {
      ok: true,
      action: 'manage_todo_list_completed',
      items_received: itemCount,
    },
  });
  return true;
}

function handlePermissionCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): boolean {
  if (
    req.url !== '/api/workflow-runtime/check-permission' ||
    req.method !== 'POST'
  ) {
    return false;
  }
  writeJson(res, 200, { success: true, data: { status: 'allow' } });
  return true;
}

export function createMockHttpServer(
  callbackLogs: ApiCallbackLog[],
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf-8');
        const parsedBody = parseJsonOrRaw(rawBody);
        if (handleApiCallback(callbackLogs, req, res, rawBody, parsedBody)) {
          return;
        }
        if (handlePermissionCallback(req, res)) {
          return;
        }
        writeJson(res, 404, { error: 'Not found' });
      });
    });

    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

export async function createToolArraySerializationContext(): Promise<ToolArraySerializationContext | null> {
  const docker = new Docker();
  try {
    await docker.ping();
  } catch (error) {
    void error;
    console.warn(
      'Docker not available - skipping tool array serialization E2E tests',
    );
    return null;
  }

  const fakeLlm = await createFakeLlmServer();
  const apiCallbackLogs: ApiCallbackLog[] = [];
  const { server: apiServer, port: apiPort } =
    await createMockHttpServer(apiCallbackLogs);
  const { server: wsHttpServer, port: wsPort } = await createMockHttpServer([]);
  const wsServer = new SocketIOServer(wsHttpServer, {
    path: '/socket.io',
    cors: { origin: '*' },
  });
  const toolMountDir = path.join(os.tmpdir(), `nexus-test-tools-${Date.now()}`);
  writeToolMountFiles(toolMountDir);

  return {
    fakeLlm,
    wsServer,
    wsHttpServer,
    wsPort,
    apiServer,
    apiPort,
    docker,
    toolMountDir,
    containerId: null,
    apiCallbackLogs,
  };
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

async function removeContainer(
  ctx: ToolArraySerializationContext,
): Promise<void> {
  if (!ctx.containerId) {
    return;
  }
  try {
    const container = ctx.docker.getContainer(ctx.containerId);
    await container.stop({ t: 5 }).catch((error: unknown) => {
      void error;
    });
    await container.remove({ force: true }).catch((error: unknown) => {
      void error;
    });
  } catch (error) {
    void error;
  } finally {
    ctx.containerId = null;
  }
}

export async function disposeToolArraySerializationContext(
  ctx: ToolArraySerializationContext | null,
): Promise<void> {
  if (!ctx) {
    return;
  }
  await removeContainer(ctx);
  if (fs.existsSync(ctx.toolMountDir)) {
    fs.rmSync(ctx.toolMountDir, { recursive: true, force: true });
  }
  await ctx.fakeLlm.close().catch((error: unknown) => {
    void error;
  });
  await ctx.wsServer.close();
  await closeServer(ctx.wsHttpServer);
  await closeServer(ctx.apiServer);
}

function createContainerEnv(params: {
  agentJwt: string;
  workflowRunId: string;
  jobId: string;
  stepId: string;
  wsPort: number;
  apiPort: number;
}): string[] {
  return [
    `AGENT_JWT=${params.agentJwt}`,
    `WORKFLOW_RUN_ID=${params.workflowRunId}`,
    `JOB_ID=${params.jobId}`,
    `STEP_ID=${params.stepId}`,
    `WEBSOCKET_URL=http://host.docker.internal:${params.wsPort}`,
    `API_BASE_URL=http://host.docker.internal:${params.apiPort}`,
    'WORKSPACE_PATH=/workspace',
    'NEXUS_RUNNER_DISABLE_GOVERNANCE_CHECK=true',
  ];
}

async function createRunnerContainer(
  ctx: ToolArraySerializationContext,
  workflowRunId: string,
  jobId: string,
  stepId: string,
) {
  const agentJwt = createAgentJwt({ workflowRunId, jobId, stepId });
  return ctx.docker.createContainer({
    Image: RUNNER_IMAGE,
    Env: createContainerEnv({
      agentJwt,
      workflowRunId,
      jobId,
      stepId,
      wsPort: ctx.wsPort,
      apiPort: ctx.apiPort,
    }),
    HostConfig: {
      Binds: [`${ctx.toolMountDir}:/opt/pi-runner/extensions:ro`],
      ExtraHosts: ['host.docker.internal:host-gateway'],
      PortBindings: { [`${CONTAINER_PORT}/tcp`]: [{ HostPort: '0' }] },
    },
    ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
    Labels: { 'nexus.e2e-test': 'true', 'nexus.test-run-id': workflowRunId },
  });
}

async function resolveContainerEndpoint(container: Docker.Container): Promise<{
  hostIp: string;
  hostPort: number;
}> {
  const containerInfo =
    (await container.inspect()) as unknown as ContainerNetworkInfo;
  const portBindings =
    containerInfo.NetworkSettings.Ports[`${CONTAINER_PORT}/tcp`];
  const firstBinding = portBindings?.[0];
  if (!firstBinding) {
    throw new Error('Container port not mapped');
  }
  return {
    hostIp: firstBinding.HostIp || '127.0.0.1',
    hostPort: Number.parseInt(firstBinding.HostPort, 10),
  };
}

function createExecutePayload(
  ctx: ToolArraySerializationContext,
  stepId: string,
): string {
  return JSON.stringify({
    provider: 'openai',
    model: 'fake-model',
    apiKey: 'fake-api-key',
    baseUrl: `http://host.docker.internal:${ctx.fakeLlm.port}/v1`,
    systemPrompt:
      'You are a test assistant. Call the manage_todo_list tool with the provided arguments.',
    initialPrompt: 'Call the manage_todo_list tool now.',
    temperature: 0,
    thinkingLevel: 'off',
    stepId,
  });
}

async function executeAgentStep(
  hostIp: string,
  hostPort: number,
  executePayload: string,
): Promise<{ ok: boolean; response: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Step execution timed out'));
    }, STEP_EXECUTION_TIMEOUT_MS);
    const req = http.request(
      {
        hostname: hostIp === '0.0.0.0' ? '127.0.0.1' : hostIp,
        port: hostPort,
        path: '/execute/agent',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(executePayload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          clearTimeout(timeout);
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(
            parseJsonOrRaw(raw) as {
              ok: boolean;
              response: string;
              error?: string;
            },
          );
        });
      },
    );
    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    req.write(executePayload);
    req.end();
  });
}

function stripDockerLogControlBytes(logs: Buffer): string {
  const filtered = [...logs].filter(
    (byte) => byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d,
  );
  return Buffer.from(filtered).toString('utf-8');
}

async function readContainerLogs(container: Docker.Container): Promise<string> {
  try {
    const logsStream = await container.logs({ stdout: true, stderr: true });
    return stripDockerLogControlBytes(logsStream);
  } catch (error) {
    void error;
    return '';
  }
}

export async function spawnContainerAndExecute(
  ctx: ToolArraySerializationContext,
  fakeLlmToolCallArgs: Record<string, unknown>,
): Promise<ContainerExecutionResult> {
  ctx.apiCallbackLogs.length = 0;
  const fakeLlmRequestCountBefore = ctx.fakeLlm.requests.count();
  const workflowRunId = `e2e-test-${Date.now()}`;
  const jobId = `job-${Date.now()}`;
  const stepId = `step-${Date.now()}`;

  ctx.fakeLlm.loadScenario(
    scenario('tool-array-serialization').otherwise(
      toolCall('manage_todo_list', fakeLlmToolCallArgs),
    ),
  );

  const container = await createRunnerContainer(
    ctx,
    workflowRunId,
    jobId,
    stepId,
  );
  ctx.containerId = container.id;
  await container.start();

  const { hostIp, hostPort } = await resolveContainerEndpoint(container);
  await waitForContainerHealth(hostIp, hostPort);
  const containerResponse = await executeAgentStep(
    hostIp,
    hostPort,
    createExecutePayload(ctx, stepId),
  );
  const containerLogs = await readContainerLogs(container);
  const fakeLlmRequests = ctx.fakeLlm.requests
    .all()
    .slice(fakeLlmRequestCountBefore);
  await removeContainer(ctx);

  return {
    fakeLlmRequests,
    apiCallbackLogs: [...ctx.apiCallbackLogs],
    containerResponse,
    containerLogs,
  };
}
