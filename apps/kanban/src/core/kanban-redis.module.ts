import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { KANBAN_REDIS_CLIENT } from "./kanban-redis.constants";

@Global()
@Module({
  providers: [
    {
      provide: KANBAN_REDIS_CLIENT,
      useFactory: () =>
        new Redis({
          host: process.env.REDIS_HOST ?? "localhost",
          port: Number(process.env.REDIS_PORT ?? "6379"),
          password: process.env.REDIS_PASSWORD || undefined,
        }),
    },
  ],
  exports: [KANBAN_REDIS_CLIENT],
})
export class KanbanRedisModule {}
