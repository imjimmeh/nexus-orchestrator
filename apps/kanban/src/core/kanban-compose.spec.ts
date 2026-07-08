import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("docker-compose kanban service", () => {
  it("passes the compose Redis service address to Kanban", () => {
    const compose = readFileSync(
      resolve(__dirname, "../../../../docker-compose.yaml"),
      "utf8",
    );
    const kanbanService = compose.slice(
      compose.indexOf("  kanban:"),
      compose.indexOf("  web:"),
    );

    expect(kanbanService).toContain("- REDIS_HOST=redis");
    expect(kanbanService).toContain("- REDIS_PORT=6379");
  });
});
