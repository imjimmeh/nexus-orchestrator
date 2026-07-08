import { Injectable } from "@nestjs/common";
import type {
  BoardMetadata,
  BoardStateSnapshot,
  CardInput,
  CardSnapshot,
  ColumnSnapshot,
  CurrentSnapshotListener,
  SnapshotsListener,
  SnapshotDiff,
} from "./board-state-snapshot.types";

/**
 * In-memory store for board state snapshots used by retrospective flows.
 *
 * The class previously depended on `rxjs` `BehaviorSubject` to expose snapshot
 * streams, but no active code path consumed those observables. The class is
 * now a plain in-memory store with a small subscriber-list pattern so it does
 * not need an external reactive library.
 */
@Injectable()
export class BoardStateSnapshotService {
  private snapshots: BoardStateSnapshot[] = [];
  private currentSnapshot: BoardStateSnapshot | null = null;
  private readonly snapshotListeners = new Set<SnapshotsListener>();
  private readonly currentSnapshotListeners =
    new Set<CurrentSnapshotListener>();

  createSnapshot(
    columns: Array<{
      id: string;
      title: string;
      cards?: CardInput[];
      color?: string;
    }>,
    metadata: Omit<BoardMetadata, "totalCards" | "totalColumns">,
  ): BoardStateSnapshot {
    const columnSnapshots: ColumnSnapshot[] = columns.map((col) => ({
      id: col.id,
      title: col.title,
      color: col.color,
      cards: (col.cards || []).map((card: CardInput) =>
        this.mapCardToSnapshot(card),
      ),
    }));

    const snapshot: BoardStateSnapshot = {
      id: this.generateSnapshotId(),
      timestamp: new Date(),
      columns: columnSnapshots,
      metadata: {
        ...metadata,
        totalCards: columnSnapshots.reduce(
          (sum, col) => sum + col.cards.length,
          0,
        ),
        totalColumns: columns.length,
      },
    };

    this.addSnapshot(snapshot);
    this.setCurrentSnapshot(snapshot);

    return snapshot;
  }

  getSnapshotById(id: string): BoardStateSnapshot | undefined {
    return this.snapshots.find((s: BoardStateSnapshot) => s.id === id);
  }

  getSnapshotsInRange(startDate: Date, endDate: Date): BoardStateSnapshot[] {
    return this.snapshots.filter(
      (s: BoardStateSnapshot) =>
        s.timestamp >= startDate && s.timestamp <= endDate,
    );
  }

  getSnapshots(): readonly BoardStateSnapshot[] {
    return [...this.snapshots];
  }

  getCurrentSnapshot(): BoardStateSnapshot | null {
    return this.currentSnapshot;
  }

  subscribeSnapshots(listener: SnapshotsListener): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshots());
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  subscribeCurrentSnapshot(listener: CurrentSnapshotListener): () => void {
    this.currentSnapshotListeners.add(listener);
    listener(this.currentSnapshot);
    return () => {
      this.currentSnapshotListeners.delete(listener);
    };
  }

  compareSnapshots(
    snapshotId1: string,
    snapshotId2: string,
  ): SnapshotDiff | null {
    const snap1 = this.getSnapshotById(snapshotId1);
    const snap2 = this.getSnapshotById(snapshotId2);

    if (!snap1 || !snap2) {
      return null;
    }

    const diff: SnapshotDiff = {
      addedCards: [],
      removedCards: [],
      movedCards: [],
      unchangedCards: [],
    };

    const snap1CardIds = this.flattenCards(snap1);
    const snap2CardIds = this.flattenCards(snap2);

    snap2CardIds.forEach((card) => {
      if (!snap1CardIds.find((c) => c.id === card.id)) {
        diff.addedCards.push(card);
      }
    });

    snap1CardIds.forEach((card) => {
      if (!snap2CardIds.find((c) => c.id === card.id)) {
        diff.removedCards.push(card);
      }
    });

    return diff;
  }

  clearSnapshots(): void {
    this.snapshots = [];
    this.currentSnapshot = null;
    this.emitSnapshots();
    this.emitCurrentSnapshot();
  }

  private addSnapshot(snapshot: BoardStateSnapshot): void {
    this.snapshots = [...this.snapshots, snapshot];
    this.emitSnapshots();
  }

  private setCurrentSnapshot(snapshot: BoardStateSnapshot): void {
    this.currentSnapshot = snapshot;
    this.emitCurrentSnapshot();
  }

  private emitSnapshots(): void {
    const snapshot = this.getSnapshots();
    for (const listener of this.snapshotListeners) {
      listener(snapshot);
    }
  }

  private emitCurrentSnapshot(): void {
    for (const listener of this.currentSnapshotListeners) {
      listener(this.currentSnapshot);
    }
  }

  private mapCardToSnapshot(card: CardInput): CardSnapshot {
    return {
      id: card.id,
      title: card.title,
      description: card.description,
      author: card.author,
      votes: card.votes || 0,
      tags: card.tags || [],
    };
  }

  private generateSnapshotId(): string {
    return `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private flattenCards(snapshot: BoardStateSnapshot): CardSnapshot[] {
    return snapshot.columns.flatMap((col) => col.cards);
  }
}
