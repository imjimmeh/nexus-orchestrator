import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { PasswordValidationService } from '../auth/password-validation.service';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { UserMemoryController } from './user-memory.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, AuthorizationModule, DatabaseModule, MemoryModule],
  controllers: [UsersController, UserMemoryController],
  providers: [UsersService, PasswordValidationService],
  exports: [UsersService],
})
export class UsersModule {
  /** User management module */
  protected readonly _moduleName = 'UsersModule';
}
