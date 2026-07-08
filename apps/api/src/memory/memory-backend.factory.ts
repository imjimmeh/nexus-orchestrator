import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemoryBackend, MemoryBackendMode } from './memory-backend.types';

interface MemoryBackendRegistry {
  postgres: MemoryBackend;
  honcho: MemoryBackend;
  dual: MemoryBackend;
}

@Injectable()
export class MemoryBackendFactory {
  private readonly logger = new Logger(MemoryBackendFactory.name);

  constructor(private readonly configService: ConfigService) {}

  create(registry: MemoryBackendRegistry): MemoryBackend {
    const mode = this.resolveMode();

    switch (mode) {
      case 'honcho':
        this.logger.log('Using honcho memory backend mode');
        return registry.honcho;
      case 'dual':
        this.logger.log('Using dual memory backend mode');
        return registry.dual;
      case 'postgres':
      default:
        this.logger.log('Using postgres memory backend mode');
        return registry.postgres;
    }
  }

  private resolveMode(): MemoryBackendMode {
    const raw =
      this.configService.get<string>('MEMORY_BACKEND')?.trim().toLowerCase() ||
      'postgres';

    if (raw === 'honcho' || raw === 'dual' || raw === 'postgres') {
      return raw;
    }

    this.logger.warn(
      `Unsupported MEMORY_BACKEND="${raw}". Falling back to postgres mode.`,
    );
    return 'postgres';
  }
}
