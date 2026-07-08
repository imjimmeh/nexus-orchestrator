import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScopeNode } from './database/entities/scope-node.entity';
import { ScopeNodeClosure } from './database/entities/scope-node-closure.entity';
import { ScopeService } from './scope.service';
import { ScopeController } from './scope.controller';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../auth/authorization/authorization.module';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([ScopeNode, ScopeNodeClosure]),
    AuthorizationModule,
  ],
  providers: [ScopeService],
  exports: [ScopeService],
  controllers: [ScopeController],
})
export class ScopeModule {}
