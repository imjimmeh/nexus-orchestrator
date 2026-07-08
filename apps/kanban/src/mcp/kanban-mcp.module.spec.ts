import { describe, expect, it } from "vitest";
import "reflect-metadata";
import { ProjectModule } from "../project/project.module";
import { CharterDocRenderService } from "../project/charter-doc-render.service";

describe("ProjectModule exports", () => {
  it("exports CharterDocRenderService so KanbanMcpModule can inject it into GetCharterTool", () => {
    const exports: unknown[] =
      Reflect.getMetadata("exports", ProjectModule) ?? [];
    expect(exports).toContain(CharterDocRenderService);
  });
});
