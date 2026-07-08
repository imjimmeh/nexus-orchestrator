/**
 * WebSocket client for communication with the Nexus orchestrator.
 *
 * Handles:
 * - Authenticated connection to the telemetry gateway
 * - Waiting for the `configure` handshake (model, API key, prompt, etc.)
 * - Forwarding telemetry events from the agent session
 * - Receiving orchestrator commands (`dehydrate`, `abort`)
 */

import { io, type Socket } from "socket.io-client";
import type { HarnessRuntimeConfig } from "@nexus/core";
import type {
  OrchestratorCommand,
  CommandPayload,
  CommandHandler,
  OrchestratorClient,
  WaitForCommandOptions,
} from "./orchestrator-client.types.js";

export type {
  OrchestratorCommand,
  QuestionAnswer,
  CommandPayload,
  CommandHandler,
  OrchestratorClient,
} from "./orchestrator-client.types.js";

const CONFIG_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 30_000;

type CommandRegistry = {
  handlers: Map<OrchestratorCommand, CommandHandler>;
  pending: Map<OrchestratorCommand, CommandPayload[]>;
  waiters: Map<OrchestratorCommand, WaiterEntry[]>;
};

type WaiterEntry = {
  match: (payload: CommandPayload) => boolean;
  resolve: (payload: CommandPayload) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};

const ORCHESTRATOR_COMMANDS = new Set<OrchestratorCommand>([
  "dehydrate",
  "abort",
  "prompt",
  "question_response",
  "step_complete_result",
  "spawn_subagent_async_result",
  "wait_for_subagents_result",
  "check_subagent_status_result",
  "open_war_room_result",
  "invite_war_room_participant_result",
  "post_war_room_message_result",
  "update_war_room_blackboard_result",
  "submit_war_room_signoff_result",
  "get_war_room_state_result",
  "close_war_room_result",
]);

const DIRECT_COMMAND_EVENT_TYPES: readonly OrchestratorCommand[] = [
  "step_complete_result",
  "spawn_subagent_async_result",
  "wait_for_subagents_result",
  "check_subagent_status_result",
];

function isOrchestratorCommand(value: unknown): value is OrchestratorCommand {
  return ORCHESTRATOR_COMMANDS.has(value as OrchestratorCommand);
}

function enqueueCommand(
  registry: CommandRegistry,
  command: OrchestratorCommand,
  payload: CommandPayload,
): void {
  const queued = registry.pending.get(command) ?? [];
  queued.push(payload);
  registry.pending.set(command, queued);
}

function dispatchIncomingCommand(
  registry: CommandRegistry,
  payload: CommandPayload,
): void {
  const commandType = payload.type;
  if (!isOrchestratorCommand(commandType)) {
    return;
  }

  const waiters = registry.waiters.get(commandType);
  if (waiters && waiters.length > 0) {
    const waiterIndex = waiters.findIndex((entry) => entry.match(payload));
    if (waiterIndex >= 0) {
      const waiter = waiters[waiterIndex];
      waiters.splice(waiterIndex, 1);
      if (waiters.length === 0) {
        registry.waiters.delete(commandType);
      }
      if (waiter.timer) {
        clearTimeout(waiter.timer);
      }
      waiter.resolve(payload);
      return;
    }
  }

  const handler = registry.handlers.get(commandType);
  if (handler) {
    void handler(payload);
    return;
  }

  enqueueCommand(registry, commandType, payload);
}

function wireSocketListeners(
  socket: Socket,
  registry: CommandRegistry,
  setConfig: (payload: HarnessRuntimeConfig) => void,
): void {
  socket.on("configure", (payload: HarnessRuntimeConfig) => {
    setConfig(payload);
  });

  socket.on("command", (payload: CommandPayload) => {
    dispatchIncomingCommand(registry, payload);
  });

  for (const eventType of DIRECT_COMMAND_EVENT_TYPES) {
    socket.on(eventType, (payload: unknown) => {
      const record =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {};

      dispatchIncomingCommand(registry, {
        ...record,
        type: eventType,
      } as CommandPayload);
    });
  }
}

function connectSocket(socket: Socket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onConnect = (): void => {
      cleanup();
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(new Error(`WebSocket connection failed: ${error.message}`));
    };

    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onError);
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onError);
  });
}

function waitForSocketConfig(
  socket: Socket | null,
  cachedConfig: HarnessRuntimeConfig | null,
  setCachedConfig: (payload: HarnessRuntimeConfig) => void,
): Promise<HarnessRuntimeConfig> {
  return new Promise<HarnessRuntimeConfig>((resolve, reject) => {
    if (!socket) {
      reject(new Error("Not connected — call connect() first"));
      return;
    }

    if (cachedConfig) {
      resolve(cachedConfig);
      return;
    }

    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for 'configure' event after ${CONFIG_TIMEOUT_MS}ms`,
        ),
      );
    }, CONFIG_TIMEOUT_MS);

    socket.once("configure", (payload: HarnessRuntimeConfig) => {
      clearTimeout(timer);
      setCachedConfig(payload);
      resolve(payload);
    });
  });
}

function flushPendingCommands(
  registry: CommandRegistry,
  command: OrchestratorCommand,
  handler: CommandHandler,
): void {
  const queued = registry.pending.get(command);
  if (!queued || queued.length === 0) {
    return;
  }

  registry.pending.delete(command);
  for (const payload of queued) {
    void handler(payload);
  }
}

function shiftQueuedCommand(
  registry: CommandRegistry,
  command: OrchestratorCommand,
  match: (payload: CommandPayload) => boolean,
): CommandPayload | undefined {
  const queued = registry.pending.get(command);
  if (!queued || queued.length === 0) {
    return undefined;
  }

  const payloadIndex = queued.findIndex((payload) => match(payload));
  if (payloadIndex < 0) {
    return undefined;
  }

  const [payload] = queued.splice(payloadIndex, 1);
  if (queued.length === 0) {
    registry.pending.delete(command);
  }
  return payload;
}

function registerWaiter(
  registry: CommandRegistry,
  command: OrchestratorCommand,
  entry: WaiterEntry,
): void {
  const current = registry.waiters.get(command) ?? [];
  current.push(entry);
  registry.waiters.set(command, current);
}

function unregisterWaiter(
  registry: CommandRegistry,
  command: OrchestratorCommand,
  entry: WaiterEntry,
): void {
  const current = registry.waiters.get(command);
  if (!current || current.length === 0) {
    return;
  }

  const index = current.indexOf(entry);
  if (index < 0) {
    return;
  }

  current.splice(index, 1);
  if (current.length === 0) {
    registry.waiters.delete(command);
  }
}

function parseWaitOptions<T extends CommandPayload["type"]>(
  timeoutOrOptions?: number | WaitForCommandOptions<T>,
): {
  timeoutMs?: number;
  match: (payload: Extract<CommandPayload, { type: T }>) => boolean;
} {
  if (typeof timeoutOrOptions === "number") {
    return {
      timeoutMs: timeoutOrOptions,
      match: () => true,
    };
  }

  return {
    timeoutMs: timeoutOrOptions?.timeoutMs,
    match: timeoutOrOptions?.match ?? (() => true),
  };
}

export function createOrchestratorClient(
  websocketUrl: string,
  agentJwt: string,
): OrchestratorClient {
  let socket: Socket | null = null;
  const registry: CommandRegistry = {
    handlers: new Map<OrchestratorCommand, CommandHandler>(),
    pending: new Map<OrchestratorCommand, CommandPayload[]>(),
    waiters: new Map<OrchestratorCommand, WaiterEntry[]>(),
  };
  let cachedConfig: HarnessRuntimeConfig | null = null;

  return {
    get connected(): boolean {
      return socket?.connected ?? false;
    },

    async connect(): Promise<void> {
      socket = io(websocketUrl, {
        auth: { token: agentJwt },
        reconnection: true,
        reconnectionAttempts: 10,
        timeout: CONNECT_TIMEOUT_MS,
      });

      wireSocketListeners(socket, registry, (payload) => {
        cachedConfig = payload;
      });

      await Promise.race([
        connectSocket(socket),
        new Promise<void>((_, reject) =>
          setTimeout(() => {
            reject(
              new Error(
                `WebSocket connection timed out after ${CONNECT_TIMEOUT_MS}ms`,
              ),
            );
          }, CONNECT_TIMEOUT_MS),
        ),
      ]);
    },

    waitForConfig(): Promise<HarnessRuntimeConfig> {
      return waitForSocketConfig(socket, cachedConfig, (payload) => {
        cachedConfig = payload;
      });
    },

    emit(event: string, data: unknown): void {
      socket?.emit(event, data);
    },

    onCommand(command: OrchestratorCommand, handler: CommandHandler): void {
      registry.handlers.set(command, handler);
      flushPendingCommands(registry, command, handler);
    },

    waitForCommand<T extends CommandPayload["type"]>(
      command: T,
      timeoutOrOptions?: number | WaitForCommandOptions<T>,
    ): Promise<Extract<CommandPayload, { type: T }>> {
      const options = parseWaitOptions(timeoutOrOptions);

      return new Promise<Extract<CommandPayload, { type: T }>>(
        (resolve, reject) => {
          const commandKey = command;
          const queuedPayload = shiftQueuedCommand(
            registry,
            commandKey,
            (payload) =>
              options.match(payload as Extract<CommandPayload, { type: T }>),
          );
          if (queuedPayload) {
            resolve(queuedPayload as Extract<CommandPayload, { type: T }>);
            return;
          }

          const waiterEntry: WaiterEntry = {
            match: (payload) =>
              options.match(payload as Extract<CommandPayload, { type: T }>),
            resolve: (payload) => {
              resolve(payload as Extract<CommandPayload, { type: T }>);
            },
            reject,
          };

          if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
            waiterEntry.timer = setTimeout(() => {
              unregisterWaiter(registry, commandKey, waiterEntry);
              waiterEntry.reject(
                new Error(
                  `Timed out waiting for command '${command}' after ${options.timeoutMs}ms`,
                ),
              );
            }, options.timeoutMs);
          }

          registerWaiter(registry, commandKey, waiterEntry);
        },
      );
    },

    disconnect(): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!socket?.connected) {
          resolve();
          return;
        }
        socket.once("disconnect", () => {
          resolve();
        });
        socket.disconnect();
      });
    },
  };
}
