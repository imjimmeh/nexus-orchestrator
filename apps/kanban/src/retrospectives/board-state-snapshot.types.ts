export interface CardSnapshot {
  id: string;
  title: string;
  description?: string;
  author?: string;
  votes: number;
  tags: string[];
}

export interface ColumnSnapshot {
  id: string;
  title: string;
  cards: CardSnapshot[];
  color?: string;
}

export interface BoardMetadata {
  boardId: string;
  boardTitle: string;
  totalCards: number;
  totalColumns: number;
  participantCount: number;
}

export interface BoardStateSnapshot {
  id: string;
  timestamp: Date;
  columns: ColumnSnapshot[];
  metadata: BoardMetadata;
}

export interface SnapshotDiff {
  addedCards: CardSnapshot[];
  removedCards: CardSnapshot[];
  movedCards: CardSnapshot[];
  unchangedCards: CardSnapshot[];
}

export interface CardInput {
  id: string;
  title: string;
  description?: string;
  author?: string;
  votes?: number;
  tags?: string[];
}

/**
 * Lightweight listener signatures exposed by `BoardStateSnapshotService` for
 * consumers that want to react to snapshot list/current changes. The service
 * uses a small subscriber-list pattern instead of an external reactive
 * library.
 */
export type SnapshotsListener = (
  snapshots: readonly BoardStateSnapshot[],
) => void;

export type CurrentSnapshotListener = (
  snapshot: BoardStateSnapshot | null,
) => void;
