const LAST_VIEWED_KEY_PREFIX = "nexus_learning_tab_last_viewed_";
const DEFAULT_STALE_DAYS = 7;

function lastViewedKey(projectId: string): string {
  return `${LAST_VIEWED_KEY_PREFIX}${projectId}`;
}

export function getLastViewedAt(projectId: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(lastViewedKey(projectId));
}

export function markViewedNow(projectId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    lastViewedKey(projectId),
    new Date().toISOString(),
  );
}

export function isNewSinceLastVisit(
  timestamp: string,
  lastViewedAt: string | null,
): boolean {
  if (!lastViewedAt) {
    return true;
  }
  return new Date(timestamp).getTime() > new Date(lastViewedAt).getTime();
}

export function isStalePending(
  status: string,
  createdAt: string,
  now: Date,
  staleDays: number = DEFAULT_STALE_DAYS,
): boolean {
  if (status !== "pending") {
    return false;
  }
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  return ageMs > staleDays * 24 * 60 * 60 * 1000;
}
