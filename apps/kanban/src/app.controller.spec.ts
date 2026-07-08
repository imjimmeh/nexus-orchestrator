import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

describe("AppController", () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHealthMessage: () => "Kanban service is running",
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it("returns the health payload", () => {
    expect(appController.getHealth()).toEqual({
      status: "ok",
      message: "Kanban service is running",
    });
  });
});
