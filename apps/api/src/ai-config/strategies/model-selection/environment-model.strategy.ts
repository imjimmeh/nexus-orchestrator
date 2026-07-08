import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelSelectionStrategy } from './model-selection.strategy';

@Injectable()
export class EnvironmentModelStrategy implements ModelSelectionStrategy {
  readonly priority = 2; // Fallback priority - check env vars

  constructor(private readonly configService: ConfigService) {}

  canSelect(_useCase: string): boolean {
    return true; // Always available as fallback
  }

  selectModel(useCase: string): Promise<string | null> {
    return Promise.resolve(this.resolveModelFromEnvironment(useCase));
  }

  private resolveModelFromEnvironment(useCase: string): string | null {
    switch (useCase) {
      case 'distillation':
        return (
          this.configService.get<string>('DISTILLATION_MODEL') ||
          this.configService.get<string>('MODEL') ||
          'default-model'
        );

      case 'summarization':
        return (
          this.configService.get<string>('SUMMARIZATION_MODEL') ||
          this.configService.get<string>('MODEL') ||
          'default-model'
        );

      case 'session':
        return this.configService.get<string>('MODEL') || 'default-model';

      default:
        return this.configService.get<string>('MODEL') || 'default-model';
    }
  }
}
