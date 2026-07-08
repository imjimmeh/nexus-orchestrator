import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { GATEWAY_OPTIONS, PORT_METADATA } from '@nestjs/websockets/constants';
import { io, Socket } from 'socket.io-client';
import * as jwt from 'jsonwebtoken';
import { AppEventsGateway } from './app-events.gateway';
import { TELEMETRY_GATEWAY_PORT } from '../telemetry/types';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';

const TEST_JWT_SECRET = 'test-secret';
const makeToken = () =>
  jwt.sign({ userId: 'user-1', sub: 'user-1' }, TEST_JWT_SECRET, {
    expiresIn: '1h',
  });

describe('AppEventsGateway (integration)', () => {
  let app: INestApplication;
  let eventEmitter: EventEmitter2;

  beforeAll(async () => {
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [AppEventsGateway],
    }).compile();

    app = module.createNestApplication();
    await app.listen(0);
    eventEmitter = module.get(EventEmitter2);
  });

  afterAll(() => app.close());

  it('registers /app-events on the shared telemetry websocket port', () => {
    expect(
      Reflect.getMetadata(GATEWAY_OPTIONS, AppEventsGateway)?.namespace,
    ).toBe('/app-events');
    expect(Reflect.getMetadata(PORT_METADATA, AppEventsGateway)).toBe(
      TELEMETRY_GATEWAY_PORT,
    );
  });

  function connect(token?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = io(`http://localhost:${TELEMETRY_GATEWAY_PORT}/app-events`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
      });
      s.on('connect', () => {
        resolve(s);
      });
      s.on('connect_error', reject);
      setTimeout(() => {
        reject(new Error('connect timeout'));
      }, 3000);
    });
  }

  it('rejects connections with an invalid JWT', () => {
    return new Promise<void>((resolve) => {
      const s = io(`http://localhost:${TELEMETRY_GATEWAY_PORT}/app-events`, {
        auth: { token: 'invalid-token' },
        transports: ['websocket'],
      });
      s.on('disconnect', () => {
        s.close();
        resolve();
      });
      s.on('connect_error', () => {
        s.close();
        resolve();
      });
    });
  });

  it('accepts connections with a valid JWT', async () => {
    const client = await connect(makeToken());
    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it('broadcasts run:lifecycle when workflow.run.started fires', async () => {
    const client = await connect(makeToken());
    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      const event: WorkflowRunEvent = {
        workflowRunId: 'run-abc',
        workflowId: 'wf-1',
        status: 'RUNNING',
        stateVariables: {},
      };
      eventEmitter.emit(WORKFLOW_RUN_STARTED_EVENT, event);
    });
    expect(received).toMatchObject({
      workflowRunId: 'run-abc',
      status: 'RUNNING',
    });
    client.disconnect();
  });

  it('broadcasts run:lifecycle when workflow.run.completed fires', async () => {
    const client = await connect(makeToken());
    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      eventEmitter.emit(WORKFLOW_RUN_COMPLETED_EVENT, {
        workflowRunId: 'run-xyz',
        workflowId: 'wf-2',
        status: 'COMPLETED',
        stateVariables: {},
      });
    });
    expect(received).toMatchObject({
      workflowRunId: 'run-xyz',
      status: 'COMPLETED',
    });
    client.disconnect();
  });

  it('broadcasts run:lifecycle when workflow.run.failed fires', async () => {
    const client = await connect(makeToken());
    const received = await new Promise<unknown>((resolve) => {
      client.on('run:lifecycle', resolve);
      eventEmitter.emit(WORKFLOW_RUN_FAILED_EVENT, {
        workflowRunId: 'run-fail',
        workflowId: 'wf-3',
        status: 'FAILED',
        stateVariables: {},
      });
    });
    expect(received).toMatchObject({ status: 'FAILED' });
    client.disconnect();
  });
});
