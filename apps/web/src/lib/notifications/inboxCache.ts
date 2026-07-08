import type { InboxEnvelope } from "@/lib/notifications/inboxCache.types";

/**
 * Produces an updated inbox envelope with the matching notification's
 * `readAt` replaced. Returns the original `current` reference when the
 * envelope shape is missing `data`, preserving the React Query
 * `setQueryData` early-return contract.
 */
export function patchInboxReadState(
  current: unknown,
  notificationId: string,
  readAt: string,
): unknown {
  const parsed = current as InboxEnvelope;
  if (!parsed?.data) {
    return current;
  }

  return {
    ...parsed,
    data: parsed.data.map((notification) =>
      notification.id === notificationId
        ? { ...notification, readAt }
        : notification,
    ),
  };
}
