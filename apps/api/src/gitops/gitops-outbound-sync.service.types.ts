export interface OutboundActorContext {
  actorId: string;
}

export interface OutboundSyncResult {
  bindingId: string;
  branchName: string;
  pendingChangeCount: number;
}
