export interface ChatChannelRouteIdentity {
  provider: string;
  externalThreadId: string;
  externalUserId: string;
}

export interface UpsertActiveChatChannelRouteInput extends ChatChannelRouteIdentity {
  activeChatSessionId: string;
  lastAccessedAt?: Date;
}
