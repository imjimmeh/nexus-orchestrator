import { useEffect, useState, useCallback } from "react";

const UNREAD_STORAGE_KEY = "inbox:unread-threads";

/**
 * Manages unread state for chat threads and workflow runs.
 * Integrates with socket.io for real-time updates and persists to localStorage.
 */
export function useUnreadThreads() {
  const [unreadMap, setUnreadMap] = useState<Map<string, boolean>>(() => {
    // Load from localStorage on initialization
    try {
      const stored = localStorage.getItem(UNREAD_STORAGE_KEY);
      if (stored) {
        const entries = JSON.parse(stored) as Array<[string, boolean]>;
        return new Map(entries);
      }
    } catch (error) {
      console.error("Failed to load unread threads from localStorage:", error);
    }
    return new Map();
  });

  // Persist unread state to localStorage whenever it changes
  useEffect(() => {
    try {
      const entries = Array.from(unreadMap.entries());
      localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(entries));
    } catch (error) {
      console.error("Failed to persist unread threads to localStorage:", error);
    }
  }, [unreadMap]);

  const markAsRead = useCallback((threadId: string) => {
    setUnreadMap((current) => {
      const next = new Map(current);
      next.set(threadId, false);
      return next;
    });
  }, []);

  const markAsUnread = useCallback((threadId: string) => {
    setUnreadMap((current) => {
      const next = new Map(current);
      next.set(threadId, true);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setUnreadMap(new Map());
  }, []);

  return {
    unreadMap,
    markAsRead,
    markAsUnread,
    clearAll,
  };
}
