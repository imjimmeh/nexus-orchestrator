export const OUTBOUND_SYNC_SERVICE = Symbol("OUTBOUND_SYNC_SERVICE");

export interface IOutboundSyncService {
  pushStatusChange(params: {
    projectId: string;
    workItemId: string;
    status: string;
    previousStatus: string | null;
  }): Promise<void>;
}
