import type { InboxNotification } from "@/lib/notifications/inboxNotification.types";

/**
 * Canonical shape of an inbox query response. Matches the previous local
 * declarations in `GlobalRealtimeContext.tsx` and `useNotifications.ts`.
 */
export type InboxEnvelope =
  | {
      success: boolean;
      data: InboxNotification[];
      meta?: { total?: number } | undefined;
    }
  | undefined;
