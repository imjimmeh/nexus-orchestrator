/** Minimal logger surface the park helpers need (satisfied by NestJS Logger). */
export interface ParkLogger {
  log(message: string): void;
  warn(message: string): void;
}

export type ParkedTurnEndAction = 'suspend' | 'complete';
