export interface InboxNotification {
  id: string;
  subject: string;
  body: string;
  eventType: string;
  createdAt: string;
  readAt: string | null;
  metadata?: Record<string, unknown> | null;
}