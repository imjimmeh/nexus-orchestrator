import type * as http from 'node:http';
import type Docker from 'dockerode';
import type { Server as SocketIOServer } from 'socket.io';
import type {
  FakeLlmServer,
  RecordedRequest,
} from '../../../../packages/e2e-tests/src/fake-llm/index.js';

export interface ApiCallbackLog {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
}

export interface ToolArraySerializationContext {
  fakeLlm: FakeLlmServer;
  wsServer: SocketIOServer;
  wsHttpServer: http.Server;
  wsPort: number;
  apiServer: http.Server;
  apiPort: number;
  docker: Docker;
  toolMountDir: string;
  containerId: string | null;
  apiCallbackLogs: ApiCallbackLog[];
}

export interface ContainerNetworkInfo {
  NetworkSettings: {
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
}

export interface ContainerExecutionResult {
  fakeLlmRequests: RecordedRequest[];
  apiCallbackLogs: ApiCallbackLog[];
  containerResponse: { ok: boolean; response: string; error?: string };
  containerLogs: string;
}
