import { Injectable, OnApplicationShutdown } from '@nestjs/common';

@Injectable()
export class ShutdownStateService implements OnApplicationShutdown {
  private shuttingDown = false;

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
  }
}
