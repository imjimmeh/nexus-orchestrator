// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@vitejs/plugin-react", () => ({
  default: () => ({ name: "mock-react-plugin" }),
}));

const viteConfigPromise = import(
  new URL("../vite.config.ts", import.meta.url).href
).then(
  (mod) =>
    mod as {
      WEB_PROXY_TARGETS: { api: string; kanban: string; chat: string };
      default: {
        preview?: {
          host?: string;
          port?: number;
          strictPort?: boolean;
          proxy?: unknown;
        };
        server?: { proxy?: unknown };
      };
    },
);

async function getViteConfig() {
  return viteConfigPromise;
}

describe("vite proxy configuration", () => {
  it("routes core API requests to the local API over IPv4", async () => {
    const { WEB_PROXY_TARGETS } = await getViteConfig();
    expect(WEB_PROXY_TARGETS.api).toBe("http://127.0.0.1:3010");
  });

  it("routes kanban API requests to the kanban service over IPv4", async () => {
    const { WEB_PROXY_TARGETS } = await getViteConfig();
    expect(WEB_PROXY_TARGETS.kanban).toBe("http://127.0.0.1:3012");
  });

  it("routes chat API requests through the main API service", async () => {
    const { WEB_PROXY_TARGETS } = await getViteConfig();
    expect(WEB_PROXY_TARGETS.chat).toBe("http://127.0.0.1:3010");
  });

  it("uses a preview port that does not collide with Docker nginx", async () => {
    const { default: viteConfig } = await getViteConfig();
    expect(viteConfig.preview?.host).toBe("127.0.0.1");
    expect(viteConfig.preview?.port).toBe(3121);
    expect(viteConfig.preview?.strictPort).toBe(true);
  });

  it("mirrors API proxy routes for local preview", async () => {
    const { default: viteConfig } = await getViteConfig();
    expect(viteConfig.preview?.proxy).toEqual(viteConfig.server?.proxy);
  });
});
