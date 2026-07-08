import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

interface TsConfig {
  compilerOptions?: {
    emitDecoratorMetadata?: boolean;
    experimentalDecorators?: boolean;
  };
}

describe("CorrelationIdMiddleware build metadata", () => {
  it("emits legacy decorator metadata so Nest can inject request context", () => {
    const tsconfig = JSON.parse(
      readFileSync(new URL("../../tsconfig.json", import.meta.url), "utf8"),
    ) as TsConfig;

    expect(tsconfig.compilerOptions?.experimentalDecorators).toBe(true);
    expect(tsconfig.compilerOptions?.emitDecoratorMetadata).toBe(true);
  });
});
