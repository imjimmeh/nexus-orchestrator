import type { WarRoomService } from '../war-room/war-room.service';

export type WarRoomServiceLike = Pick<
  WarRoomService,
  | 'openSession'
  | 'inviteParticipant'
  | 'postMessage'
  | 'updateBlackboard'
  | 'submitSignoff'
  | 'getState'
  | 'closeSession'
>;

export type ProcessAndBroadcastEvent = (
  workflowRunId: string,
  event: { event_type: string; payload: Record<string, unknown> },
) => Promise<void>;
