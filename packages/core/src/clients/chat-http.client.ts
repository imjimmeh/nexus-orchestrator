import type {
  ChatEventPayloadV1,
  ChatEventTypeV1,
  EventEnvelopeV1,
} from "../schemas/events/event-envelope.schema";
import type { ChatClient } from "../interfaces/service-clients.types";
import type { ServiceClientHttpOptions } from "./http-client.types";
import { sendJsonRequest } from "./http-request";

export class ChatHttpClient implements ChatClient {
  constructor(private readonly options: ServiceClientHttpOptions) {}

  async publishChatEvent(
    event: EventEnvelopeV1<ChatEventTypeV1, ChatEventPayloadV1>,
  ): Promise<void> {
    await sendJsonRequest<unknown>(this.options, {
      path: "/internal/chat/events",
      method: "POST",
      body: event,
    });
  }
}
