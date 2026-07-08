import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { BootstrapService } from './bootstrap.service';

/**
 * Composition-root module owning startup actions that must not live in a leaf
 * module. Imports SecurityModule for the IAM policy refresh; it does NOT import
 * DatabaseModule (data seeding stays in DatabaseModule.onModuleInit), so no new
 * cycle is introduced.
 */
@Module({
  imports: [SecurityModule],
  providers: [BootstrapService],
})
export class BootstrapModule {
  protected readonly _moduleName = 'BootstrapModule';
}
