import { Module } from "@nestjs/common";
import { InitiativesController } from "./initiatives.controller";
import { InitiativesService } from "./initiatives.service";

@Module({
  controllers: [InitiativesController],
  providers: [InitiativesService],
  exports: [InitiativesService],
})
export class InitiativesModule {}
