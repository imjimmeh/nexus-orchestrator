import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import type { WorkItemRecord } from "./work-item.types";

interface JoinProjectPayload {
  projectId: string;
}

@WebSocketGateway({
  namespace: "/kanban",
  cors: {
    origin:
      process.env.CORS_ORIGIN === "*"
        ? true
        : (process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()) ?? "*"),
  },
})
export class WorkItemRealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(WorkItemRealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    this.logger.log(`Kanban client connected: ${client.id}`);
  }

  @SubscribeMessage("join-project")
  async handleJoinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinProjectPayload,
  ) {
    if (!payload?.projectId) {
      return { success: false };
    }

    await client.join(payload.projectId);
    return { success: true };
  }

  broadcastWorkItemUpdated(
    projectId: string,
    workItem: WorkItemRecord,
    triggeredRunIds: string[],
  ): void {
    this.server.to(projectId).emit("work-item-updated", {
      projectId,
      workItem,
      triggeredRunIds,
    });
  }
}
