import { MODULE_METADATA } from "@nestjs/common/constants";
import { describe, expect, it } from "vitest";
import { ReviewModule } from "./review.module";
import { ReviewService } from "./review.service";

describe("ReviewModule", () => {
  it("exports ReviewService for Kanban MCP tool execution", () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      ReviewModule,
    ) as unknown[];

    expect(exports).toContain(ReviewService);
  });
});
