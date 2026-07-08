import { isHarnessRuntimeConfig } from '@nexus/core';

export async function handleTelemetryPostAuthConnection(params: {
  client: {
    workflowRunId?: string;
    streamId?: string;
    stepId?: string;
    role?: 'agent' | 'ui';
    isSubagent?: boolean;
    containerId?: string;
    providerName?: string;
    modelName?: string;
    join: (room: string) => void | Promise<void>;
    emit: (event: string, payload: unknown) => void;
    pubsubCallback?: (eventStr: string) => void;
  };
  processAndBroadcastEvent: (
    workflowRunId: string,
    event: { event_type: string; payload: Record<string, unknown> },
  ) => Promise<void>;
  getRunnerConfig: (workflowRunId: string, stepId: string) => Promise<unknown>;
  subscribeUiChannel: (
    workflowRunId: string,
    callback: (eventStr: string) => void,
  ) => Promise<void>;
  getEventHistory: (workflowRunId: string) => Promise<unknown>;
}): Promise<void> {
  const { client } = params;
  const streamId = client.streamId ?? client.workflowRunId;

  if (streamId) {
    await client.join(streamId);
  }

  if (client.role === 'agent' && client.workflowRunId && client.stepId) {
    const configPayload = await params.getRunnerConfig(
      client.workflowRunId,
      client.stepId,
    );
    if (configPayload) {
      if (isHarnessRuntimeConfig(configPayload)) {
        client.providerName = configPayload.model.provider;
        client.modelName = configPayload.model.model;
      }
      client.emit('configure', configPayload);
    }

    if (!client.isSubagent) {
      await params.processAndBroadcastEvent(client.workflowRunId, {
        event_type: 'agent_runtime_ready',
        payload: {
          workflowRunId: client.workflowRunId,
          stepId: client.stepId,
          containerId: client.containerId,
        },
      });
    }
  }

  if (client.role === 'ui' && client.workflowRunId) {
    await client.join('/ui/assistant');
    const workflowRunId = streamId ?? client.workflowRunId;
    const callback = (eventStr: string) => {
      client.emit('event', JSON.parse(eventStr));
    };

    client.pubsubCallback = callback;
    await params.subscribeUiChannel(workflowRunId, callback);
    const history = await params.getEventHistory(workflowRunId);
    client.emit('replay', history);
  }
}
