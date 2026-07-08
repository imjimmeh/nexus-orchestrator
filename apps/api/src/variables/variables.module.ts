import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ScopeModule } from '../scope/scope.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';
import { VariablesController } from './variables.controller';
import { VariableResolverService } from './variable-resolver.service';

@Module({
  imports: [DatabaseModule, ScopeModule, AuthorizationModule],
  controllers: [VariablesController],
  providers: [VariableResolverService],
  exports: [VariableResolverService],
})
export class VariablesModule {}
