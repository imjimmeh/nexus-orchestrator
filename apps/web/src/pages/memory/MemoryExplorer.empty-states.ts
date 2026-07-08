import type { ChatMemorySource } from "@/lib/api/memory.types";

export function getUserEmptyStateMessage(queryText: string): string {
  if (queryText.trim().length > 0) {
    return "No user memory segments match your current search.";
  }

  return "No user memory segments are available for the selected user.";
}

export function getSystemEmptyStateMessage(
  queryText: string,
  entityId: string,
): string {
  if (queryText.trim().length > 0) {
    return "No system memory segments match your current search.";
  }

  if (entityId.trim().length > 0) {
    return "No system memory segments were found for the selected shared entity id.";
  }

  return "No system memory segments are available yet.";
}

export function getChatEmptyStateMessage(params: {
  queryText: string;
  source: ChatMemorySource;
  onlyUndistilled: boolean;
}): string {
  if (params.queryText.trim().length > 0) {
    return "No chat memory segments match your current search.";
  }

  if (params.source === "session" && params.onlyUndistilled) {
    return "No undistilled session memory segments were found for the current filters.";
  }

  return "No chat memory segments are available for the selected filters.";
}
